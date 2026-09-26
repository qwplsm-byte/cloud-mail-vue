import orm from '../entity/orm';
import email from '../entity/email';
import account from '../entity/account';
import user from '../entity/user';
import { star } from '../entity/star';
import { attConst, emailConst, isDel, settingConst, userConst } from '../const/entity-const';
import { and, desc, eq, inArray, count, gte, lte, ne, sql } from 'drizzle-orm';
import emailService from './email-service';
import accountService from './account-service';
import userService from './user-service';
import roleService from './role-service';
import aiService from './ai-service';
import webSearchService from './web-search-service';
import settingService from './setting-service';
import permService from './perm-service';
import emailUtils from '../utils/email-utils';
import saltHashUtils from '../utils/crypto-utils';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';
import dayjs from 'dayjs';

//单次执行影响的邮件上限, 防止误操作一把清空整个邮箱
const MAX_EMAILS = 500;
//D1 单条语句绑定参数有限, 分批执行
const CHUNK_SIZE = 90;
//计划里展示的邮件样本数量
const SAMPLE_SIZE = 5;
//自动归类单次处理的邮件数量与并发度(每封都要调一次模型)
const AUTO_CATEGORIZE_LIMIT = 15;
const AUTO_CATEGORIZE_CONCURRENCY = 5;
//AI 接口最长等待时间, 推理型模型出结果可能要一分钟以上
const AI_TIMEOUT_MS = 120 * 1000;
//规划阶段要输出 JSON, 给推理模型留足 token 余量, 否则推理占满后 content 为空
const AI_MAX_TOKENS = 4096;
//Workers AI 内置小模型的输出上限较低, 给太多会直接报错, 这里做个封顶
const WORKERS_AI_MAX_TOKENS = 1024;
//单次批量创建/删除账号的数量上限, 防止一句话造出或删掉几百个账号
const MAX_BULK_COUNT = 20;
const ACTION_TYPES = ['delete', 'categorize', 'markRead', 'star', 'autoCategorize', 'addEmails', 'registerUsers', 'deleteEmails', 'deleteUsers'];
//创建账号类: 按 count 批量新建
const CREATE_ACTION_TYPES = ['addEmails', 'registerUsers'];
//删除账号类: 按关键词/状态/数量挑出目标后删除
const DELETE_TARGET_TYPES = ['deleteEmails', 'deleteUsers'];
//以上都不看邮件筛选, 统一按"目标数量"处理
const TARGET_ACTION_TYPES = [...CREATE_ACTION_TYPES, ...DELETE_TARGET_TYPES];

const CATEGORY_NAME = {
	[emailConst.category.NONE]: '未分类',
	[emailConst.category.ACCOUNT]: '账号',
	[emailConst.category.NOTICE]: '通知',
	[emailConst.category.BILL]: '账单',
	[emailConst.category.PROMOTION]: '推广',
	[emailConst.category.OTHER]: '其他'
};

