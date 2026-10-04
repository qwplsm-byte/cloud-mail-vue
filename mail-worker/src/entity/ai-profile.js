import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

//用户画像: 每个用户一条, 由 AI 记忆归纳而来, 新会话时注入提示词让爱蜜莉雅"记得主人"
export const aiProfile = sqliteTable('ai_profile', {
	userId: integer('user_id').primaryKey(),
	content: text('content').notNull().default(''),
	//生成画像时参考的记忆条数, 便于判断画像是否需要重建
	memoryCount: integer('memory_count').notNull().default(0),
	updateTime: text('update_time').notNull().default(sql`CURRENT_TIMESTAMP`)
});

export default aiProfile;
