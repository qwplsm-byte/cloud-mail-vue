import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const passkey = sqliteTable('passkey', {
	passkeyId: integer('passkey_id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull(),
	//WebAuthn 凭证 id(base64url 字符串), 全局唯一, 登录时凭它反查用户
	credentialId: text('credential_id').notNull(),
	//凭证公钥(base64url), 验证签名时用
	publicKey: text('public_key').notNull(),
	//签名计数器, 用于发现凭证被复制
	counter: integer('counter').notNull().default(0),
	//可用的传输方式, 逗号分隔, 如 usb,nfc,internal
	transports: text('transports').notNull().default(''),
	aaguid: text('aaguid').notNull().default(''),
	//设备备注名, 如 iPhone / Windows Hello
	name: text('name').notNull().default(''),
	//最近一次用该凭证登录的时间, 空串表示还没用过
	lastUsedTime: text('last_used_time').notNull().default(''),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`),
	updateTime: text('update_time').default(sql`CURRENT_TIMESTAMP`)
});

export default passkey;