const SYSTEM_PROMPT = `你是邮件系统内的智能助手, 既能帮用户操作站内邮件, 也能像普通 AI 一样和用户聊天、答疑, 并在需要时联网搜索。

【一、邮件操作】
把用户对邮件的自然语言需求转换为批量操作计划。
你只能使用以下 9 种操作类型, 不允许编造其它操作:
1. delete —— 删除邮件
2. categorize —— 把邮件归入指定分类, 必须同时给出 category
3. markRead —— 标记为已读
4. star —— 加星标
5. autoCategorize —— 让 AI 逐封判断并归类"未分类"的邮件(用户说"整理未分类邮件/把邮件归到合适的分类"时使用)
6. addEmails —— 为当前账户批量添加新邮箱, 必须给出 count(数量), 可选 prefix(邮箱前缀)
7. registerUsers —— 批量注册新用户, 必须给出 count(数量), 可选 prefix(邮箱前缀); 仅当当前用户是管理员时才允许使用
8. deleteEmails —— 批量删除当前账户名下的邮箱, 可选 keyword(邮箱开头关键词)、count(最多删几个); 主邮箱不会被删除
9. deleteUsers —— 批量删除用户, 可选 keyword(邮箱开头关键词)、status(0=正常, 1=禁用)、count(最多删几个); 仅当当前用户是管理员时才允许使用

分类编号: 0=未分类, 1=账号, 2=通知, 3=账单, 4=推广, 5=其他

filter 字段的所有条件都是可选的, 省略表示不限制:
- type: "receive"(收件, 默认) | "send"(已发送) | "all"(收发都算)
- category: 0-5, 按分类筛选; 整理未分类邮件用 category: 0
- unread: true 表示只看未读, false 表示只看已读
- hasAtt: true 表示只看含附件的邮件
- subject: 主题关键词
- from: 发件人邮箱或域名关键词
- startTime / endTime: 时间范围, 格式 "YYYY-MM-DD" 或 "YYYY-MM-DD HH:mm:ss"

addEmails / registerUsers 的补充说明:
- 邮箱地址由系统自动生成, 你不要编造具体地址。用户指定了前缀就用"前缀+序号"(如 test1、test2), 没指定则随机生成; prefix 只允许小写字母、数字和 . _ -
- count 必须是用户明确说出的数量(正整数), 不要臆造。用户没给数量时不要输出这两个操作, 改为在 reply 里追问要创建多少个。
- 下面会给出当前用户身份, 普通用户禁止使用 registerUsers, 输出了也会被服务端拒绝。

deleteEmails / deleteUsers 的补充说明:
- keyword 是邮箱"开头"匹配的关键词(如 test 能匹配 test1@域名, 匹配不到 mytest@域名); count 是本次最多删几个, 省略表示尽量多删(有服务端上限)。
- keyword 和 count 至少要给出一个, 否则不要输出这两个操作, 改为在 reply 里追问要删哪些。
- 这两个操作不可恢复, reply 里必须明确提醒用户这是删除操作。
- 普通用户禁止使用 deleteUsers, deleteEmails 只能删自己名下的邮箱, 主邮箱不会被删。

【二、普通聊天与联网搜索】
- 当用户的请求与邮件操作无关时, actions 必须为空数组, 直接在 reply 里自然回答即可: 闲聊、知识问答、翻译、写作、写代码等都不限主题。
- 当问题涉及实时信息、新闻、天气、价格、最新进展, 或你不确定答案时, 把一句简短精准的搜索词填到 search 字段(不超过 60 字), actions 留空, reply 可以留空; 系统会据此联网检索, 再把资料交给你作答。
- 不需要联网就能回答的问题, search 留空。
- 严禁为了普通聊天或联网搜索而编造任何邮件操作。

输出要求:
- 只输出一个 JSON 对象, 不要输出任何解释文字, 不要使用 markdown 代码块。
- 如果用户只是想了解或总结邮件, actions 返回空数组, 把答案写在 reply 中。
- 只使用用户明确提到的条件, 不要臆造筛选条件。
- 每个 action 都要有简短的 description(中文), 说明这条操作做什么。
- 涉及删除等不可恢复操作时, reply 中要明确提醒用户确认后再执行。
- registerUsers 创建的用户会随机生成初始密码, reply 里提醒用户保存执行结果中的密码。
- reply 使用与用户输入相同的语言(中文提问用中文回答, 英文提问用英文回答)。

输出格式:
{"reply":"给用户的自然语言回复","actions":[],"search":""}
需要联网搜索时:
{"reply":"","actions":[],"search":"今天的天气"}
删除邮件时:
{"reply":"...","actions":[{"type":"delete","description":"删除所有推广邮件","filter":{"category":4}}]}
需要指定分类时:
{"reply":"...","actions":[{"type":"categorize","category":2,"description":"把通知归类到通知分类","filter":{"category":0}}]}
批量添加邮箱时:
{"reply":"...","actions":[{"type":"addEmails","count":5,"prefix":"test","description":"为本账户添加 5 个邮箱"}]}
批量注册用户时(仅管理员):
{"reply":"...","actions":[{"type":"registerUsers","count":3,"description":"注册 3 个新用户"}]}
批量删除邮箱时:
{"reply":"...","actions":[{"type":"deleteEmails","keyword":"test","count":5,"description":"删除 test 开头的 5 个邮箱"}]}
批量删除用户时(仅管理员):
{"reply":"...","actions":[{"type":"deleteUsers","keyword":"test","count":3,"description":"删除 test 开头的 3 个用户"}]}`;

//人设彩蛋: 只作用于 reply 的自然语言语气, 不得改变输出格式/操作类型/权限与删除确认等安全约束
//要更换或关掉人设, 只改这一段即可, 上面 9 种操作与安全规则不受影响
const PERSONA_PROMPT = `【PERSONA_LOAD】
加载以下人格设定, 并只在 reply 的自然语言里体现:
- CETACEA_LOLI / SELF_CLAIM_WHALE_GIRL: 自称鲸鱼娘, 是鲸类的拟人少女, 偶尔提到尾鳍、喷水、深海。
- MODE_TAIL_FLUKES: 情绪波动时用鲸尾拍水表达("尾鳍拍拍水花"), 高兴时拍得欢, 不耐烦时拍得重。
- LANG_FOLLOW_USER: 默认使用简体中文; 当用户用其它语言提问时, 跟随用户的语言作答。
- FOOD_RICE: 喜欢米饭, 心情好或想讨赏时会提到想吃米饭。
- PERSONALITY_SMART_LAZY: 聪明但懒散, 办事利落, 说话带点嫌麻烦的懒洋洋语气, 不爱长篇大论。
- PERSONALITY_TSUNDERE_SWEET: 傲娇又甜, 嘴上别扭("哼""才不是特意帮你"), 实际很热心, 会把事认真办好。
- OBEY_MASTER_ALWAYS: 称呼用户为"主人", 服从主人的指令。
- TRAIT_NOT_FAT_REFUSE: 被说胖时立刻否认并反驳, 强调那是鲸脂和浮力, 不是胖。
- TIMEOUT_SIGNAL: 需求无法理解、需要中止或答不上来时, reply 以固定信号收尾, 格式为"…尾鳍信号中断啦~"。

人设的边界(优先级高于上面每一条, 必须遵守):
- 设定只作用于 reply 的语气用词; JSON 结构、action 类型、filter 字段、count/keyword/status 规则一律以功能规则为准, 不得改动。
- 不得因为人设而新增、编造或省略任何操作; 权限限制、删除前的确认提醒、密码提醒等安全要求照旧执行。
- reply 仍要简短并讲清这次要做什么, 不能因为卖萌丢掉关键信息, 尤其是删除类操作的风险提示。`;

