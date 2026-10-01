import orm from '../entity/orm';
import aiMemory from '../entity/ai-memory';
import aiProfile from '../entity/ai-profile';
import { and, desc, eq, inArray, count } from 'drizzle-orm';
import aiService from './ai-service';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';
import dayjs from 'dayjs';

//单条记忆的长度上限
const MEMORY_CONTENT_MAX = 300;
//每个用户最多保留的记忆条数, 超出后丢弃最旧的
const MEMORY_MAX = 60;
//单轮对话最多新增的记忆条数
const MEMORY_ADD_MAX = 5;
//注入提示词的记忆条数上限
const MEMORY_PROMPT_MAX = 24;
//用户画像长度上限
const PROFILE_MAX = 1500;
//记忆类别
const MEMORY_CATEGORY = ['fact', 'preference', 'identity', 'contact', 'sendFrom', 'other'];
const MEMORY_CATEGORY_DESC = 'fact=关于主人的事实, preference=主人的偏好与习惯, identity=主人的身份信息(称呼/职业/所在地等), contact=主人常联系的人或邮箱, sendFrom=主人指定给鲸娘用的默认发件邮箱, other=其它';

const AI_TIMEOUT_MS = 120 * 1000;
const AI_MAX_TOKENS = 2048;
const WORKERS_AI_MAX_TOKENS = 1024;

const now = () => dayjs().format('YYYY-MM-DD HH:mm:ss');

//对话结束后从这一轮里抽取值得长期记住的信息, 并顺手更新用户画像
const MEMORY_EXTRACT_PROMPT = `你在维护一个邮件助手对"主人"的长期记忆。
根据最近这一轮对话, 抽出值得长期记住的新信息, 并据此更新用户画像。

只输出严格 JSON, 不要任何其它文字:
{"facts":[{"category":"fact","content":"一句话的中文事实"}],"profile":"更新后的用户画像"}

抽取规则:
- category 取值: ${MEMORY_CATEGORY_DESC}
- 只记主人自己说过、且长期有效的信息(称呼、身份、职业、所在地、偏好、习惯、常联系的人、重要日期、明确要求记住的事)。
- 不要记: 一次性的操作指令(如"删掉推广邮件")、临时话题、鲸娘自己说的话、任何密码或验证码。
- 主人明确指定了默认发件邮箱时, category 用 sendFrom, content 只填邮箱地址本身。
- 主人表达了对某个邮箱地址/联系人的固定称呼或关系时, category 用 contact, content 写成"张三 <zhangsan@example.com>"这种形式。
- 没有新信息时 facts 返回空数组。
- 最多 ${MEMORY_ADD_MAX} 条; 已存在的信息不要重复记录。
- 不要记录露骨、违法或敏感隐私内容。

画像规则:
- profile 是对主人的简短画像, 用第二人称"主人"来描述, 150 字以内, 2-4 句话。
- 只依据下面给出的"已有记忆"和本轮新增信息, 不要编造。
- 没有任何可依据的信息时, profile 返回空字符串。`;

