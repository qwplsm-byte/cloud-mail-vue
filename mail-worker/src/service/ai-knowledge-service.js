import BizError from '../error/biz-error';

//向量检索参数: 切片大小、召回条数、相似度阈值、注入上限(命中才注入, 未命中零成本)
const EMBED_MODEL = '@cf/baai/bge-m3';
const CHUNK_SIZE = 480;
const CHUNK_OVERLAP = 80;
const TOP_K = 3;
const SCORE_MIN = 0.45;
const INJECT_MAX = 1800;
const SNIPPET_MAX = 700;
const CACHE_DAYS = 14;
const FETCH_TIMEOUT_MS = 3000;

//Re:Zero 角色名: 提到这些名字时优先查萌娘/Fandom, 补角色卡里缺失的设定与经历
const CHARACTERS = [
	'爱蜜莉雅', '艾米莉娅', '雷姆', '拉姆', '菜月昴', '帕克', '罗兹瓦尔', '碧翠丝', '莎缇拉',
	'艾姬多娜', '莱茵哈鲁特', '菲鲁特', '库珥修', '安娜塔西亚', '普莉希拉', '加菲尔', '奥托',
	'佩特拉', '弗雷德莉卡', '艾尔莎', '梅莉', '罗姆爷', '威尔海姆', '尤里乌斯', '里卡多'
];

//知识类提问特征: 只有明确在问"某个东西是什么"时才走维基, 避免闲聊也发外部请求
const LOOKUP_HINTS = [
	'是谁', '是什么', '什么是', '哪年', '哪一年', '什么时候', '哪一天', '出生于', '出生', '诞生',
	'身高', '年龄', '生日', '声优', '作者', '小说', '动画', '结局', '剧情', '设定', '能力',
	'关系', '发生在', '位于', '首都', '人口', '历史', '介绍', '简介', '资料', '出自'
];

const UA = 'cloud-mail/1.0 (self-hosted webmail knowledge lookup)';

