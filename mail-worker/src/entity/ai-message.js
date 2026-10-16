import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

//AI 对话记录: 一条记录是一轮里的单条消息, 按用户隔离, 多设备登录同一账号时从服务端读取实现同步
export const aiMessage = sqliteTable('ai_message', {
	aiMessageId: integer('ai_message_id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull(),
	//前端生成的稳定消息 id, 同一用户下唯一, 用于多设备 upsert 合并
	msgId: text('msg_id').notNull(),
	role: text('role').notNull().default('user'),
	content: text('content').notNull().default(''),
	//plan/status/results/sources 等附加字段, 以 JSON 存放, 保持前端消息结构
	payload: text('payload').notNull().default(''),
	createTime: text('create_time').notNull().default(sql`CURRENT_TIMESTAMP`),
	updateTime: text('update_time').notNull().default(sql`CURRENT_TIMESTAMP`)
});

export default aiMessage;
