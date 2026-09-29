import settingService from './setting-service';
import orm from '../entity/orm';
import setting from '../entity/setting';

const storageService = {

	//轻量键值缓存: 有 R2 就用 R2, 没绑就回落到 KV
	async backend(c) {

		let useKvStorage;

		try {
			const row = await settingService.query(c);
			useKvStorage = row?.useKvStorage;
		} catch (e) {
			//初始化阶段 setting 还没写入存储, 直接读库拿标记, 避免自我依赖
			try {
				const row = await orm(c).select({ useKvStorage: setting.useKvStorage }).from(setting).get();
				useKvStorage = row?.useKvStorage;
			} catch (err) {
				useKvStorage = undefined;
			}
		}

		return useKvStorage ? 'KV' : 'R2';
	},

	async get(c, key, type) {

		const backend = await this.backend(c);

		if (backend === 'KV') {
			return await c.env.kv.get(key, type === 'json' ? { type: 'json' } : undefined);
		}

		const obj = await c.env.r2.get('cache/' + key);

		if (!obj) {
			return null;
		}

		const text = await obj.text();

		if (type === 'json') {
			try {
				return JSON.parse(text);
			} catch (e) {
				return null;
			}
		}

		return text;
	},

	//ttl 单位为秒, 与 KV 的 expirationTtl 保持一致
	async put(c, key, value, options = {}) {

		const backend = await this.backend(c);
		const text = typeof value === 'string' ? value : JSON.stringify(value);

		if (backend === 'KV') {
			await c.env.kv.put(key, text, options.expirationTtl ? { expirationTtl: options.expirationTtl } : undefined);
			return;
		}

		const customMetadata = {};

		if (options.metadata) {
			//R2 的 customMetadata 只接受字符串值, 非字符串一律序列化
			Object.keys(options.metadata).forEach(name => {
				const val = options.metadata[name];
				customMetadata[name] = val === undefined || val === null ? '' : (typeof val === 'string' ? val : JSON.stringify(val));
			});
		}

		//R2 没有过期时间, 把过期时间戳写进 customMetadata, 由定时任务回收
		if (options.expirationTtl) {
			customMetadata.expire = String(Date.now() + options.expirationTtl * 1000);
		}

		await c.env.r2.put('cache/' + key, text, {
			customMetadata,
			httpMetadata: { cacheControl: 'no-store' }
		});
	},

	async delete(c, keys) {

		const backend = await this.backend(c);
		const list = typeof keys === 'string' ? [keys] : keys;

		if (!list || list.length === 0) {
			return;
		}

		if (backend === 'KV') {
			await Promise.all(list.map(key => c.env.kv.delete(key)));
			return;
		}

		await c.env.r2.delete(list.map(key => 'cache/' + key));
	},

	async list(c, prefix) {

		const backend = await this.backend(c);

		if (backend === 'KV') {
			const keys = [];
			let cursor = undefined;

			do {
				const page = await c.env.kv.list({ prefix, cursor });
				page.keys.forEach(item => keys.push(item.name));
				cursor = page.list_complete ? undefined : page.cursor;
			} while (cursor);

			return keys;
		}

		const keys = [];
		let cursor = undefined;
		const full = 'cache/' + prefix;

		do {
			const page = await c.env.r2.list({ prefix: full, cursor });
			page.objects.forEach(item => keys.push(item.key.slice('cache/'.length)));
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);

		return keys;
	},

	//取带元数据的对象, 图片/附件读取沿用原 KV 逻辑
	async getWithMetadata(c, key, type) {

		const backend = await this.backend(c);

		if (backend === 'KV') {
			return await c.env.kv.getWithMetadata(key, type === 'arrayBuffer' ? { type: 'arrayBuffer' } : undefined);
		}

		const obj = await c.env.r2.get('cache/' + key);

		if (!obj) {
			return { value: null, metadata: null };
		}

		return { value: await obj.arrayBuffer(), metadata: obj.customMetadata || null };
	},

	//清理过期缓存: R2 没有 TTL, 撤销或过期的记录靠这里回收, cron 每小时跑一次
	async cleanup(c) {

		try {
			const setting = await settingService.query(c);

			if (setting.useKvStorage) {
				return;
			}

			const now = Date.now();
			let cursor = undefined;

			do {
				const page = await c.env.r2.list({ prefix: 'cache/', cursor });
				const expired = page.objects
					.filter(item => {
						const stamp = Number(item.customMetadata?.expire);
						return stamp && stamp < now;
					})
					.map(item => item.key);

				if (expired.length) {
					await c.env.r2.delete(expired);
				}

				cursor = page.truncated ? page.cursor : undefined;
			} while (cursor);
		} catch (e) {
			console.error('过期缓存清理失败: ', e?.message || e);
		}
	}

};

export default storageService;
