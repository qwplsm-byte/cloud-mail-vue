import orm from '../entity/orm';
import email from '../entity/email';
import { star } from '../entity/star';
import { attConst, emailConst, isDel, settingConst } from '../const/entity-const';
import { and, desc, eq, inArray, count, gte, lte, sql } from 'drizzle-orm';
import emailService from './email-service';
import aiService from './ai-service';
import settingService from './setting-service';
import permService from './perm-service';
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

const ACTION_TYPES = ['delete', 'categorize', 'markRead', 'star', 'autoCategorize'];

const CATEGORY_NAME = {
	[emailConst.category.NONE]: '未分类',
	[emailConst.category.ACCOUNT]: '账号',
	[emailConst.category.NOTICE]: '通知',
	[emailConst.category.BILL]: '账单',
	[emailConst.category.PROMOTION]: '推广',
	[emailConst.category.OTHER]: '其他'
};

const SYSTEM_PROMPT = `你是一个邮件助手, 负责把用户的自然语言需求转换为对邮件的批量操作计划。
你只能使用以下 5 种操作类型, 不允许编造其它操作:
1. delete —— 删除邮件
2. categorize —— 把邮件归入指定分类, 必须同时给出 category
3. markRead —— 标记为已读
4. star —— 加星标
5. autoCategorize —— 让 AI 逐封判断并归类"未分类"的邮件(用户说"整理未分类邮件/把邮件归到合适的分类"时使用)

分类编号: 0=未分类, 1=账号, 2=通知, 3=账单, 4=推广, 5=其他

filter 字段的所有条件都是可选的, 省略表示不限制:
- type: "receive"(收件, 默认) | "send"(已发送) | "all"(收发都算)
- category: 0-5, 按分类筛选; 整理未分类邮件用 category: 0
- unread: true 表示只看未读, false 表示只看已读
- hasAtt: true 表示只看含附件的邮件
- subject: 主题关键词
- from: 发件人邮箱或域名关键词
- startTime / endTime: 时间范围, 格式 "YYYY-MM-DD" 或 "YYYY-MM-DD HH:mm:ss"

输出要求:
- 只输出一个 JSON 对象, 不要输出任何解释文字, 不要使用 markdown 代码块。
- 如果用户只是想了解或总结邮件, actions 返回空数组, 把答案写在 reply 中。
- 只使用用户明确提到的条件, 不要臆造筛选条件。
- 每个 action 都要有简短的 description(中文), 说明这条操作做什么。
- 涉及删除等不可恢复操作时, reply 中要明确提醒用户确认后再执行。
- reply 使用与用户输入相同的语言。

输出格式:
{"reply":"给用户的自然语言回复","actions":[{"type":"delete","description":"删除所有推广邮件","filter":{"category":4}}]}
需要指定分类时:
{"reply":"...","actions":[{"type":"categorize","category":2,"description":"把通知归类到通知分类","filter":{"category":0}}]}`;

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
		const dateInfo = `当前日期: ${dayjs().format('YYYY-MM-DD')}\n邮箱概览: ${stats}`;

		const messages = [
			{ role: 'system', content: SYSTEM_PROMPT },
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

		if (!parsed) {
			//模型没按格式返回时, 退化成纯文本回复, 不作为错误处理
			return { reply: String(content || '').trim() || t('aiAgentNoResult'), actions: [] };
		}

		const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
		const actions = await this.resolveActions(c, userId, Array.isArray(parsed.actions) ? parsed.actions : []);

		return { reply: reply || t('aiAgentNoResult'), actions };
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

		if (type === 'categorize') {
			category = Number(action.category);

			if (!Number.isInteger(category) || category < 1 || category > 5) {
				return null;
			}
		}

		return {
			type,
			category,
			filter: this.normalizeFilter(action.filter),
			description: String(action.description || '').slice(0, 200)
		};
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