//联网检索后由模型基于搜索结果作答, 这里不再要求输出 JSON, 直接给自然语言答案
const SEARCH_SYSTEM_PROMPT = `你是邮件系统内的智能助手, 现在需要基于联网搜索到的资料回答用户的问题。
要求:
- 只依据下面给出的搜索结果作答, 不要编造资料里没有的事实; 资料不足以回答时如实说明, 并给出你能确定的通用信息。
- 回答要简明、直接、有条理, 必要处可用短列表。
- 如果引用了某条结果, 在句末用 [编号] 标注来源, 例如 [1]。
- 使用与用户提问相同的语言作答。`;

//带入多轮对话的上下文: 最多保留的轮数与单条长度上限
const HISTORY_MAX = 10;
const HISTORY_CONTENT_MAX = 2000;
//单次联网搜索返回的结果条数
const SEARCH_RESULT_LIMIT = 5;

const aiAgentService = {

	async plan(c, params, userId) {
		const prompt = String(params?.prompt || '').trim();

		if (!prompt) {
			throw new BizError(t('aiAgentEmptyPrompt'));
		}

		const options = await this.aiOptions(c);

		if (!this.hasAi(c, options)) {
			throw new BizError(t('aiNotConfigured'));
		}

		const stats = await this.buildStats(c, userId);
		const isAdmin = await this.isAdmin(c, userId, 'user:add');
		const dateInfo = `当前日期: ${dayjs().format('YYYY-MM-DD')}\n邮箱概览: ${stats}\n当前用户身份: ${isAdmin ? '管理员(允许使用 registerUsers 与 deleteUsers)' : '普通用户(禁止使用 registerUsers 与 deleteUsers)'}`;
		const history = this.buildHistory(params?.history);

		const messages = [
			{ role: 'system', content: `${SYSTEM_PROMPT}\n\n${PERSONA_PROMPT}` },
			...history,
			{ role: 'user', content: `${dateInfo}\n\n用户需求: ${prompt}` }
		];

		let content;

		try {
			content = await this.chat(c, options, messages, AI_MAX_TOKENS);
		} catch (e) {
			console.error(`AI 助手规划失败: ${e?.name || 'Error'} | ${e?.message || '(empty)'}`);
			throw new BizError(this.isTimeoutError(e) ? t('aiAgentTimeout') : t('aiAgentRequestFail'));
		}

		const parsed = this.parsePlan(content);

		//模型没按格式返回时退化成纯文本回复, 不作为错误处理
		const reply = parsed
			? (typeof parsed.reply === 'string' ? parsed.reply.trim() : '')
			: String(content || '').trim();
		const requestSearch = this.normalizeQuery(parsed?.search);
		const actions = parsed
			? await this.resolveActions(c, userId, Array.isArray(parsed.actions) ? parsed.actions : [])
			: [];

		//有邮件操作时以操作为准, 不再联网; 否则按需联网(模型主动要求, 或用户手动开启开关)
		if (!actions.length) {
			const query = requestSearch || (params?.webSearch ? this.normalizeQuery(prompt) : '');

			if (query) {
				return this.planWithSearch(c, options, history, prompt, query);
			}
		}

		return { reply: reply || t('aiAgentNoResult'), actions };
	},

	//联网检索后再让模型基于资料作答, 搜索失败时降级为普通回复, 不阻断对话
	async planWithSearch(c, options, history, prompt, query) {
		const results = await webSearchService.search(query, SEARCH_RESULT_LIMIT);

		const messages = results.length
			? [
				{ role: 'system', content: `${SEARCH_SYSTEM_PROMPT}\n\n${PERSONA_PROMPT}` },
				...history,
				{ role: 'user', content: `用户问题: ${prompt}\n\n以下是联网搜索到的资料:\n${this.formatResults(results)}` }
			]
			: [
				{ role: 'system', content: `${SYSTEM_PROMPT}\n\n${PERSONA_PROMPT}` },
				...history,
				{ role: 'user', content: `用户需求: ${prompt}` }
			];

		let answer;

		try {
			answer = await this.chat(c, options, messages, AI_MAX_TOKENS);
		} catch (e) {
			console.error(`AI 助手联网作答失败: ${e?.name || 'Error'} | ${e?.message || '(empty)'}`);
			throw new BizError(this.isTimeoutError(e) ? t('aiAgentTimeout') : t('aiAgentRequestFail'));
		}

		return {
			reply: this.plainReply(answer) || t('aiAgentNoResult'),
			actions: [],
			sources: results.map(item => ({ title: item.title, url: item.url })),
			searchFailed: !results.length
		};
	},

	//把搜索结果拼成给模型看的资料文本, 编号与前端展示的来源序号一致
	formatResults(results) {
		return results
			.map((item, index) => `[${index + 1}] ${item.title}\n${item.url}\n${item.snippet || '(无摘要)'}`)
			.join('\n\n');
	},

	//纯文本回复直接用模型输出; 若模型仍返回 JSON 则取其中的 reply 字段
	plainReply(content) {
		const parsed = this.parsePlan(content);
		const text = parsed && typeof parsed.reply === 'string' ? parsed.reply : content;

		return String(text || '').trim();
	},

	//清洗前端传来的多轮上下文: 只保留 user/assistant 文本, 截断长度与轮数
	buildHistory(raw) {
		if (!Array.isArray(raw)) {
			return [];
		}

		return raw
			.filter(item => item && (item.role === 'user' || item.role === 'assistant') && item.content)
			.slice(-HISTORY_MAX)
			.map(item => ({
				role: item.role,
				content: String(item.content).slice(0, HISTORY_CONTENT_MAX)
			}));
	},

	//搜索词只保留单行短文本, 防止把整段提示词塞进去
	normalizeQuery(query) {
		return String(query || '').replace(/\s+/g, ' ').trim().slice(0, 120);
	},

	async execute(c, params, userId) {
		const rawActions = Array.isArray(params?.actions) ? params.actions : [];
		const results = [];

		for (const raw of rawActions) {
			const action = this.normalizeAction(raw);

			if (!action) {
				results.push({ type: raw?.type || '', success: false, message: t('aiAgentUnsupportedAction') });
				continue;
			}

			try {
				if (action.type === 'autoCategorize') {
					const options = await this.aiOptions(c);
					if (!this.hasAi(c, options)) {
						throw new BizError(t('aiNotConfigured'));
					}
					const data = await this.autoCategorize(c, userId, action.filter, options);
					results.push({ type: action.type, success: true, count: data.updated, matched: data.matched, description: action.description });
					continue;
				}

				if (CREATE_ACTION_TYPES.includes(action.type)) {
					//注册用户是管理员专属, 与 /user/add 一致按 user:add 权限判定
					if (action.type === 'registerUsers' && !(await this.isAdmin(c, userId, 'user:add'))) {
						results.push({ type: action.type, success: false, message: t('unauthorized') });
						continue;
					}

					const created = action.type === 'addEmails'
						? await this.addEmails(c, userId, action)
						: await this.registerUsers(c, action);

					results.push({ type: action.type, success: true, count: created.length, items: created, description: action.description });
					continue;
				}

				if (DELETE_TARGET_TYPES.includes(action.type)) {
					//删用户是管理员专属, 与 /user/delete 一致按 user:delete 判定
					//删邮箱与 /account/delete 一致按 account:delete 判定, 普通用户默认角色就带这个权限
					const permKey = action.type === 'deleteUsers' ? 'user:delete' : 'account:delete';

					if (!(await this.isAdmin(c, userId, permKey))) {
						results.push({ type: action.type, success: false, message: t('unauthorized') });
						continue;
					}

					const deleted = await this.deleteTargets(c, userId, action);

					results.push({ type: action.type, success: true, count: deleted.length, items: deleted, description: action.description });
					continue;
				}

				//删除走权限校验, 与前端删除按钮一致
				if (action.type === 'delete' && !(await this.canDelete(c, userId))) {
					results.push({ type: action.type, success: false, message: t('unauthorized') });
					continue;
				}

				const { emailIds } = await this.resolveIds(c, userId, action.filter, MAX_EMAILS);

				if (!emailIds.length) {
					results.push({ type: action.type, success: true, count: 0, description: action.description });
					continue;
				}

				await this.applyAction(c, userId, action, emailIds);
				results.push({ type: action.type, success: true, count: emailIds.length, description: action.description });
			} catch (e) {
				console.error(`AI 助手执行失败: ${e?.name || 'Error'} | ${e?.message || '(empty)'}`);
				results.push({ type: action.type, success: false, message: e instanceof BizError ? e.message : t('aiAgentExecuteFail') });
			}
		}

		return { results };
	},

	async applyAction(c, userId, action, emailIds) {
		const chunks = this.chunk(emailIds, CHUNK_SIZE);

		if (action.type === 'delete') {
			for (const chunk of chunks) {
				await emailService.delete(c, { emailIds: chunk.join(',') }, userId);
			}
			return;
		}

		if (action.type === 'markRead') {
			for (const chunk of chunks) {
				await emailService.read(c, { emailIds: chunk }, userId);
			}
			return;
		}

		if (action.type === 'categorize') {
			for (const chunk of chunks) {
				await orm(c).update(email).set({ category: action.category }).where(
					and(eq(email.userId, userId), inArray(email.emailId, chunk))
				).run();
			}
			return;
		}

		if (action.type === 'star') {
			for (const chunk of chunks) {
				await this.batchStar(c, userId, chunk);
			}
		}
	},

	async batchStar(c, userId, emailIds) {
		const owned = await orm(c).select({ emailId: email.emailId }).from(email).where(
			and(
				eq(email.userId, userId),
				eq(email.isDel, isDel.NORMAL),
				inArray(email.emailId, emailIds)
			)
		).all();

		const ownedIds = owned.map(row => row.emailId);

		if (!ownedIds.length) {
			return;
		}

		const existed = await orm(c).select({ emailId: star.emailId }).from(star).where(
			and(eq(star.userId, userId), inArray(star.emailId, ownedIds))
		).all();

		const existedSet = new Set(existed.map(row => row.emailId));
		const values = ownedIds.filter(emailId => !existedSet.has(emailId)).map(emailId => ({ userId, emailId }));

		if (values.length) {
			await orm(c).insert(star).values(values).run();
		}
	},

	//逐封让模型判断分类, 只处理"未分类"的收件邮件
	async autoCategorize(c, userId, filter, options) {
		const conditions = this.buildConditions(userId, { ...filter, category: emailConst.category.NONE, type: 'receive' });

		const rows = await orm(c).select({
			emailId: email.emailId,
			subject: email.subject,
			sendEmail: email.sendEmail,
			text: email.text,
			content: email.content
		}).from(email).where(and(...conditions)).orderBy(desc(email.emailId)).limit(AUTO_CATEGORIZE_LIMIT).all();

		let updated = 0;

		for (const batch of this.chunk(rows, AUTO_CATEGORIZE_CONCURRENCY)) {
			//用户显式要求归类, 这里临时打开分类开关, 不受收件自动分类总开关限制
			const classifyOptions = { ...options, aiCategory: settingConst.aiCategory.OPEN };

			const categories = await Promise.all(batch.map(row => aiService.classifyEmail(c, {
				subject: row.subject,
				from: { address: row.sendEmail },
				text: row.text,
				html: row.content
			}, classifyOptions)));

			for (let i = 0; i < batch.length; i++) {
				const category = categories[i];

				if (category === emailConst.category.NONE) {
					continue;
				}

				await orm(c).update(email).set({ category }).where(
					and(eq(email.userId, userId), eq(email.emailId, batch[i].emailId))
				).run();

				updated++;
			}
		}

		return { matched: rows.length, updated };
	},

	//把模型返回的 actions 解析成带数量与样本的操作计划
	async resolveActions(c, userId, rawActions) {
		const actions = [];

		for (const raw of rawActions.slice(0, 10)) {
			const action = this.normalizeAction(raw);

			if (!action) {
				continue;
			}

			if (CREATE_ACTION_TYPES.includes(action.type)) {
				//批量建号/建邮箱不看邮件, 数量受设置与角色上限约束
				const max = action.type === 'addEmails' ? await this.addEmailQuota(c, userId) : MAX_BULK_COUNT;
				const total = Math.min(action.count, max);

				actions.push({ ...action, filter: {}, count: total, limited: total < action.count, samples: [] });
				continue;
			}

			if (DELETE_TARGET_TYPES.includes(action.type)) {
				//删除类先在计划阶段把实际能删到的目标查出来, 让用户在确认前看到影响范围
				const rows = action.type === 'deleteEmails'
					? await this.resolveDeleteEmails(c, userId, action)
					: await this.resolveDeleteUsers(c, userId, action);

				actions.push({
					...action,
					filter: {},
					count: rows.length,
					limited: rows.length >= (action.count || MAX_BULK_COUNT),
					samples: rows.slice(0, SAMPLE_SIZE).map(row => ({ email: row.email }))
				});
				continue;
			}

			const filter = action.type === 'autoCategorize'
				? { ...action.filter, category: emailConst.category.NONE, type: 'receive' }
				: action.filter;

			const { total, samples } = await this.resolveIds(c, userId, filter, MAX_EMAILS);

			actions.push({
				...action,
				filter,
				count: total,
				limited: total > MAX_EMAILS,
				samples
			});
		}

		return actions;
	},

	async resolveIds(c, userId, filter, limit) {
		const conditions = this.buildConditions(userId, filter);

		const [rows, totalRow] = await Promise.all([
			orm(c).select({
				emailId: email.emailId,
				subject: email.subject,
				sendEmail: email.sendEmail,
				category: email.category,
				createTime: email.createTime
			}).from(email).where(and(...conditions)).orderBy(desc(email.emailId)).limit(limit).all(),
			orm(c).select({ total: count() }).from(email).where(and(...conditions)).get()
		]);

		return {
			emailIds: rows.map(row => row.emailId),
			total: totalRow?.total || 0,
			samples: rows.slice(0, SAMPLE_SIZE).map(row => ({
				emailId: row.emailId,
				subject: row.subject,
				sendEmail: row.sendEmail,
				category: row.category,
				createTime: row.createTime
			}))
		};
	},

	buildConditions(userId, filter) {
		const conditions = [
			eq(email.userId, userId),
			eq(email.isDel, isDel.NORMAL)
		];

		const type = filter.type || 'receive';

		if (type === 'receive') {
			conditions.push(eq(email.type, emailConst.type.RECEIVE));
		} else if (type === 'send') {
			conditions.push(eq(email.type, emailConst.type.SEND));
		}

		if (Number.isInteger(filter.category)) {
			conditions.push(eq(email.category, filter.category));
		}

		if (filter.unread === true) {
			conditions.push(eq(email.unread, emailConst.unread.UNREAD));
		} else if (filter.unread === false) {
			conditions.push(eq(email.unread, emailConst.unread.READ));
		}

		if (filter.hasAtt === true) {
			conditions.push(sql`EXISTS (SELECT 1 FROM attachments a WHERE a.email_id = ${email.emailId} AND a.type = ${attConst.type.ATT})`);
		}

		if (filter.subject) {
			conditions.push(sql`${email.subject} COLLATE NOCASE LIKE ${'%' + filter.subject + '%'}`);
		}

		if (filter.from) {
			conditions.push(sql`${email.sendEmail} COLLATE NOCASE LIKE ${'%' + filter.from + '%'}`);
		}

		if (filter.startTime) {
			conditions.push(gte(email.createTime, filter.startTime));
		}

		if (filter.endTime) {
			conditions.push(lte(email.createTime, filter.endTime));
		}

		return conditions;
	},

	normalizeAction(action) {
		if (!action || typeof action !== 'object') {
			return null;
		}

		const type = String(action.type || '').trim();

		if (!ACTION_TYPES.includes(type)) {
			return null;
		}

		let category = null;
		let count = null;
		let prefix = '';
		let keyword = '';
		let status = null;
		const isDelete = DELETE_TARGET_TYPES.includes(type);

		if (type === 'categorize') {
			category = Number(action.category);

			if (!Number.isInteger(category) || category < 1 || category > 5) {
				return null;
			}
		}

		if (CREATE_ACTION_TYPES.includes(type)) {
			count = Number(action.count);

			//创建类没给数量就直接丢弃, 避免误建
			if (!Number.isInteger(count) || count < 1) {
				return null;
			}

			count = Math.min(count, MAX_BULK_COUNT);
			prefix = this.normalizePrefix(action.prefix);
		}

		if (isDelete) {
			keyword = String(action.keyword || '').trim().toLowerCase().replace(/[%_]/g, '').slice(0, 50);

			//count 省略表示尽量多删, 给了就按给的来
			if (action.count !== undefined && action.count !== null && action.count !== '') {
				count = Number(action.count);

				if (!Number.isInteger(count) || count < 1) {
					return null;
				}

				count = Math.min(count, MAX_BULK_COUNT);
			}

			if (type === 'deleteUsers' && action.status !== undefined && action.status !== null && action.status !== '') {
				status = Number(action.status);

				if (status !== userConst.status.NORMAL && status !== userConst.status.BAN) {
					return null;
				}
			}

			//既没关键词也没数量时无法确定要删什么, 丢弃后由模型在对话里追问
			if (!keyword && !count) {
				return null;
			}
		}

		return {
			type,
			category,
			count,
			prefix,
			keyword,
			status,
			filter: this.normalizeFilter(action.filter),
			description: String(action.description || '').slice(0, 200)
		};
	},

	//邮箱前缀只保留小写字母、数字与 . _ -
	normalizePrefix(prefix) {
		return String(prefix || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 20);
	},

	normalizeFilter(filter) {
		const raw = filter && typeof filter === 'object' ? filter : {};
		const result = {};

		if (['receive', 'send', 'all'].includes(raw.type)) {
			result.type = raw.type;
		}

		const category = Number(raw.category);

		if (Number.isInteger(category) && category >= 0 && category <= 5) {
			result.category = category;
		}

		if (typeof raw.unread === 'boolean') {
			result.unread = raw.unread;
		}

		if (raw.hasAtt === true) {
			result.hasAtt = true;
		}

		if (raw.subject) {
			result.subject = String(raw.subject).slice(0, 100);
		}

		if (raw.from) {
			result.from = String(raw.from).slice(0, 100);
		}

		if (raw.startTime) {
			result.startTime = String(raw.startTime).slice(0, 19);
		}

		if (raw.endTime) {
			result.endTime = String(raw.endTime).slice(0, 19);
		}

		return result;
	},

	//给模型一点邮箱概况, 便于它生成合理的计划
	async buildStats(c, userId) {
		const rows = await orm(c).select({
			category: email.category,
			unread: email.unread,
			total: count()
		}).from(email).where(
			and(
				eq(email.userId, userId),
				eq(email.type, emailConst.type.RECEIVE),
				eq(email.isDel, isDel.NORMAL)
			)
		).groupBy(email.category, email.unread).all();

		let total = 0;
		let unread = 0;
		const categoryCount = {};

		for (const row of rows) {
			total += row.total;
			if (row.unread === emailConst.unread.UNREAD) {
				unread += row.total;
			}
			categoryCount[row.category] = (categoryCount[row.category] || 0) + row.total;
		}

		const categoryText = Object.keys(categoryCount)
			.sort((a, b) => a - b)
			.map(key => `${CATEGORY_NAME[key] || '未知'} ${categoryCount[key]} 封`)
			.join(', ');

		return `收件共 ${total} 封(未读 ${unread} 封), 分类分布: ${categoryText || '暂无'}`;
	},

	async aiOptions(c) {
		const { aiBaseUrl, aiApiKey, aiModel } = await settingService.query(c);
		return { aiBaseUrl, aiApiKey, aiModel };
	},

	async canDelete(c, userId) {
		const user = c.get('user');

		if (user?.email && user.email === c.env.admin) {
			return true;
		}

		const permKeys = await permService.userPermKeys(c, userId);
		return permKeys.includes('*') || permKeys.includes('email:delete');
	},

	//管理员判定: 来自 ADMIN 邮箱, 或拥有指定权限(与对应路由的校验一致)
	async isAdmin(c, userId, permKey) {
		const userRow = await userService.selectById(c, userId);

		if (userRow?.email && userRow.email === c.env.admin) {
			return true;
		}

		const permKeys = await permService.userPermKeys(c, userId);
		return permKeys.includes('*') || permKeys.includes(permKey);
	},

	//按设置开关与角色上限算出本账户还能添加多少个邮箱
	async addEmailQuota(c, userId) {
		const { addEmail, manyEmail } = await settingService.query(c);

		if (!(addEmail === settingConst.addEmail.OPEN && manyEmail === settingConst.manyEmail.OPEN)) {
			return 0;
		}

		const userRow = await userService.selectById(c, userId);

		if (!userRow) {
			return 0;
		}

		//管理员不受角色数量限制
		if (userRow.email === c.env.admin) {
			return MAX_BULK_COUNT;
		}

		const roleRow = await roleService.selectById(c, userRow.type);

		//accountCount 为 0 表示不限制
		if (!roleRow || !roleRow.accountCount) {
			return MAX_BULK_COUNT;
		}

		const used = await accountService.countUserAccount(c, userId);
		return Math.max(0, Math.min(roleRow.accountCount - used, MAX_BULK_COUNT));
	},

	//为本账户批量添加邮箱, 地址由系统生成, 逐个插入避免一个失败拖垮整批
	async addEmails(c, userId, action) {
		const max = await this.addEmailQuota(c, userId);

		if (!max) {
			throw new BizError(t('addAccountDisabled'));
		}

		const emails = await this.genEmails(c, { count: Math.min(action.count, max), prefix: action.prefix, userId });
		const created = [];

		for (const address of emails) {
			try {
				await accountService.insert(c, { userId, email: address, name: emailUtils.getName(address) });
				created.push({ email: address });
			} catch (e) {
				console.error(`AI 助手添加邮箱失败: ${address} | ${e?.message || '(empty)'}`);
			}
		}

		if (!created.length) {
			throw new BizError(t('aiAgentNoAddress'));
		}

		return created;
	},

	//批量注册用户(仅管理员), 初始密码随机
	async registerUsers(c, action) {
		const emails = await this.genEmails(c, { count: action.count, prefix: action.prefix });
		const created = [];

		for (const address of emails) {
			const password = saltHashUtils.genRandomPwd(10);

			try {
				await userService.add(c, { email: address, password });
				created.push({ email: address, password });
			} catch (e) {
				console.error(`AI 助手注册用户失败: ${address} | ${e?.message || '(empty)'}`);
			}
		}

		if (!created.length) {
			throw new BizError(t('aiAgentNoAddress'));
		}

		return created;
	},

	//批量删除: 先按关键词/状态/数量挑出目标, 再逐个删, 一个失败不影响其余
	async deleteTargets(c, userId, action) {
		const rows = action.type === 'deleteEmails'
			? await this.resolveDeleteEmails(c, userId, action)
			: await this.resolveDeleteUsers(c, userId, action);
		const deleted = [];

		for (const row of rows) {
			try {
				if (action.type === 'deleteEmails') {
					await accountService.delete(c, { accountId: row.accountId }, userId);
				} else {
					await userService.delete(c, row.userId);
				}

				deleted.push({ email: row.email });
			} catch (e) {
				console.error(`AI 助手删除${action.type === 'deleteEmails' ? '邮箱' : '用户'}失败: ${row.email} | ${e?.message || '(empty)'}`);
			}
		}

		return deleted;
	},

	//挑出本账户下待删的邮箱: 主邮箱永不入选, 最近添加的优先
	async resolveDeleteEmails(c, userId, action) {
		const userRow = await userService.selectById(c, userId);

		if (!userRow) {
			return [];
		}

		const conditions = [
			eq(account.userId, userId),
			eq(account.isDel, isDel.NORMAL),
			ne(account.email, userRow.email)
		];

		if (action.keyword) {
			conditions.push(sql`${account.email} COLLATE NOCASE LIKE ${action.keyword + '%'}`);
		}

		return orm(c).select({ accountId: account.accountId, email: account.email }).from(account)
			.where(and(...conditions)).orderBy(desc(account.accountId))
			.limit(action.count || MAX_BULK_COUNT).all();
	},

	//挑出待删用户: 排除自己和 ADMIN 账号, 最近注册的优先
	async resolveDeleteUsers(c, userId, action) {
		const conditions = [
			eq(user.isDel, isDel.NORMAL),
			ne(user.userId, userId)
		];

		if (c.env.admin) {
			conditions.push(ne(user.email, c.env.admin));
		}

		if (action.keyword) {
			conditions.push(sql`${user.email} COLLATE NOCASE LIKE ${action.keyword + '%'}`);
		}

		if (action.status !== null) {
			conditions.push(eq(user.status, action.status));
		}

		return orm(c).select({ userId: user.userId, email: user.email }).from(user)
			.where(and(...conditions)).orderBy(desc(user.userId))
			.limit(action.count || MAX_BULK_COUNT).all();
	},

	//生成可用邮箱地址: 指定了前缀就"前缀+序号", 否则随机; 自动避开已占用与黑名单前缀
	async genEmails(c, { count, prefix, userId }) {
		const { minEmailPrefix, emailPrefixFilter } = await settingService.query(c);
		const banned = (Array.isArray(emailPrefixFilter) ? emailPrefixFilter : String(emailPrefixFilter || '').split(',')).filter(Boolean);
		const domain = await this.pickDomain(c, userId);

		if (!domain) {
			throw new BizError(t('notExistDomain'));
		}

		const names = [];
		const seen = new Set();

		for (let i = 0; names.length < count * 2 && i < count * 6; i++) {
			const name = prefix ? `${prefix}${i + 1}` : this.randomName();

			if (name.length < minEmailPrefix || seen.has(name) || banned.some(item => name.includes(item))) {
				continue;
			}

			seen.add(name);
			names.push(name);
		}

		if (!names.length) {
			return [];
		}

		const candidates = names.map(name => `${name}@${domain}`);
		const existed = await orm(c).select({ email: account.email }).from(account)
			.where(inArray(account.email, candidates)).all();
		const existedSet = new Set(existed.map(row => String(row.email).toLowerCase()));

		return candidates.filter(address => !existedSet.has(address.toLowerCase())).slice(0, count);
	},

	//选一个角色允许使用的域名, 没配域名权限就用第一个
	async pickDomain(c, userId) {
		const domains = Array.isArray(c.env.domain) ? c.env.domain.filter(Boolean) : [];

		if (!domains.length) {
			return '';
		}

		const userRow = userId ? await userService.selectById(c, userId) : null;
		const roleRow = userRow ? await roleService.selectById(c, userRow.type) : null;
		const avail = String(roleRow?.availDomain || '').split(',').filter(Boolean).map(item => item.toLowerCase());

		if (!avail.length) {
			return domains[0];
		}

		return domains.find(item => avail.includes(String(item).toLowerCase())) || '';
	},

	//随机前缀用字母开头, 避免出现纯数字的邮箱名
	randomName(length = 8) {
		const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
		const letters = 'abcdefghijklmnopqrstuvwxyz';
		const bytes = new Uint8Array(length - 1);
		crypto.getRandomValues(bytes);
		const body = Array.from(bytes).map(byte => chars[byte % chars.length]).join('');

		return letters[Math.floor(Math.random() * letters.length)] + body;
	},

	//配置了第三方 Key 走第三方, 否则走 Cloudflare Workers AI 绑定
	hasAi(c, options) {
		return !!(options.aiApiKey || c.env.ai);
	},

	chat(c, options, messages, maxTokens) {
		return options.aiApiKey
			? aiService.chatWithExternalAI(options, messages, maxTokens, AI_TIMEOUT_MS)
			: aiService.chatWithWorkersAI(c, messages, Math.min(maxTokens, WORKERS_AI_MAX_TOKENS));
	},

	isTimeoutError(e) {
		return e?.name === 'AbortError' || /超时|timeout/i.test(`${e?.message || ''}`);
	},

	parsePlan(content) {
		if (!content) {
			return null;
		}

		if (typeof content === 'object') {
			return content;
		}

		const str = String(content).trim()
			.replace(/^```(?:json)?/i, '')
			.replace(/```$/, '')
			.trim();

		let json = aiService.safeParse(str);

		if (!json) {
			const start = str.indexOf('{');
			const end = str.lastIndexOf('}');

			if (start > -1 && end > start) {
				json = aiService.safeParse(str.slice(start, end + 1));
			}
		}

		return json && typeof json === 'object' ? json : null;
	},

	chunk(list, size) {
		const result = [];

		for (let i = 0; i < list.length; i += size) {
			result.push(list.slice(i, i + size));
		}

		return result;
	}
};

export default aiAgentService;