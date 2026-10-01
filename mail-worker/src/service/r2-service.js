import s3Service from './s3-service';
import settingService from './setting-service';
import kvObjService from './kv-obj-service';
import domainUtils from '../utils/domain-uitls';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';

const r2Service = {

	//对象存储类型判定
	//auto: 沿用原有优先级 S3 > R2 > KV, 不改动既有行为
	//kv/r2/s3: 管理员在后台显式指定的类型
	async storageType(c) {

		const setting = await settingService.query(c);
		const { bucket, endpoint, s3AccessKey, s3SecretKey, storageType } = setting;

		if (storageType === 's3') {
			return 'S3';
		}

		if (storageType === 'r2') {
			return 'R2';
		}

		if (storageType === 'kv') {
			return 'KV';
		}

		if (!!(bucket && endpoint && s3AccessKey && s3SecretKey)) {
			return 'S3';
		}

		if (c.env.r2) {
			return 'R2';
		}

		return 'KV';
	},

	//R2 绑定是否已配置且可正常读写
	async r2Ready(c) {

		if (!c.env?.r2) {
			return false;
		}

		try {
			const key = '__r2_health__/' + Date.now();
			await c.env.r2.put(key, '1');
			await c.env.r2.delete(key);
			return true;
		} catch (e) {
			return false;
		}
	},

	//生成浏览器直传 R2 的预签名 PUT 地址
	//大文件(如 5GB 级视频)无法经过 Worker 中转, 必须由浏览器直传对象存储
	async presignPutUrl(c, key, expiresIn = 3600) {

		const storageType = await this.storageType(c);

		//直传写入的桶由 R2 绑定读取, 因此仅当生效类型为 R2 时才可用
		if (storageType !== 'R2') {
			throw new BizError(t('r2PresignOnlyR2'));
		}

		const { r2Endpoint, r2Bucket, r2AccessKey, r2SecretKey } = await settingService.query(c);

		if (!r2Endpoint || !r2Bucket || !r2AccessKey || !r2SecretKey) {
			throw new BizError(t('r2PresignNotConfigured'));
		}

		return await sigV4PresignPutUrl({
			endpoint: domainUtils.toOssDomain(r2Endpoint),
			bucket: r2Bucket,
			key,
			accessKeyId: r2AccessKey,
			secretAccessKey: r2SecretKey,
			expiresIn
		});
	},

	async putObj(c, key, content, metadata) {

		const storageType = await this.storageType(c);

		if (storageType === 'KV') {
			await kvObjService.putObj(c, key, content, metadata);
		}

		if (storageType === 'R2') {
			await c.env.r2.put(key, content, {
				httpMetadata: { ...metadata }
			});
		}

		if (storageType === 'S3') {
			await s3Service.putObj(c, key, content, metadata);
		}

	},

	async getObj(c, key) {
		const storageType = await this.storageType(c);

		if (storageType === 'KV') {
			return await kvObjService.getObj(c, key);
		}

		if (storageType === 'R2') {
			return await c.env.r2.get(key);
		}

		if (storageType === 'S3') {
			return await s3Service.getObj(c, key);
		}
	},

	async delete(c, key) {

		const storageType = await this.storageType(c);

		if (storageType === 'KV') {
			await kvObjService.deleteObj(c, key);
		}

		if (storageType === 'R2') {
			await c.env.r2.delete(key);
		}

		if (storageType === 'S3'){
			await s3Service.deleteObj(c, key);
		}

	},

	//对象访问响应: 按当前生效的存储类型读取
	//直传方案下大文件落在 R2, 必须由 R2 直接流式返回(支持 Range), 否则视频无法播放/拖动进度
	//R2 未命中时回退到 KV, 兼容切换存储前的历史数据
	async toObjResp(c, key) {

		const storageType = await this.storageType(c);

		if (storageType !== 'R2' || !c.env?.r2) {
			return await kvObjService.getObj(c, key);
		}

		const rangeHeader = c.req?.headers?.get?.('range');
		const matched = rangeHeader && /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());

		let offset;
		let length;
		let suffix;

		if (matched) {
			if (matched[1] === '' && matched[2] === '') {
				return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' } });
			}
			if (matched[1] === '') {
				suffix = Number(matched[2]);
			} else {
				offset = Number(matched[1]);
				length = matched[2] === '' ? undefined : Number(matched[2]) - offset + 1;
			}
		}

		const options = suffix != null
			? { range: { suffix } }
			: (offset != null ? { range: { offset, ...(length != null ? { length } : {}) } } : undefined);

		const obj = await c.env.r2.get(key, options);

		if (!obj?.body) {
			return await kvObjService.getObj(c, key);
		}

		const total = obj.size;
		const start = obj.range?.offset ?? offset ?? 0;
		const size = obj.range?.length ?? length ?? (total - start);
		const partial = !!matched && !!obj.range;

		const headers = {
			'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
			'Cache-Control': obj.httpMetadata?.cacheControl || 'public, max-age=31536000, immutable',
			'Accept-Ranges': 'bytes',
			'Content-Length': String(partial ? size : total)
		};

		if (obj.httpMetadata?.contentDisposition) {
			headers['Content-Disposition'] = obj.httpMetadata.contentDisposition;
		}

		if (partial) {
			headers['Content-Range'] = `bytes ${start}-${start + size - 1}/${total}`;
			return new Response(obj.body, { status: 206, headers });
		}

		return new Response(obj.body, { status: 200, headers });
	}

};