const aiMemoryService = {

	//记忆列表 + 画像, 供前端记忆面板展示
	async detail(c, userId) {
		const [rows, profileRow] = await Promise.all([
			orm(c).select().from(aiMemory)
				.where(eq(aiMemory.userId, userId))
				.orderBy(desc(aiMemory.aiMemoryId))
				.all(),
			orm(c).select().from(aiProfile).where(eq(aiProfile.userId, userId)).get()
		]);

		return {
			profile: profileRow?.content || '',
			profileUpdateTime: profileRow?.updateTime || '',
			memories: rows.map(row => ({
				id: row.aiMemoryId,
				category: row.category,
				content: row.content,
				createTime: row.createTime
			}))
		};
	},

	async list(c, userId) {
		return orm(c).select().from(aiMemory)
			.where(eq(aiMemory.userId, userId))
			.orderBy(desc(aiMemory.aiMemoryId))
			.all();
	},

	//前端手动新增/修改记忆
	async save(c, params, userId) {
		const content = String(params?.content || '').trim().slice(0, MEMORY_CONTENT_MAX);

		if (!content) {
			throw new BizError(t('aiMemoryEmpty'));
		}

		const category = MEMORY_CATEGORY.includes(params?.category) ? params.category : 'fact';
		const id = Number(params?.id);

		if (Number.isInteger(id) && id > 0) {
			const row = await orm(c).select().from(aiMemory)
				.where(and(eq(aiMemory.aiMemoryId, id), eq(aiMemory.userId, userId)))
				.get();

			if (!row) {
				throw new BizError(t('aiMemoryNotExist'));
			}

			await orm(c).update(aiMemory).set({
				category,
				content,
				updateTime: now()
			}).where(and(eq(aiMemory.aiMemoryId, id), eq(aiMemory.userId, userId))).run();

			return { id, category, content };
		}

		const inserted = await orm(c).insert(aiMemory)
			.values({ userId, category, content })
			.returning()
			.get();

		return { id: inserted.aiMemoryId, category, content };
	},

	async remove(c, params, userId) {
		const ids = (Array.isArray(params?.ids) ? params.ids : [params?.id])
			.map(item => Number(item))
			.filter(item => Number.isInteger(item) && item > 0);

		if (!ids.length) {
			throw new BizError(t('aiMemoryEmpty'));
		}

		await orm(c).delete(aiMemory).where(and(eq(aiMemory.userId, userId), inArray(aiMemory.aiMemoryId, ids))).run();
	},

	async clear(c, userId) {
		await orm(c).delete(aiMemory).where(eq(aiMemory.userId, userId)).run();
		await orm(c).delete(aiProfile).where(eq(aiProfile.userId, userId)).run();
	},

	//前端手动保存画像
	async saveProfile(c, params, userId) {
		const content = String(params?.content || '').trim().slice(0, PROFILE_MAX);
		const { num } = await orm(c).select({ num: count() }).from(aiMemory).where(eq(aiMemory.userId, userId)).get();
		const memoryCount = num || 0;
		const exist = await orm(c).select().from(aiProfile).where(eq(aiProfile.userId, userId)).get();

		if (exist) {
			await orm(c).update(aiProfile).set({
				content,
				memoryCount,
				updateTime: now()
			}).where(eq(aiProfile.userId, userId)).run();
		} else {
			await orm(c).insert(aiProfile).values({ userId, content, memoryCount }).run();
		}

		return { profile: content };
	},

	//主人指定的默认发件邮箱: 取最近一条 sendFrom 记忆
	async senderDefault(c, userId) {
		const row = await orm(c).select().from(aiMemory)
			.where(and(eq(aiMemory.userId, userId), eq(aiMemory.category, 'sendFrom')))
			.orderBy(desc(aiMemory.aiMemoryId))
			.get();

		return row?.content || '';
	},

	//发信成功后把这次使用的发件邮箱记为默认, 下次主人不指定就直接用它
	async rememberSender(c, userId, address) {
		const content = String(address || '').trim().toLowerCase().slice(0, MEMORY_CONTENT_MAX);

		if (!content || !content.includes('@')) {
			return;
		}

		const exist = await orm(c).select().from(aiMemory)
			.where(and(eq(aiMemory.userId, userId), eq(aiMemory.category, 'sendFrom')))
			.orderBy(desc(aiMemory.aiMemoryId))
			.get();

		if (exist && exist.content === content) {
			return;
		}

		await orm(c).delete(aiMemory).where(and(eq(aiMemory.userId, userId), eq(aiMemory.category, 'sendFrom'))).run();
		await orm(c).insert(aiMemory).values({ userId, category: 'sendFrom', content }).run();
	},

	/*
	 * 把记忆与画像拼成提示词片段。
	 * 没有任何记忆时返回空串, 不占用模型上下文。
	 */
	async context(c, userId) {
		try {
			const [rows, profileRow] = await Promise.all([
				orm(c).select({ category: aiMemory.category, content: aiMemory.content })
					.from(aiMemory)
					.where(eq(aiMemory.userId, userId))
					.orderBy(desc(aiMemory.aiMemoryId))
					.limit(MEMORY_PROMPT_MAX)
					.all(),
				orm(c).select({ content: aiProfile.content }).from(aiProfile).where(eq(aiProfile.userId, userId)).get()
			]);

			if (!rows.length && !profileRow?.content) {
				return '';
			}

			const blocks = [];

			if (profileRow?.content) {
				blocks.push(`【主人画像】\n${profileRow.content}`);
			}

			if (rows.length) {
				//sendFrom 单独提示, 让模型知道默认用哪个邮箱发信
				const sender = rows.find(row => row.category === 'sendFrom');
				const others = rows.filter(row => row.category !== 'sendFrom');
				const lines = others.map(row => `- ${row.content}`);

				if (sender) {
					lines.unshift(`- 主人指定的默认发件邮箱: ${sender.content}`);
				}

				blocks.push(`【我记住的关于主人的事(可信, 可直接使用)】\n${lines.join('\n')}`);
			}

			return blocks.join('\n\n');
		} catch (e) {
			//记忆读取失败不能影响正常对话
			console.warn('读取 AI 记忆失败: ', e?.message || e);
			return '';
		}
	},

	//不在主流程里等待: 由调用方丢给 waitUntil 异步执行
	async extract(c, options, userId, userText, reply, extraHistory = []) {
		const text = String(userText || '').trim();

		//太短的输入基本没有可记的信息, 省一次模型调用
		if (text.length < 4) {
			return;
		}

		const existing = await this.list(c, userId);
		const memorized = existing.map(row => `- [${row.category}] ${row.content}`).join('\n');
		const history = extraHistory
			.filter(item => item?.content)
			.slice(-4)
			.map(item => `${item.role === 'user' ? '主人' : '鲸娘'}: ${String(item.content).slice(0, 300)}`)
			.join('\n');

		const messages = [
			{ role: 'system', content: MEMORY_EXTRACT_PROMPT },
			{
				role: 'user',
				content: `${history ? `最近对话:\n${history}\n\n` : ''}主人这轮说:\n${text.slice(0, 1500)}\n\n鲸娘的回复:\n${String(reply || '').slice(0, 800) || '(无)'}\n\n已有记忆:\n${memorized || '(还没有任何记忆)'}`
			}
		];

		const content = await this.chat(c, options, messages, AI_MAX_TOKENS);
		const parsed = this.parseJson(content);

		if (!parsed) {
			return;
		}

		const facts = Array.isArray(parsed.facts) ? parsed.facts : [];
		const added = await this.addFacts(c, userId, facts, existing);

		await this.saveExtractedProfile(c, userId, parsed.profile);

		return added;
	},

	//批量写入抽取出的记忆, 跳过重复项
	async addFacts(c, userId, facts, existing) {
		const seen = new Set(existing.map(row => String(row.content || '').trim().toLowerCase()));
		const values = [];

		for (const fact of facts.slice(0, MEMORY_ADD_MAX)) {
			const content = String(fact?.content || '').trim().slice(0, MEMORY_CONTENT_MAX);
			const key = content.toLowerCase();

			if (!content || seen.has(key)) {
				continue;
			}

			seen.add(key);
			values.push({
				userId,
				category: MEMORY_CATEGORY.includes(fact?.category) ? fact.category : 'fact',
				content
			});
		}

		if (!values.length) {
			return 0;
		}

		await orm(c).insert(aiMemory).values(values).run();
		await this.trim(c, userId);

		return values.length;
	},

	//超出上限时删掉最旧的记忆
	async trim(c, userId) {
		const { num } = await orm(c).select({ num: count() }).from(aiMemory).where(eq(aiMemory.userId, userId)).get();

		if (!num || num <= MEMORY_MAX) {
			return;
		}

		const extra = num - MEMORY_MAX;
		const oldRows = await orm(c).select({ id: aiMemory.aiMemoryId }).from(aiMemory)
			.where(eq(aiMemory.userId, userId))
			.orderBy(aiMemory.aiMemoryId)
			.limit(extra)
			.all();

		if (oldRows.length) {
			await orm(c).delete(aiMemory)
				.where(and(eq(aiMemory.userId, userId), inArray(aiMemory.aiMemoryId, oldRows.map(row => row.id))))
				.run();
		}
	},

	async saveExtractedProfile(c, userId, profile) {
		const content = String(profile || '').trim().slice(0, PROFILE_MAX);

		if (!content) {
			return;
		}

		const { num } = await orm(c).select({ num: count() }).from(aiMemory).where(eq(aiMemory.userId, userId)).get();
		const memoryCount = num || 0;
		const exist = await orm(c).select().from(aiProfile).where(eq(aiProfile.userId, userId)).get();

		if (exist) {
			await orm(c).update(aiProfile).set({
				content,
				memoryCount,
				updateTime: now()
			}).where(eq(aiProfile.userId, userId)).run();
		} else {
			await orm(c).insert(aiProfile).values({ userId, content, memoryCount }).run();
		}
	},

	//与邮件助手一致: 配了第三方 Key 走第三方, 否则走 Workers AI 绑定
	async chat(c, options, messages, maxTokens) {
		return options.aiApiKey
			? aiService.chatWithExternalAI(options, messages, maxTokens, AI_TIMEOUT_MS)
			: aiService.chatWithWorkersAI(c, messages, Math.min(maxTokens, WORKERS_AI_MAX_TOKENS));
	},

	parseJson(content) {
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
	}
};

export default aiMemoryService;
