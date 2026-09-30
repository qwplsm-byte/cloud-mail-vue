import s3Service from './s3-service';
import settingService from './setting-service';
import kvObjService from './kv-obj-service';

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