const aiKnowledgeService = {

	//文档入库: 先清旧向量再写新块, 保证编辑后不会召回过期内容
	async save(c, params) {
		const title = String(params?.title || '').trim().slice(0, 100);
		const content = String(params?.content || '').trim();
		const tags = String(params?.tags || '').trim().slice(0, 200);
		const source = String(params?.source || 'manual').trim().slice(0, 20);
		const enabled = Number(params?.enabled) === 0 ? 0 : 1;

		if (!title || !content) {
			throw new BizError('标题与内容不能为空');
		}

		const id = Number(params?.aiKnowledgeId) || 0;

		if (id) {
			await this.removeChunks(c, id);
			await c.env.db.prepare(
				'UPDATE ai_knowledge SET title = ?, content = ?, tags = ?, source = ?, enabled = ?, update_time = CURRENT_TIMESTAMP WHERE ai_knowledge_id = ?'
			).bind(title, content, tags, source, enabled, id).run();
		} else {
			await c.env.db.prepare(
				'INSERT INTO ai_knowledge (title, content, tags, source, enabled) VALUES (?, ?, ?, ?, ?)'
			).bind(title, content, tags, source, enabled).run();
		}

		const docId = id || await this.lastId(c, title);
		const chunkCount = enabled ? await this.indexChunks(c, docId, title, content, source) : 0;
		await c.env.db.prepare('UPDATE ai_knowledge SET chunk_count = ? WHERE ai_knowledge_id = ?').bind(chunkCount, docId).run();

		return { aiKnowledgeId: docId, chunkCount };
	},

	//D1 不支持 RETURNING, 按标题回查刚插入的 id
	async lastId(c, title) {
		const row = await c.env.db.prepare(
			'SELECT ai_knowledge_id FROM ai_knowledge WHERE title = ? ORDER BY ai_knowledge_id DESC LIMIT 1'
		).bind(title).first();

		return Number(row?.ai_knowledge_id) || 0;
	},

	async remove(c, id) {
		await this.removeChunks(c, id);
		await c.env.db.prepare('DELETE FROM ai_knowledge WHERE ai_knowledge_id = ?').bind(id).run();
	},

	//删除文档对应的切块与向量; 向量索引不存在时只清库, 关键词检索仍然可用
	async removeChunks(c, docId) {
		const rows = await c.env.db.prepare('SELECT chunk_id FROM ai_knowledge_chunk WHERE ai_knowledge_id = ?').bind(docId).all();
		const ids = (rows.results || []).map(item => item.chunk_id);

		if (ids.length && c.env.vectorize) {
			try {
				await c.env.vectorize.deleteByIds(ids);
			} catch (e) {
				console.warn(`删除知识库向量失败: ${e.message}`);
			}
		}

		await c.env.db.prepare('DELETE FROM ai_knowledge_chunk WHERE ai_knowledge_id = ?').bind(docId).run();
	},

	//切块 + 向量化 + 写入索引; 向量服务不可用时返回 0, 检索自动回落到关键词
	async indexChunks(c, docId, title, content, source) {
		const chunks = this.chunkText(content);

		if (!chunks.length) {
			return 0;
		}

		const rows = chunks.map((text, seq) => ({
			id: crypto.randomUUID(),
			docId,
			seq,
			text
		}));

		const statements = rows.map(item => c.env.db.prepare(
			'INSERT INTO ai_knowledge_chunk (chunk_id, ai_knowledge_id, seq, content) VALUES (?, ?, ?, ?)'
		).bind(item.id, docId, item.seq, item.text));
		await c.env.db.batch(statements);

		if (!c.env.vectorize) {
			return rows.length;
		}

		try {
			const vectors = await this.embed(c, rows.map(item => item.text));
			const payload = rows.map((item, index) => ({
				id: item.id,
				values: vectors[index],
				metadata: { docId, title, source }
			})).filter(item => Array.isArray(item.values) && item.values.length);

			if (payload.length) {
				await c.env.vectorize.upsert(payload);
			}
		} catch (e) {
			console.warn(`知识库向量化失败, 该文档只走关键词检索: ${e.message}`);
		}

		return rows.length;
	},

	//按段落滑窗切块, 相邻块保留少量重叠, 避免一句话被切断后语义丢失
	chunkText(text) {
		const clean = String(text || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();

		if (!clean) {
			return [];
		}

		const paragraphs = clean.split(/\n+/).map(item => item.trim()).filter(Boolean);
		const chunks = [];
		let buffer = '';

		for (const paragraph of paragraphs) {
			buffer = buffer ? `${buffer}\n${paragraph}` : paragraph;

			while (buffer.length > CHUNK_SIZE) {
				chunks.push(buffer.slice(0, CHUNK_SIZE).trim());
				buffer = buffer.slice(CHUNK_SIZE - CHUNK_OVERLAP);
			}
		}

		if (buffer.trim()) {
			chunks.push(buffer.trim());
		}

		return chunks.filter(item => item.length > 20);
	},

	async embed(c, texts) {
		const vectors = [];

		for (let i = 0; i < texts.length; i += 20) {
			const batch = texts.slice(i, i + 20);
			const result = await c.env.ai.run(EMBED_MODEL, { text: batch });
			const data = Array.isArray(result?.data) ? result.data : (result?.data ? [result.data] : []);
			const normalized = typeof data[0] === 'number' ? [data] : data;
			vectors.push(...normalized);
		}

		return vectors;
	},

	async list(c) {
		const rows = await c.env.db.prepare(
			'SELECT ai_knowledge_id, title, tags, source, enabled, chunk_count, update_time FROM ai_knowledge ORDER BY ai_knowledge_id DESC LIMIT 500'
		).all();

		return {
			vectorReady: !!c.env.vectorize,
			list: rows.results || []
		};
	},

	async detail(c, id) {
		return c.env.db.prepare('SELECT * FROM ai_knowledge WHERE ai_knowledge_id = ?').bind(id).first();
	},

	//检索入口: 命中才返回注入文本, 未命中返回空串(不占任何 token)
	async retrieve(c, prompt) {
		const query = String(prompt || '').trim();

		if (query.length < 2) {
			return '';
		}

		try {
			const local = c.env.vectorize ? await this.vectorSearch(c, query) : await this.keywordSearch(c, query);
			const external = await this.externalLookup(c, query, local.length);
			const snippets = [...local, ...(external ? [external] : [])];

			if (!snippets.length) {
				return '';
			}

			const body = snippets
				.map(item => `· ${item.title ? `${item.title}: ` : ''}${String(item.content || '').replace(/\s+/g, ' ').slice(0, SNIPPET_MAX)}`)
				.join('\n');

			return `【参考资料 · 只用于核对事实】\n${body.slice(0, INJECT_MAX)}\n【使用规则】资料只提供事实, 不要照抄原文; 不改变人设语气、称呼与 JSON 结构; 与当前话题无关的部分不要主动提起。`;
		} catch (e) {
			console.warn(`AI 知识库检索失败, 本轮不注入资料: ${e.message}`);
			return '';
		}
	},

	async vectorSearch(c, query) {
		const [vector] = await this.embed(c, [query]);

		if (!Array.isArray(vector) || !vector.length) {
			return [];
		}

		const result = await c.env.vectorize.query(vector, { topK: TOP_K + 2, returnMetadata: 'all' });
		const matches = (result?.matches || [])
			.filter(item => item.score >= SCORE_MIN)
			.slice(0, TOP_K);

		if (!matches.length) {
			return [];
		}

		const ids = matches.map(item => item.id);
		const placeholders = ids.map(() => '?').join(',');
		const rows = await c.env.db.prepare(
			`SELECT chunk_id, content FROM ai_knowledge_chunk WHERE chunk_id IN (${placeholders})`
		).bind(...ids).all();
		const contentMap = new Map((rows.results || []).map(item => [item.chunk_id, item.content]));

		return matches
			.map(item => ({ title: item.metadata?.title || '', content: contentMap.get(item.id) || '' }))
			.filter(item => item.content);
	},

	//没有向量索引时的兜底: 用提问里的词做 LIKE 匹配, 只取 2 条
	async keywordSearch(c, query) {
		const tokens = this.tokens(query);

		if (!tokens.length) {
			return [];
		}

		const conditions = tokens.map(() => '(title LIKE ? OR tags LIKE ? OR content LIKE ?)').join(' OR ');
		const bindings = tokens.flatMap(token => [`%${token}%`, `%${token}%`, `%${token}%`]);
		const rows = await c.env.db.prepare(
			`SELECT title, content FROM ai_knowledge WHERE enabled = 1 AND (${conditions}) ORDER BY ai_knowledge_id DESC LIMIT 2`
		).bind(...bindings).all();

		return (rows.results || []).map(item => ({ title: item.title, content: item.content }));
	},

	tokens(query) {
		const segments = String(query || '')
			.split(/[^\u4e00-\u9fa5a-zA-Z0-9]+/)
			.map(item => item.trim())
			.filter(item => item.length >= 2);

		return [...new Set(segments)].slice(0, 3);
	},

	//外部资料: 角色名走萌娘/Fandom, 明确的知识类提问走维基; 结果落缓存表, 重复提问不再发请求
	async externalLookup(c, query, localHits) {
		const character = CHARACTERS.find(name => query.includes(name));

		if (character) {
			const text = await this.cached(c, `char:${character}`, async () => {
				return await this.wikiExtract('zh.moegirl.org.cn', character) || await this.fandomExtract(character);
			});

			if (text) {
				return { title: `萌娘百科 · ${character}`, content: text };
			}
		}

		if (localHits || !this.needsLookup(query)) {
			return null;
		}

		const keyword = this.lookupKeyword(query);

		if (!keyword) {
			return null;
		}

		const data = await this.cached(c, `wiki:${keyword}`, async () => this.wikidataSummary(keyword), CACHE_DAYS * 2);

		return data ? { title: `维基百科 · ${keyword}`, content: data } : null;
	},

	needsLookup(query) {
		if (query.length > 80) {
			return false;
		}

		return LOOKUP_HINTS.some(hint => query.includes(hint));
	},

	//把"鲁迅是谁""介绍一下巴黎"这类问句收敛成实体名
	lookupKeyword(query) {
		let text = String(query || '').trim();

		for (const hint of ['请介绍一下', '介绍一下', '是什么', '什么是', '是谁', '是哪一年', '是哪年', '的简介', '的资料']) {
			text = text.split(hint).join(' ');
		}

		text = text.replace(/[?？。！!、,，]/g, ' ').replace(/\s+/g, ' ').trim();

		return text.length >= 2 ? text.slice(0, 40) : '';
	},

	async cached(c, key, loader, days = CACHE_DAYS) {
		const row = await c.env.db.prepare('SELECT payload, expire_time FROM ai_knowledge_cache WHERE cache_key = ?').bind(key).first();
		const now = Date.now();

		if (row && Number(row.expire_time) > now) {
			return row.payload;
		}

		let value = '';

		try {
			value = (await loader()) || '';
		} catch (e) {
			console.warn(`外部知识抓取失败(${key}): ${e.message}`);
			return row?.payload || '';
		}

		if (value) {
			await c.env.db.prepare(
				'INSERT INTO ai_knowledge_cache (cache_key, payload, expire_time) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, expire_time = excluded.expire_time'
			).bind(key, value, now + days * 86400000).run();
		}

		return value;
	},

	async wikiExtract(host, title) {
		const url = `https://${host}/api.php?action=query&format=json&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}`;
		const response = await fetch(url, {
			headers: { 'User-Agent': UA },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});

		if (!response.ok) {
			return '';
		}

		const json = await response.json();
		const pages = json?.query?.pages || {};
		const page = Object.values(pages)[0];

		return String(page?.extract || '').trim().slice(0, SNIPPET_MAX);
	},

	//萌娘不通时的备选: 先在 Fandom 站内搜条目名, 再取摘要
	async fandomExtract(title) {
		const searchUrl = `https://rezero.fandom.com/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(title)}&srlimit=1`;
		const response = await fetch(searchUrl, {
			headers: { 'User-Agent': UA },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});

		if (!response.ok) {
			return '';
		}

		const json = await response.json();
		const hit = json?.query?.search?.[0]?.title;

		return hit ? await this.wikiExtract('rezero.fandom.com', hit) : '';
	},

	//维基: 先用 Wikidata 确认实体, 再取中文维基摘要; 两者都拿不到就不注入
	async wikidataSummary(keyword) {
		const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=zh&uselang=zh&limit=1&search=${encodeURIComponent(keyword)}`;
		const response = await fetch(searchUrl, {
			headers: { 'User-Agent': UA },
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});

		if (!response.ok) {
			return '';
		}

		const json = await response.json();
		const hit = json?.search?.[0];

		if (!hit) {
			return '';
		}

		const label = hit.label || keyword;
		let summary = '';

		try {
			const summaryResponse = await fetch(`https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(label)}`, {
				headers: { 'User-Agent': UA },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
			});

			if (summaryResponse.ok) {
				const summaryJson = await summaryResponse.json();
				summary = String(summaryJson?.extract || '').trim();
			}
		} catch (e) {
			//摘要拿不到时退回 Wikidata 的一句话描述
		}

		return [hit.description || '', summary].filter(Boolean).join('\n').slice(0, SNIPPET_MAX);
	},

	//一键导入 Re:Zero 角色设定: 逐个抓取后入库, 失败的跳过并回报, 不阻塞其它角色
	async syncCharacters(c) {
		const result = { imported: 0, skipped: 0, failed: [] };

		for (const name of CHARACTERS) {
			const existing = await c.env.db.prepare('SELECT ai_knowledge_id FROM ai_knowledge WHERE title = ? AND source = ?').bind(name, 'moegirl').first();

			if (existing) {
				result.skipped += 1;
				continue;
			}

			let text = '';

			try {
				text = await this.wikiExtract('zh.moegirl.org.cn', name) || await this.fandomExtract(name);
			} catch (e) {
				text = '';
			}

			if (!text) {
				result.failed.push(name);
				continue;
			}

			await this.save(c, {
				title: name,
				content: `${name}是《Re:从零开始的异世界生活》中的角色。\n${text}`,
				tags: `Re:Zero ${name}`,
				source: 'moegirl',
				enabled: 1
			});
			result.imported += 1;
		}

		return result;
	}
};

export default aiKnowledgeService;
