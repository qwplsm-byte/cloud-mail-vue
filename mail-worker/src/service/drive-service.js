import orm from '../entity/orm';
import { driveFile } from '../entity/drive-file';
import { and, eq, inArray, like, asc, desc } from 'drizzle-orm';
import r2Service from './r2-service';
import settingService from './setting-service';
import aiService from './ai-service';
import constant from '../const/constant';
import fileUtils from '../utils/file-utils';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';
import { v4 as uuidv4 } from 'uuid';

//根目录用 parent_id = 0 表示
const ROOT_ID = 0;

//搜索最多返回的条目数, 避免一次把整个盘拉出来
const SEARCH_LIMIT = 100;

//读取文本片段做 AI 分析的大小上限, 超过就只看文件名与类型
const SNIPPET_MAX = 128 * 1024;

//AI 归类时一次交给模型的文件数
const TIDY_BATCH = 20;

//单次 AI 请求超时, 避免慢模型把请求一直挂住
const AI_TIMEOUT_MS = 60 * 1000;

const TAG_PROMPT = '你是一个文件整理助手。根据文件名、类型(以及可能存在的内容片段)为文件生成 2 到 4 个简短的中文标签, 并写一句话摘要。标签是名词短语, 每个不超过 6 个字; 摘要不超过 30 字。只返回 JSON, 不要解释, 格式: {"tags":["标签1","标签2"],"summary":"一句话摘要"}。';

const TIDY_PROMPT = '你是一个文件整理助手。为每个文件选择或新建一个简短的分类文件夹名(2 到 6 个中文字), 并生成 2 到 4 个简短的中文标签。只返回 JSON 数组, 不要解释, 数组元素与输入行按顺序一一对应, 格式: [{"i":0,"folder":"文档","tags":["标签1"]}]。';