//—— S3 SigV4 预签名(不引入 aws-sdk, 避免 Worker 体积膨胀与依赖供应链校验)——
//仅签名 host, 因此浏览器 PUT 时可自由附加 Content-Type 等未签名头部

const encoder = new TextEncoder();

async function hmac(key, data) {
	const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data)));
}

function toHex(bytes) {
	return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data) {
	return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(data))));
}

//RFC3986 编码: 仅保留 A-Za-z0-9-_.~ , 路径模式下保留 '/'
function uriEncode(str, encodeSlash) {
	let out = '';
	for (const ch of str) {
		if (/[A-Za-z0-9\-_.~]/.test(ch)) {
			out += ch;
		} else if (ch === '/' && !encodeSlash) {
			out += ch;
		} else {
			for (const b of encoder.encode(ch)) {
				out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
			}
		}
	}
	return out;
}

async function sigV4PresignPutUrl({ endpoint, bucket, key, accessKeyId, secretAccessKey, region = 'auto', expiresIn = 3600 }) {

	const host = new URL(endpoint).host;
	const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
	const dateStamp = amzDate.slice(0, 8);
	const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

	const canonicalUri = `/${uriEncode(bucket, false)}/${uriEncode(key, false)}`;

	const params = {
		'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
		'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
		'X-Amz-Date': amzDate,
		'X-Amz-Expires': String(expiresIn),
		'X-Amz-SignedHeaders': 'host'
	};
	const canonicalQueryString = Object.keys(params).sort()
		.map(k => `${uriEncode(k, true)}=${uriEncode(params[k], true)}`).join('&');

	const canonicalRequest = [
		'PUT',
		canonicalUri,
		canonicalQueryString,
		`host:${host}\n`,
		'host',
		'UNSIGNED-PAYLOAD'
	].join('\n');

	const stringToSign = [
		'AWS4-HMAC-SHA256',
		amzDate,
		credentialScope,
		await sha256Hex(canonicalRequest)
	].join('\n');

	const kDate = await hmac(encoder.encode('AWS4' + secretAccessKey), dateStamp);
	const kRegion = await hmac(kDate, region);
	const kService = await hmac(kRegion, 's3');
	const kSigning = await hmac(kService, 'aws4_request');
	const signature = toHex(await hmac(kSigning, stringToSign));

	return `${new URL(endpoint).origin}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

export default r2Service;
