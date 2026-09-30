import KvConst from '../const/kv-const';
import setting from '../entity/setting';
import orm from '../entity/orm';
import {verifyRecordType} from '../const/entity-const';
import fileUtils from '../utils/file-utils';
import r2Service from './r2-service';
import constant from '../const/constant';
import BizError from '../error/biz-error';
import {t} from '../i18n/i18n'
import verifyRecordService from './verify-record-service';
import userContext from '../security/user-context';
import domainUtils from '../utils/domain-uitls';

const settingService = {

	async refresh(c) {
		const settingRow = await orm(c).select().from(setting).get();
		settingRow.resendTokens = JSON.parse(settingRow.resendTokens);
		c.set('setting', settingRow);
		await c.env.kv.put(KvConst.SETTING, JSON.stringify(settingRow));
	},

	async query(c) {

		if (c.get?.('setting')) {
			return c.get('setting')
		}

		const setting = await c.env.kv.get(KvConst.SETTING, { type: 'json' });

		if (!setting) {
			throw new BizError('数据库未初始化 Database not initialized.');
		}

		let domainList = c.env.domain;

		if (typeof domainList === 'string') {
			try {
				domainList = JSON.parse(domainList)
			} catch (error) {
				throw new BizError(t('notJsonDomain'));
			}
		}

		if (!c.env.domain) {
			throw new BizError(t('noDomainVariable'));
		}

		domainList = domainList.map(item => '@' + item);
		setting.domainList = domainList;

		let projectLink = c.env.project_link;
		if (typeof projectLink === 'string' && projectLink === 'false') {
			projectLink = false
		} else if (projectLink === false) {
			projectLink = false
		} else {
			projectLink = true
		}

		setting.projectLink = projectLink;

		setting.emailPrefixFilter = setting.emailPrefixFilter.split(",").filter(Boolean);

		c.set?.('setting', setting);
		return setting;
	},

	async get(c, showSiteKey = false) {

		const [settingRow, recordList] = await Promise.all([
			await this.query(c),
			verifyRecordService.selectListByIP(c)
		]);


		if (!showSiteKey) {
			settingRow.siteKey = settingRow.siteKey ? `${settingRow.siteKey.slice(0, 6)}******` : null;
		}

		settingRow.secretKey = settingRow.secretKey ? `${settingRow.secretKey.slice(0, 6)}******` : null;

		Object.keys(settingRow.resendTokens).forEach(key => {
			settingRow.resendTokens[key] = `${settingRow.resendTokens[key].slice(0, 12)}******`;
		});

		settingRow.s3AccessKey = settingRow.s3AccessKey ? `${settingRow.s3AccessKey.slice(0, 12)}******` : null;
		settingRow.s3SecretKey = settingRow.s3SecretKey ? `${settingRow.s3SecretKey.slice(0, 12)}******` : null;
		settingRow.r2AccessKey = settingRow.r2AccessKey ? `${settingRow.r2AccessKey.slice(0, 12)}******` : null;
		settingRow.r2SecretKey = settingRow.r2SecretKey ? `${settingRow.r2SecretKey.slice(0, 12)}******` : null;
		settingRow.hasR2Presign = !!(settingRow.r2Endpoint && settingRow.r2Bucket && settingRow.r2AccessKey && settingRow.r2SecretKey);
		settingRow.tgBotToken = settingRow.tgBotToken ? `${settingRow.tgBotToken.slice(0, 20)}******` : null;
		settingRow.aiApiKey = settingRow.aiApiKey ? `${settingRow.aiApiKey.slice(0, 6)}******` : null;
		settingRow.hasR2 = !!c.env.r2
		settingRow.hasCfEmail = !!c.env.email

		let regVerifyOpen = false
		let addVerifyOpen = false

		recordList.forEach(row => {
			if (row.type === verifyRecordType.REG) {
				regVerifyOpen = row.count >= settingRow.regVerifyCount
			}
			if (row.type === verifyRecordType.ADD) {
				addVerifyOpen = row.count >= settingRow.addVerifyCount
			}
		})

		settingRow.regVerifyOpen = regVerifyOpen
		settingRow.addVerifyOpen = addVerifyOpen

		settingRow.storageType = settingRow.storageType || 'auto';
		settingRow.useStorageType = await r2Service.storageType(c);

		return settingRow;
	},

	async set(c, params) {
		const settingData = await this.query(c);
		let resendTokens = { ...settingData.resendTokens, ...params.resendTokens };
		Object.keys(resendTokens).forEach(domain => {
			if (!resendTokens[domain]) delete resendTokens[domain];
		});

		if (Array.isArray(params.emailPrefixFilter)) {
			params.emailPrefixFilter = params.emailPrefixFilter + '';
		}

		if (Array.isArray(params.aiCodeFilter)) {
			params.aiCodeFilter = params.aiCodeFilter + '';
		}

		if (params.webhookUrl !== undefined) {
			params.webhookUrl = domainUtils.toOssDomain(params.webhookUrl) || '';
		}

		//切换到 R2 前先确认绑定已配置且可用, 避免保存后上传全挂
		if (params.storageType === 'r2') {
			const ready = await r2Service.r2Ready(c);
			if (!ready) {
				throw new BizError(t('r2NotReady'));
			}
		}

		params.resendTokens = JSON.stringify(resendTokens);

		await orm(c).update(setting).set({ ...params }).returning().get();
		await this.refresh(c);
	},

	async deleteBackground(c) {

		const { background } = await this.query(c);
		if (!background) return

		if (background.startsWith('http')) {
			await orm(c).update(setting).set({ background: '' }).run();
			await this.refresh(c)
			return;
		}

		if (background) {
			await r2Service.delete(c,background)
			await orm(c).update(setting).set({ background: '' }).run();
			await this.refresh(c)
		}
	},

	async setBackground(c, params) {

		let { background } = params

		await this.deleteBackground(c);

		//直传场景: 前端已把文件直传到对象存储并把裸 key 传回, 无需再转 base64 上传
		if (this.isRawKey(background, constant.BACKGROUND_PREFIX)) {
			await orm(c).update(setting).set({ background }).run();
			await this.refresh(c);
			return background;
		}

		if (background && !background.startsWith('http')) {

			const file = fileUtils.base64ToFile(background)

			const arrayBuffer = await file.arrayBuffer();
			background = constant.BACKGROUND_PREFIX + await fileUtils.getBuffHash(arrayBuffer) + fileUtils.getExtFileName(file.name);


			await r2Service.putObj(c, background, arrayBuffer, {
				contentType: file.type,
				cacheControl: `public, max-age=31536000, immutable`,
				contentDisposition: `inline; filename="${file.name}"`
			});

		}

		await orm(c).update(setting).set({ background }).run();
		await this.refresh(c);
		return background;
	},

	async deleteLayoutBackground(c) {

		const { layoutBackground } = await this.query(c);
		if (!layoutBackground) return

		if (!layoutBackground.startsWith('http')) {
			await r2Service.delete(c, layoutBackground)
		}

		await orm(c).update(setting).set({ layoutBackground: '' }).run();
		await this.refresh(c)
	},

	//主界面背景: 支持图片/动图/视频, 外链直接存, 本地文件转存对象存储
	async setLayoutBackground(c, params) {

		let { layoutBackground } = params

		await this.deleteLayoutBackground(c);

		//直传场景: 前端已把文件直传到对象存储并把裸 key 传回, 无需再转 base64 上传
		if (this.isRawKey(layoutBackground, constant.LAYOUT_BACKGROUND_PREFIX)) {
			await orm(c).update(setting).set({ layoutBackground }).run();
			await this.refresh(c);
			return layoutBackground;
		}

		if (layoutBackground && !layoutBackground.startsWith('http')) {

			const file = fileUtils.base64ToFile(layoutBackground)

			const arrayBuffer = await file.arrayBuffer();
			layoutBackground = constant.LAYOUT_BACKGROUND_PREFIX + await fileUtils.getBuffHash(arrayBuffer) + fileUtils.getExtFileName(file.name);

			await r2Service.putObj(c, layoutBackground, arrayBuffer, {
				contentType: file.type,
				cacheControl: `public, max-age=31536000, immutable`,
				contentDisposition: `inline; filename="${file.name}"`
			});

		}

		await orm(c).update(setting).set({ layoutBackground }).run();
		await this.refresh(c);
		return layoutBackground;
	},

	//判断传入的是否为对象存储里已存在的裸 key(直传已完成), 而非 base64 或外链
	isRawKey(value, prefix) {
		return typeof value === 'string' && !value.startsWith('http') && value.startsWith(prefix);
	},

	//为浏览器直传生成预签名地址与最终对象 key
	//大文件(如 <5GB 视频)必须绕过 Worker 直传, 否则会被请求体大小限制拦截
	async presignUpload(c, params = {}) {

		const { filename, contentType } = params;

		if (!filename) {
			throw new BizError(t('r2PresignFileNameEmpty'));
		}

		const key = constant.LAYOUT_BACKGROUND_PREFIX + crypto.randomUUID().replace(/-/g, '') + fileUtils.getExtFileName(filename);
		const url = await r2Service.presignPutUrl(c, key, contentType);

		return { url, key };
	},

	async setBlacklist(c, params) {
		const { blackSubject, blackContent, blackFrom  } = params
		await orm(c).update(setting).set({ blackSubject, blackContent, blackFrom }).run();
		await this.refresh(c);
		return this.get(c);
	},

	async testAi(c, params = {}) {
		const settingData = await this.query(c);

		let baseUrl = (params.aiBaseUrl || settingData.aiBaseUrl || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
		const apiKey = params.aiApiKey || settingData.aiApiKey;
		const model = params.aiModel || settingData.aiModel || 'gpt-4o-mini';

		//接口地址漏写协议时自动补全
		if (!/^https?:\/\//i.test(baseUrl)) {
			baseUrl = `https://${baseUrl}`;
		}

		if (!apiKey) {
			return { success: false, message: 'API Key 未配置' };
		}

		const url = `${baseUrl}/chat/completions`;

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					model,
					messages: [{ role: 'user', content: 'ping' }],
					max_tokens: 1
				})
			});

			if (!response.ok) {
				const text = await response.text();
				return { success: false, message: `${response.status} ${text}`.slice(0, 300) };
			}

			const contentType = response.headers.get('content-type') || '';

			//只校验 ok 会把"接口地址填成官网首页"误判为成功, 必须确认返回的是 JSON
			if (!contentType.includes('json')) {
				const text = await response.text();
				return { success: false, message: `接口返回的不是 JSON(url=${url}, content-type=${contentType}), 请检查接口地址是否缺少 /v1: ${text.slice(0, 120)}`.slice(0, 400) };
			}

			return { success: true, message: 'ok' };
		} catch (e) {
			const detail = `请求失败 url=${url} model=${model} name=${e?.name || 'Error'} message=${e?.message || '(empty)'}`
				+ (e?.cause?.message || e?.cause ? ` cause=${e?.cause?.message || e?.cause}` : '');

			return { success: false, message: detail };
		}
	},

	async websiteConfig(c) {

		const settingRow = await this.get(c, true);
		const token = await userContext.getToken(c);

		return {
			register: settingRow.register,
			title: settingRow.title,
			manyEmail: settingRow.manyEmail,
			addEmail: settingRow.addEmail,
			autoRefresh: settingRow.autoRefresh,
			addEmailVerify: settingRow.addEmailVerify,
			registerVerify: settingRow.registerVerify,
			send: settingRow.send,
			r2Domain: settingRow.r2Domain,
			siteKey: settingRow.siteKey,
			background: settingRow.background,
			layoutBackground: settingRow.layoutBackground,
			layoutBackgroundMask: settingRow.layoutBackgroundMask,
			loginOpacity: settingRow.loginOpacity,
			domainList: settingRow.loginDomain === 1 && !token ? [] : settingRow.domainList,
			regKey: settingRow.regKey,
			regVerifyOpen: settingRow.regVerifyOpen,
			addVerifyOpen: settingRow.addVerifyOpen,
			noticeTitle: settingRow.noticeTitle,
			noticeContent: settingRow.noticeContent,
			noticeType: settingRow.noticeType,
			noticeDuration: settingRow.noticeDuration,
			noticePosition: settingRow.noticePosition,
			noticeWidth: settingRow.noticeWidth,
			noticeOffset: settingRow.noticeOffset,
			notice: settingRow.notice,
			loginDomain: settingRow.loginDomain,
			linuxdoClientId: settingRow.linuxdoClientId,
			linuxdoSwitch: settingRow.linuxdoSwitch,
			githubClientId: settingRow.githubClientId,
			githubSwitch: settingRow.githubSwitch,
			googleClientId: settingRow.googleClientId,
			googleSwitch: settingRow.googleSwitch,
			minEmailPrefix: settingRow.minEmailPrefix,
			projectLink: settingRow.projectLink
		};
	},

};

export default settingService;