const driveService = {

	/* ---------------- 通用查询 ---------------- */

	toItem(row) {
		return {
			id: row.driveId,
			name: row.name,
			isDir: row.isDir === 1,
			size: row.size,
			mimeType: row.mimeType,
			tags: this.parseTags(row.tags),
			summary: row.summary,
			updateTime: row.updateTime
		};
	},

	parseTags(tags) {
		try {
			const list = JSON.parse(tags || '[]');
			return Array.isArray(list) ? list : [];
		} catch (e) {
			return [];
		}
	},

	//D1 里统一用 "YYYY-MM-DD HH:mm:ss" 存储, 与 CURRENT_TIMESTAMP 默认值一致
	now() {
		return new Date().toISOString().slice(0, 19).replace('T', ' ');
	},

	normalizeIds(ids) {
		if (!Array.isArray(ids)) {
			return [];
		}
		return [...new Set(ids.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0))];
	},

	normalizeName(name) {
		const value = String(name || '').trim();
		if (!value) {
			throw new BizError(t('driveNameRequired'));
		}
		if (/[/\\:*?"<>|]/.test(value)) {
			throw new BizError(t('driveNameInvalid'));
		}
		return value;
	},

	async selectById(c, id, userId) {
		if (!id) {
			return null;
		}
		const rows = await orm(c).select().from(driveFile)
			.where(and(eq(driveFile.driveId, id), eq(driveFile.userId, userId)))
			.all();
		return rows[0] || null;
	},

	selectByIds(c, ids, userId) {
		if (!ids.length) {
			return [];
		}
		return orm(c).select().from(driveFile)
			.where(and(eq(driveFile.userId, userId), inArray(driveFile.driveId, ids)))
			.all();
	},

	selectChildren(c, userId, parentId) {
		return orm(c).select().from(driveFile)
			.where(and(eq(driveFile.userId, userId), eq(driveFile.parentId, parentId)))
			//文件夹在前, 同类按名称排序
			.orderBy(desc(driveFile.isDir), asc(driveFile.name))
			.all();
	},

	//校验父目录存在且属于当前用户, 根目录直接放行
	async assertFolder(c, userId, parentId) {
		if (!parentId) {
			return null;
		}
		const dir = await this.selectById(c, parentId, userId);
		if (!dir || dir.isDir !== 1) {
			throw new BizError(t('driveFileNotExist'));
		}
		return dir;
	},

	async nameTaken(c, userId, parentId, name, excludeId = 0) {
		const rows = await orm(c).select().from(driveFile)
			.where(and(
				eq(driveFile.userId, userId),
				eq(driveFile.parentId, parentId),
				eq(driveFile.name, name)
			))
			.all();
		return rows.some(row => row.driveId !== excludeId);
	},

	//同名时自动加 " (n)" 后缀, 复制/上传/移动时避免覆盖
	async uniqueName(c, userId, parentId, name, excludeId = 0) {
		const ext = fileUtils.getExtFileName(name);
		const base = ext ? name.slice(0, name.length - ext.length) : name;
		let candidate = name;
		let index = 0;
		while (await this.nameTaken(c, userId, parentId, candidate, excludeId)) {
			index++;
			candidate = `${base} (${index})${ext}`;
		}
		return candidate;
	},

	objectKey(userId, name) {
		return constant.DRIVE_PREFIX + userId + '/' + uuidv4().replace(/-/g, '') + fileUtils.getExtFileName(name);
	},

	//文件名可能含中文, 用 RFC5987 编码, 浏览器才能正确落盘
	contentDisposition(name, download) {
		const encoded = encodeURIComponent(name).replace(/'/g, '%27');
		return `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encoded}`;
	},

	/* ---------------- 浏览 / 搜索 / 统计 ---------------- */

	async list(c, params, userId) {
		const parentId = Number(params.parentId || ROOT_ID);
		await this.assertFolder(c, userId, parentId);

		const rows = await this.selectChildren(c, userId, parentId);

		return {
			parentId,
			breadcrumb: await this.breadcrumb(c, userId, parentId),
			items: rows.map(row => this.toItem(row))
		};
	},

	async breadcrumb(c, userId, parentId) {
		const crumbs = [{ id: ROOT_ID, name: '' }];
		if (!parentId) {
			return crumbs;
		}

		const chain = [];
		let cur = parentId;
		let guard = 0;

		while (cur && guard++ < 64) {
			const row = await this.selectById(c, cur, userId);
			if (!row) {
				break;
			}
			chain.unshift({ id: row.driveId, name: row.name });
			cur = row.parentId;
		}

		return crumbs.concat(chain);
	},

	async search(c, keyword, userId) {
		const kw = String(keyword || '').trim();
		if (!kw) {
			return { items: [] };
		}

		const rows = await orm(c).select().from(driveFile)
			.where(and(eq(driveFile.userId, userId), like(driveFile.name, `%${kw}%`)))
			.orderBy(desc(driveFile.isDir), asc(driveFile.name))
			.limit(SEARCH_LIMIT)
			.all();

		//一次性取出层级信息, 拼接每个命中项的所在位置
		const map = await this.ownerMap(c, userId);

		return {
			items: rows.map(row => ({ ...this.toItem(row), path: this.buildPath(map, row.driveId) }))
		};
	},

	async ownerMap(c, userId) {
		const rows = await orm(c).select({
			id: driveFile.driveId,
			parentId: driveFile.parentId,
			name: driveFile.name
		}).from(driveFile).where(eq(driveFile.userId, userId)).all();

		const map = new Map();
		for (const row of rows) {
			map.set(row.id, row);
		}
		return map;
	},

	buildPath(map, id) {
		const names = [];
		let cur = id;
		let guard = 0;

		while (cur && guard++ < 64) {
			const row = map.get(cur);
			if (!row) {
				break;
			}
			names.unshift(row.name);
			cur = row.parentId;
		}

		return names.join(' / ');
	},

	async stats(c, userId) {
		const rows = await orm(c).select({ isDir: driveFile.isDir, size: driveFile.size })
			.from(driveFile).where(eq(driveFile.userId, userId)).all();

		let files = 0;
		let folders = 0;
		let size = 0;

		for (const row of rows) {
			if (row.isDir === 1) {
				folders++;
			} else {
				files++;
				size += row.size || 0;
			}
		}

		return { files, folders, size };
	},

	/* ---------------- 新建 / 上传 / 下载 ---------------- */

	async mkdir(c, params, userId) {
		const parentId = Number(params.parentId || ROOT_ID);
		const name = this.normalizeName(params.name);
		await this.assertFolder(c, userId, parentId);

		if (await this.nameTaken(c, userId, parentId, name)) {
			throw new BizError(t('driveNameExists'));
		}

		const now = this.now();
		await orm(c).insert(driveFile).values({
			userId,
			parentId,
			name,
			isDir: 1,
			objectKey: '',
			size: 0,
			mimeType: '',
			tags: '[]',
			summary: '',
			aiTime: '',
			createTime: now,
			updateTime: now
		}).run();

		return { name };
	},

	async upload(c, formData, userId) {
		const file = formData.get('file');

		if (!file || typeof file === 'string') {
			throw new BizError(t('driveUploadEmpty'));
		}

		const parentId = Number(formData.get('parentId') || ROOT_ID);
		await this.assertFolder(c, userId, parentId);

		const name = await this.uniqueName(c, userId, parentId, file.name || 'file');
		const buff = await file.arrayBuffer();
		const mimeType = file.type || 'application/octet-stream';
		const key = this.objectKey(userId, name);

		await r2Service.putObj(c, key, buff, {
			contentType: mimeType,
			contentDisposition: this.contentDisposition(name, true)
		});

		const now = this.now();
		const size = file.size || buff.byteLength;

		await orm(c).insert(driveFile).values({
			userId,
			parentId,
			name,
			isDir: 0,
			objectKey: key,
			size,
			mimeType,
			tags: '[]',
			summary: '',
			aiTime: '',
			createTime: now,
			updateTime: now
		}).run();

		return { name, size };
	},

	async file(c, id, userId) {
		const row = await this.selectById(c, Number(id), userId);

		if (!row || row.isDir === 1 || !row.objectKey) {
			throw new BizError(t('driveFileNotExist'));
		}

		const download = c.req.query('download') === '1';
		const res = await r2Service.toObjResp(c, row.objectKey);

		if (!res) {
			throw new BizError(t('driveFileNotExist'));
		}

		//重命名后展示最新文件名, 覆盖存储里写入时的旧名称
		const headers = new Headers(res.headers);
		headers.set('Content-Disposition', this.contentDisposition(row.name, download));

		return new Response(res.body, { status: res.status, headers });
	},

	/* ---------------- 重命名 / 移动 / 复制 / 删除 ---------------- */

	async rename(c, params, userId) {
		const row = await this.selectById(c, Number(params.id), userId);

		if (!row) {
			throw new BizError(t('driveFileNotExist'));
		}

		const name = this.normalizeName(params.name);

		if (name === row.name) {
			return { id: row.driveId, name };
		}

		if (await this.nameTaken(c, userId, row.parentId, name, row.driveId)) {
			throw new BizError(t('driveNameExists'));
		}

		await orm(c).update(driveFile).set({ name, updateTime: this.now() })
			.where(and(eq(driveFile.driveId, row.driveId), eq(driveFile.userId, userId)))
			.run();

		return { id: row.driveId, name };
	},

	//判断 nodeId 是否位于 ancestorId 之下(含自身)
	async isDescendant(c, userId, nodeId, ancestorId) {
		let cur = nodeId;
		let guard = 0;

		while (cur && guard++ < 64) {
			if (cur === ancestorId) {
				return true;
			}
			const row = await this.selectById(c, cur, userId);
			if (!row) {
				return false;
			}
			cur = row.parentId;
		}

		return false;
	},

	async move(c, params, userId) {
		const ids = this.normalizeIds(params.ids);
		if (!ids.length) {
			throw new BizError(t('driveNothing'));
		}

		const targetId = Number(params.targetId || ROOT_ID);
		await this.assertFolder(c, userId, targetId);

		const rows = await this.selectByIds(c, ids, userId);
		if (rows.length !== ids.length) {
			throw new BizError(t('driveFileNotExist'));
		}

		//不能把文件夹移动到自身或其子目录下, 否则会形成环
		for (const row of rows) {
			if (targetId === row.driveId || await this.isDescendant(c, userId, targetId, row.driveId)) {
				throw new BizError(t('driveMoveIntoSelf'));
			}
		}

		const now = this.now();

		for (const row of rows) {
			let name = row.name;
			if (await this.nameTaken(c, userId, targetId, name, row.driveId)) {
				name = await this.uniqueName(c, userId, targetId, name, row.driveId);
			}
			await orm(c).update(driveFile).set({ parentId: targetId, name, updateTime: now })
				.where(and(eq(driveFile.driveId, row.driveId), eq(driveFile.userId, userId)))
				.run();
		}

		return { count: rows.length };
	},

	async copy(c, params, userId) {
		const ids = this.normalizeIds(params.ids);
		if (!ids.length) {
			throw new BizError(t('driveNothing'));
		}

		const targetId = Number(params.targetId || ROOT_ID);
		await this.assertFolder(c, userId, targetId);

		const rows = await this.selectByIds(c, ids, userId);
		if (rows.length !== ids.length) {
			throw new BizError(t('driveFileNotExist'));
		}

		let count = 0;
		for (const row of rows) {
			count += await this.copyNode(c, userId, row, targetId);
		}

		return { count };
	},

	//递归复制: 文件夹复制整棵子树, 文件把对象另存为一份新副本
	async copyNode(c, userId, row, parentId) {
		const name = await this.uniqueName(c, userId, parentId, row.name);
		const now = this.now();

		if (row.isDir === 1) {
			await orm(c).insert(driveFile).values({
				userId,
				parentId,
				name,
				isDir: 1,
				objectKey: '',
				size: 0,
				mimeType: '',
				tags: row.tags,
				summary: row.summary,
				aiTime: row.aiTime,
				createTime: now,
				updateTime: now
			}).run();

			//名称在同一目录内唯一, 可据此取回新文件夹 id
			const created = await orm(c).select().from(driveFile)
				.where(and(
					eq(driveFile.userId, userId),
					eq(driveFile.parentId, parentId),
					eq(driveFile.name, name),
					eq(driveFile.isDir, 1)
				))
				.all();

			const newId = created[0]?.driveId;
			let count = 1;

			if (newId) {
				const children = await this.selectChildren(c, userId, row.driveId);
				for (const child of children) {
					count += await this.copyNode(c, userId, child, newId);
				}
			}

			return count;
		}

		const key = await this.copyObject(c, row.objectKey, userId, name, row.mimeType);

		await orm(c).insert(driveFile).values({
			userId,
			parentId,
			name,
			isDir: 0,
			objectKey: key,
			size: row.size,
			mimeType: row.mimeType,
			tags: row.tags,
			summary: row.summary,
			aiTime: row.aiTime,
			createTime: now,
			updateTime: now
		}).run();

		return 1;
	},

	async copyObject(c, sourceKey, userId, name, mimeType) {
		if (!sourceKey) {
			return '';
		}

		const obj = await r2Service.getObj(c, sourceKey);
		if (!obj) {
			throw new BizError(t('driveFileNotExist'));
		}

		const buff = obj instanceof ArrayBuffer ? obj : await obj.arrayBuffer();
		const key = this.objectKey(userId, name);

		await r2Service.putObj(c, key, buff, {
			contentType: mimeType || 'application/octet-stream',
			contentDisposition: this.contentDisposition(name, true)
		});

		return key;
	},

	async remove(c, params, userId) {
		const ids = this.normalizeIds(params.ids);
		if (!ids.length) {
			throw new BizError(t('driveNothing'));
		}

		const rows = await this.selectByIds(c, ids, userId);
		if (rows.length !== ids.length) {
			throw new BizError(t('driveFileNotExist'));
		}

		//文件夹要连同整棵子树一起删除
		const all = [];
		for (const row of rows) {
			await this.collectTree(c, userId, row, all);
		}

		const keys = all.filter(row => row.objectKey).map(row => row.objectKey);
		//对象存储批量删除单次有数量上限, 分批处理
		for (let i = 0; i < keys.length; i += 500) {
			await r2Service.delete(c, keys.slice(i, i + 500));
		}

		const allIds = all.map(row => row.driveId);
		//D1 单条语句的绑定变量有上限, 分批删除
		for (let i = 0; i < allIds.length; i += 90) {
			const chunk = allIds.slice(i, i + 90);
			await orm(c).delete(driveFile)
				.where(and(eq(driveFile.userId, userId), inArray(driveFile.driveId, chunk)))
				.run();
		}

		return { count: allIds.length };
	},

	async collectTree(c, userId, row, out) {
		out.push(row);

		if (row.isDir !== 1) {
			return;
		}

		const children = await this.selectChildren(c, userId, row.driveId);
		for (const child of children) {
			await this.collectTree(c, userId, child, out);
		}
	},

	/* ---------------- AI 能力 ---------------- */

	async assertAi(c) {
		const { aiApiKey } = await settingService.query(c);
		if (!aiApiKey && !c.env.ai) {
			throw new BizError(t('aiNotConfigured'));
		}
	},

	//配置了第三方 Key 走第三方, 否则走 Cloudflare Workers AI 绑定
	async chat(c, messages, maxTokens) {
		const { aiBaseUrl, aiApiKey, aiModel } = await settingService.query(c);
		const options = { aiBaseUrl, aiApiKey, aiModel };

		if (aiApiKey) {
			return aiService.chatWithExternalAI(options, messages, maxTokens, AI_TIMEOUT_MS);
		}

		return aiService.chatWithWorkersAI(c, messages, maxTokens);
	},

	//文本类小文件读一小段内容, 让标签更准确; 其余只看文件名与类型
	async readSnippet(c, row) {
		if (!row.objectKey || row.size > SNIPPET_MAX) {
			return '';
		}

		const mime = row.mimeType || '';
		const textLike = mime.startsWith('text/')
			|| mime.includes('json')
			|| mime.includes('xml')
			|| mime.includes('javascript')
			|| mime.includes('csv');

		if (!textLike) {
			return '';
		}

		try {
			const obj = await r2Service.getObj(c, row.objectKey);
			if (!obj) {
				return '';
			}
			const buff = obj instanceof ArrayBuffer ? obj : await obj.arrayBuffer();
			return new TextDecoder().decode(buff).slice(0, 2000);
		} catch (e) {
			return '';
		}
	},

	async autotag(c, params, userId) {
		const ids = this.normalizeIds(params.ids);
		if (!ids.length) {
			throw new BizError(t('driveNothing'));
		}

		await this.assertAi(c);

		const rows = (await this.selectByIds(c, ids, userId)).filter(row => row.isDir !== 1);
		if (!rows.length) {
			throw new BizError(t('driveNothing'));
		}

		let count = 0;
		for (const row of rows) {
			const meta = await this.analyzeFile(c, row);
			if (!meta) {
				continue;
			}

			const now = this.now();
			await orm(c).update(driveFile).set({
				tags: JSON.stringify(meta.tags),
				summary: meta.summary,
				aiTime: now,
				updateTime: now
			}).where(and(eq(driveFile.driveId, row.driveId), eq(driveFile.userId, userId)))
				.run();

			count++;
		}

		return { count };
	},

	async analyzeFile(c, row) {
		try {
			const snippet = await this.readSnippet(c, row);
			const messages = [
				{ role: 'system', content: TAG_PROMPT },
				{
					role: 'user',
					content: `文件名: ${row.name}\n类型: ${row.mimeType || '未知'}\n内容片段: ${snippet || '(未读取)'}`
				}
			];

			const content = await this.chat(c, messages, 200);
			const json = this.parseObject(content);
			if (!json) {
				return null;
			}

			const tags = Array.isArray(json.tags)
				? json.tags.map(tag => String(tag).trim()).filter(Boolean).slice(0, 5)
				: [];

			if (!tags.length) {
				return null;
			}

			return { tags, summary: String(json.summary || '').slice(0, 120) };
		} catch (e) {
			console.error(`网盘 AI 打标签失败 (${row.name}): ${e?.message || e}`);
			return null;
		}
	},

	async tidy(c, params, userId) {
		const ids = this.normalizeIds(params.ids);
		if (!ids.length) {
			throw new BizError(t('driveNothing'));
		}

		await this.assertAi(c);

		const rows = (await this.selectByIds(c, ids, userId)).filter(row => row.isDir !== 1);
		if (!rows.length) {
			throw new BizError(t('driveNothing'));
		}

		let count = 0;

		//分批请求模型: 一次给出多个文件的分类与标签, 减少调用次数
		for (let i = 0; i < rows.length; i += TIDY_BATCH) {
			const batch = rows.slice(i, i + TIDY_BATCH);
			const plans = await this.planTidy(c, batch);

			for (let j = 0; j < batch.length; j++) {
				const row = batch[j];
				const plan = plans[j] || {};

				const folderName = String(plan.folder || '其他').trim().slice(0, 20) || '其他';
				const tags = Array.isArray(plan.tags)
					? plan.tags.map(tag => String(tag).trim()).filter(Boolean).slice(0, 5)
					: [];

				const folderId = await this.ensureFolder(c, userId, folderName);
				if (!folderId) {
					continue;
				}

				let name = row.name;
				if (await this.nameTaken(c, userId, folderId, name, row.driveId)) {
					name = await this.uniqueName(c, userId, folderId, name, row.driveId);
				}

				const now = this.now();
				await orm(c).update(driveFile).set({
					parentId: folderId,
					name,
					tags: JSON.stringify(tags),
					aiTime: now,
					updateTime: now
				}).where(and(eq(driveFile.driveId, row.driveId), eq(driveFile.userId, userId)))
					.run();

				count++;
			}
		}

		return { count };
	},

	async planTidy(c, rows) {
		try {
			const list = rows.map((row, index) => `${index}. ${row.name} (${row.mimeType || '未知'})`).join('\n');
			const messages = [
				{ role: 'system', content: TIDY_PROMPT },
				{ role: 'user', content: list }
			];

			const content = await this.chat(c, messages, 600);
			const arr = this.parseArray(content);
			if (!arr) {
				return [];
			}

			//兼容模型把编号写成 i / index / id 的情况
			return arr.map((item, index) => {
				const pos = Number(item?.i ?? item?.index ?? index);
				return { pos, plan: item };
			}).sort((a, b) => a.pos - b.pos).map(item => item.plan);
		} catch (e) {
			console.error(`网盘 AI 归类失败: ${e?.message || e}`);
			return [];
		}
	},

	//在根目录按名称找分类文件夹, 没有就新建
	async ensureFolder(c, userId, name) {
		const rows = await orm(c).select().from(driveFile)
			.where(and(
				eq(driveFile.userId, userId),
				eq(driveFile.parentId, ROOT_ID),
				eq(driveFile.name, name),
				eq(driveFile.isDir, 1)
			))
			.all();

		if (rows[0]) {
			return rows[0].driveId;
		}

		const now = this.now();
		await orm(c).insert(driveFile).values({
			userId,
			parentId: ROOT_ID,
			name,
			isDir: 1,
			objectKey: '',
			size: 0,
			mimeType: '',
			tags: '[]',
			summary: '',
			aiTime: '',
			createTime: now,
			updateTime: now
		}).run();

		const created = await orm(c).select().from(driveFile)
			.where(and(
				eq(driveFile.userId, userId),
				eq(driveFile.parentId, ROOT_ID),
				eq(driveFile.name, name),
				eq(driveFile.isDir, 1)
			))
			.all();

		return created[0]?.driveId;
	},

	parseObject(content) {
		if (!content) {
			return null;
		}
		if (typeof content === 'object') {
			return content;
		}

		const str = String(content).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

		try {
			return JSON.parse(str);
		} catch (e) {
			//模型偶尔会在 JSON 前后带一句话, 截取第一段对象
		}

		const match = str.match(/\{[\s\S]*\}/);
		try {
			return match ? JSON.parse(match[0]) : null;
		} catch (e) {
			return null;
		}
	},

	parseArray(content) {
		if (!content) {
			return null;
		}
		if (Array.isArray(content)) {
			return content;
		}

		const str = String(content).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

		try {
			const parsed = JSON.parse(str);
			if (Array.isArray(parsed)) {
				return parsed;
			}
		} catch (e) {
			//继续尝试截取数组
		}

		const match = str.match(/\[[\s\S]*\]/);
		if (!match) {
			return null;
		}

		try {
			const parsed = JSON.parse(match[0]);
			return Array.isArray(parsed) ? parsed : null;
		} catch (e) {
			return null;
		}
	}
};

export default driveService;