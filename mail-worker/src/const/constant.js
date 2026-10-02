const constant = {
	TOKEN_HEADER: 'Authorization',
	JWT_UID: 'user_id:',
	JWT_TOKEN: 'token:',
	TOKEN_EXPIRE: 60 * 60 * 24 * 30,
	ATTACHMENT_PREFIX: 'attachments/',
	//网盘对象统一放在 drive/ 前缀下, 与邮件附件共用一个桶但互不干扰
	DRIVE_PREFIX: 'drive/',
	BACKGROUND_PREFIX: 'static/background/',
	LAYOUT_BACKGROUND_PREFIX: 'static/layout-background/',
	ADMIN_ROLE: {
		name: 'admin',
		sendCount: 0,
		sendType: 'count',
		accountCount: 0
	}
}

export default constant
