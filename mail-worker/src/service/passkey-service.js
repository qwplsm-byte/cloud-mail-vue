import {
	generateRegistrationOptions,
	verifyRegistrationResponse,
	generateAuthenticationOptions,
	verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { and, desc, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import orm from '../entity/orm';
import passkey from '../entity/passkey';
import settingService from './setting-service';
import userService from './user-service';
import loginService from './login-service';
import reqUtils from '../utils/req-utils';
import BizError from '../error/biz-error';
import KvConst from '../const/kv-const';
import { isDel, userConst } from '../const/entity-const';
import { t } from '../i18n/i18n';

//challenge 只在注册/登录过程中短时有效
const CHALLENGE_TTL = 5 * 60;

//设备备注名上限
const NAME_MAX = 60;

const passkeyService = {

	/* ---------------- 基础 ---------------- */

	now() {
		return new Date().toISOString().slice(0, 19).replace('T', ' ');
	},

	//通行密钥绑定的是网页来源(rpID 必须是其域名的后缀), 用浏览器带上的 Origin 推导
	origin(c) {
		return c.req.header('origin') || new URL(c.req.url).origin;
	},

	async rp(c) {
		const origin = this.origin(c);
		const { title } = await settingService.query(c);
		return { origin, rpID: new URL(origin).hostname, rpName: title || 'Cloud Mail' };
	},

	//WebAuthn 的用户句柄, 同一用户每次注册必须一致
	webauthnUserID(userId) {
		return new TextEncoder().encode(`u${userId}`);
	},

	//challenge 存 KV, 返回给前端一个 nonce, 验证时凭 nonce 取回并即刻作废
	async saveChallenge(c, data) {
		const nonce = uuidv4();
		await c.env.kv.put(KvConst.PASSKEY_CHALLENGE + nonce, JSON.stringify(data), { expirationTtl: CHALLENGE_TTL });
		return nonce;
	},

	async takeChallenge(c, nonce) {
		if (!nonce) {
			throw new BizError(t('passkeyChallengeExpired'));
		}

		const key = KvConst.PASSKEY_CHALLENGE + nonce;
		const data = await c.env.kv.get(key, { type: 'json' });

		if (!data) {
			throw new BizError(t('passkeyChallengeExpired'));
		}

		//一次性使用, 防止重放
		await c.env.kv.delete(key);
		return data;
	},

	parseTransports(transports) {
		if (!transports) {
			return undefined;
		}
		const list = transports.split(',').filter(Boolean);
		return list.length ? list : undefined;
	},

	//按 UA 给凭证起个默认备注名, 方便用户区分设备
	deviceName(c) {
		const { browser, os } = reqUtils.getUserAgent(c);
		return [os, browser].filter(Boolean).join(' ').trim().slice(0, NAME_MAX);
	},

	selectByUser(c, userId) {
		return orm(c).select().from(passkey)
			.where(eq(passkey.userId, userId))
			.orderBy(desc(passkey.passkeyId))
			.all();
	},

	//登录时不知道是谁, 只能凭 credential id 反查
	selectByCredentialId(c, credentialId) {
		return orm(c).select().from(passkey)
			.where(eq(passkey.credentialId, credentialId))
			.get();
	},

	/* ---------------- 注册 ---------------- */

	async registerOptions(c, userRow) {
		const { rpID, rpName } = await this.rp(c);
		const rows = await this.selectByUser(c, userRow.userId);

		const options = await generateRegistrationOptions({
			rpName,
			rpID,
			userName: userRow.email,
			userID: this.webauthnUserID(userRow.userId),
			userDisplayName: userRow.name || userRow.email,
			attestationType: 'none',
			//已经注册过的设备就别重复注册了
			excludeCredentials: rows.map(row => ({
				id: row.credentialId,
				transports: this.parseTransports(row.transports)
			})),
			authenticatorSelection: {
				//优先可发现凭据, 这样登录时不用先输邮箱
				residentKey: 'preferred',
				userVerification: 'preferred'
			}
		});

		const nonce = await this.saveChallenge(c, {
			type: 'register',
			userId: userRow.userId,
			challenge: options.challenge
		});

		return { options, nonce };
	},

	async registerVerify(c, userRow, params) {
		const { nonce, response, name } = params;

		const cached = await this.takeChallenge(c, nonce);

		if (cached.type !== 'register' || cached.userId !== userRow.userId) {
			throw new BizError(t('passkeyChallengeExpired'));
		}

		const { origin, rpID } = await this.rp(c);

		let verified;
		try {
			verified = await verifyRegistrationResponse({
				response,
				expectedChallenge: cached.challenge,
				expectedOrigin: origin,
				expectedRPID: rpID
			});
		} catch (e) {
			console.error(`通行密钥注册校验失败: ${e?.message || e}`);
			throw new BizError(t('passkeyRegisterFail'));
		}

		if (!verified.verified) {
			throw new BizError(t('passkeyRegisterFail'));
		}

		const { credential, aaguid } = verified.registrationInfo;

		//同一凭证不能重复绑定
		if (await this.selectByCredentialId(c, credential.id)) {
			throw new BizError(t('passkeyRegistered'));
		}

		const now = this.now();
		const remark = String(name || '').trim().slice(0, NAME_MAX) || this.deviceName(c);

		await orm(c).insert(passkey).values({
			userId: userRow.userId,
			credentialId: credential.id,
			publicKey: isoBase64URL.fromBuffer(credential.publicKey),
			counter: credential.counter || 0,
			transports: (credential.transports || []).join(','),
			aaguid: aaguid || '',
			name: remark,
			lastUsedTime: '',
			createTime: now,
			updateTime: now
		}).run();

		return { name: remark };
	},

	/* ---------------- 登录 ---------------- */

	async loginOptions(c) {
		const { rpID } = await this.rp(c);

		//不给 allowCredentials, 走"可发现凭据": 用户点一下就能从设备上选一个通行密钥
		const options = await generateAuthenticationOptions({
			rpID,
			userVerification: 'preferred'
		});

		const nonce = await this.saveChallenge(c, {
			type: 'login',
			challenge: options.challenge
		});

		return { options, nonce };
	},

	async loginVerify(c, params) {
		const { nonce, response } = params;

		const cached = await this.takeChallenge(c, nonce);

		if (cached.type !== 'login' || !response?.id) {
			throw new BizError(t('passkeyChallengeExpired'));
		}

		const row = await this.selectByCredentialId(c, response.id);

		if (!row) {
			throw new BizError(t('passkeyNotExist'));
		}

		const { origin, rpID } = await this.rp(c);

		let verified;
		try {
			verified = await verifyAuthenticationResponse({
				response,
				expectedChallenge: cached.challenge,
				expectedOrigin: origin,
				expectedRPID: rpID,
				credential: {
					id: row.credentialId,
					publicKey: isoBase64URL.toBuffer(row.publicKey),
					counter: row.counter,
					transports: this.parseTransports(row.transports)
				}
			});
		} catch (e) {
			console.error(`通行密钥登录校验失败: ${e?.message || e}`);
			throw new BizError(t('passkeyVerifyFail'));
		}

		if (!verified.verified) {
			throw new BizError(t('passkeyVerifyFail'));
		}

		const userRow = await userService.selectByIdIncludeDel(c, row.userId);

		if (!userRow || userRow.isDel === isDel.DELETE) {
			throw new BizError(t('isDelUser'));
		}

		if (userRow.status === userConst.status.BAN) {
			throw new BizError(t('isBanUser'));
		}

		//计数器只增不减, 回退说明凭证可能被复制过
		const now = this.now();
		await orm(c).update(passkey).set({
			counter: verified.authenticationInfo.newCounter ?? row.counter,
			lastUsedTime: now,
			updateTime: now
		}).where(eq(passkey.passkeyId, row.passkeyId)).run();

		return await loginService.issueToken(c, userRow);
	},

	/* ---------------- 管理 ---------------- */

	async list(c, userId) {
		const rows = await this.selectByUser(c, userId);

		return {
			items: rows.map(row => ({
				id: row.passkeyId,
				name: row.name,
				createTime: row.createTime,
				lastUsedTime: row.lastUsedTime
			}))
		};
	},

	async rename(c, userId, params) {
		const id = Number(params.id);
		const name = String(params.name || '').trim();

		if (!name) {
			throw new BizError(t('passkeyNameRequired'));
		}

		if (name.length > NAME_MAX) {
			throw new BizError(t('passkeyNameTooLong'));
		}

		await orm(c).update(passkey).set({ name, updateTime: this.now() })
			.where(and(eq(passkey.passkeyId, id), eq(passkey.userId, userId)))
			.run();

		return { name };
	},

	async remove(c, userId, params) {
		const id = Number(params.id);

		await orm(c).delete(passkey)
			.where(and(eq(passkey.passkeyId, id), eq(passkey.userId, userId)))
			.run();
	}

};

export default passkeyService;