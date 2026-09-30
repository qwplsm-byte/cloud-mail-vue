import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
	async presignPutUrl(c, key, contentType, expiresIn = 3600) {

		const storageType = await this.storageType(c);

		//直传写入的桶由 R2 绑定读取, 因此仅当生效类型为 R2 时才可用
		if (storageType !== 'R2') {
			throw new BizError(t('r2PresignOnlyR2'));
		}

		const { r2Endpoint, r2Bucket, r2AccessKey, r2SecretKey } = await settingService.query(c);

		if (!r2Endpoint || !r2Bucket || !r2AccessKey || !r2SecretKey) {
			throw new BizError(t('r2PresignNotConfigured'));
		}

		const client = new S3Client({
			region: 'auto',
			endpoint: domainUtils.toOssDomain(r2Endpoint),
			forcePathStyle: true,
			credentials: {
				accessKeyId: r2AccessKey,
				secretAccessKey: r2SecretKey
			}
		});

		const command = new PutObjectCommand({
			Bucket: r2Bucket,
			Key: key,
			ContentType: contentType || 'application/octet-stream'
		});

		return await getSignedUrl(client, command, { expiresIn });
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

	}

};
export default r2Service;
