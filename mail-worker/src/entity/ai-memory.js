import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

//AI 记忆: 一条记录是主人提过的一件事, 按用户隔离
export const aiMemory = sqliteTable('ai_memory', {
	aiMemoryId: integer('ai_memory_id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull(),
	//记忆类别: fact=事实, preference=偏好, identity=身份信息, contact=联系人, sendFrom=默认发件邮箱, other=其它
	category: text('category').notNull().default('fact'),
	content: text('content').notNull(),
	createTime: text('create_time').notNull().default(sql`CURRENT_TIMESTAMP`),
	updateTime: text('update_time').notNull().default(sql`CURRENT_TIMESTAMP`)
});

export default aiMemory;
