import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

//网盘的文件与文件夹共用一张表, 用 parent_id 表达层级
//对象 key 一经写入就不再变动, 重命名/移动只改这张表, 不必搬动存储对象
export const driveFile = sqliteTable('drive_file', {
	driveId: integer('drive_id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull(),
	//父文件夹 id, 0 表示根目录
	parentId: integer('parent_id').notNull().default(0),
	name: text('name').notNull(),
	//0 文件, 1 文件夹
	isDir: integer('is_dir').notNull().default(0),
	//对象存储中的 key, 文件夹为空串
	objectKey: text('object_key').notNull().default(''),
	size: integer('size').notNull().default(0),
	mimeType: text('mime_type').notNull().default(''),
	//AI 生成的标签, JSON 数组字符串
	tags: text('tags').notNull().default('[]'),
	//AI 生成的一句话摘要
	summary: text('summary').notNull().default(''),
	//上次 AI 打标签的时间, 空串表示还没整理过
	aiTime: text('ai_time').notNull().default(''),
	createTime: text('create_time').notNull().default(sql`CURRENT_TIMESTAMP`),
	updateTime: text('update_time').notNull().default(sql`CURRENT_TIMESTAMP`)
});

export default driveFile;