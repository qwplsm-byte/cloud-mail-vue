import orm from '../entity/orm';
import aiMessage from '../entity/ai-message';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import dayjs from 'dayjs';

//保留的对话消息条数, 与前端原本 localStorage 的上限一致
const CHAT_MAX = 40;
//单条消息正文长度上限
const CONTENT_MAX = 20000;
//附加字段(plan/results/sources 等)的 JSON 长度上限, 防止单条记录过大撑爆请求体
const PAYLOAD_MAX = 65536;
//消息 id 长度上限
const MSG_ID_MAX = 64;

const now = () => dayjs().format('YYYY-MM-DD HH:mm:ss');

const aiChatService = {

	//读取该用户全部对话, 按写入顺序返回, 供多设备同步
	async history(c, userId) {
		const rows = await orm(c).select().from(aiMessage)
			.where(eq(aiMessage.userId, userId))
			.orderBy(asc(aiMessage.aiMessageId))
			.all();

		return { messages: rows.map(row => this.toMessage(row)) };
	},

	toMessage(row) {
		let payload = {};

		try {
			payload = row.payload ? JSON.parse(row.payload) : {};
		} catch (e) {
			payload = {};
		}

		return {
			id: row.msgId,
			role: row.role,
			content: row.content || '',
			...payload,
			//刷新或换设备后不能停留在"进行中"状态
			loading: false,
			status: payload.status === 'executing' ? 'pending' : payload.status
		};
	},

	//整段对话 upsert: 同一 msgId 覆盖, 新 msgId 插入
	//多设备各自只追加自己的消息, 只增不删, 因此不会把对方的记录冲掉
	async save(c, userId, params) {
		const list = Array.isArray(params?.messages) ? params.messages : [];
		const values = [];

		for (const item of list.slice(-CHAT_MAX)) {
			const msgId = String(item?.id || '').slice(0, MSG_ID_MAX);

			if (!msgId) {
				continue;
			}

			const payload = JSON.stringify({
				plan: item.plan,
				status: item.status,
				results: item.results,
				error: item.error,
				sources: item.sources,
				searchFailed: item.searchFailed,
				attachments: item.attachments
			});

			values.push({
				userId,
				msgId,
				role: item.role === 'assistant' ? 'assistant' : 'user',
				content: String(item?.content ?? '').slice(0, CONTENT_MAX),
				payload: payload.slice(0, PAYLOAD_MAX)
			});
		}

		if (!values.length) {
			return;
		}

		await orm(c).insert(aiMessage).values(values)
			.onConflictDoUpdate({
				target: [aiMessage.userId, aiMessage.msgId],
				set: {
					role: sql`excluded.role`,
					content: sql`excluded.content`,
					payload: sql`excluded.payload`,
					updateTime: sql`excluded.update_time`
				}
			})
			.run();

		await this.trim(c, userId);
	},

	//超出上限时丢弃最旧的消息
	async trim(c, userId) {
		const { num } = await orm(c).select({ num: count() }).from(aiMessage).where(eq(aiMessage.userId, userId)).get();

		if (!num || num <= CHAT_MAX) {
			return;
		}

		const extra = num - CHAT_MAX;
		const oldRows = await orm(c).select({ id: aiMessage.aiMessageId }).from(aiMessage)
			.where(eq(aiMessage.userId, userId))
			.orderBy(asc(aiMessage.aiMessageId))
			.limit(extra)
			.all();

		if (oldRows.length) {
			await orm(c).delete(aiMessage)
				.where(and(eq(aiMessage.userId, userId), inArray(aiMessage.aiMessageId, oldRows.map(row => row.id))))
				.run();
		}
	},

	async clear(c, userId) {
		await orm(c).delete(aiMessage).where(eq(aiMessage.userId, userId)).run();
	}

};

export default aiChatService;
