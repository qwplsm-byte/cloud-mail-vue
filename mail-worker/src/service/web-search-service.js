//免 Key 的网页搜索: 直接抓取各搜索引擎的结果页, 零配置、零成本
//稳定性取决于目标站点(可能限流/改版), 因此任何失败都返回空数组, 由上层降级为普通聊天
//可选引擎: duckduckgo(默认) / bing / baidu / mojeek / searxng(需传入自定义实例地址)

const ENGINES = ['duckduckgo', 'bing', 'baidu', 'mojeek', 'searxng'];
//用户指定了引擎时优先用它, 没结果或出错再按这个顺序兜底
const FALLBACK_CHAIN = ['duckduckgo', 'bing', 'mojeek'];

const DDG_ENDPOINTS = [
	'https://html.duckduckgo.com/html/',
	'https://lite.duckduckgo.com/lite/'
];

//搜索请求超时, 避免外部站点卡住整个 AI 回复
const TIMEOUT_MS = 8 * 1000;
//单条标题/摘要长度上限, 控制拼进提示词的体积
const SNIPPET_MAX = 300;
const TITLE_MAX = 160;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const DDG_LINK = /<a\b[^>]*class=["']?(?:result__a|result-link)["']?[^>]*>([\s\S]*?)<\/a>/gi;
const DDG_SNIPPET = /<(?:a|td)\b[^>]*class=["']?(?:result__snippet|result-snippet)["']?[^>]*>([\s\S]*?)<\/(?:a|td)>/gi;
const HREF = /href=["']([^"']*)["']/i;
const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const TAG_TEXT = /<[^>]*>/g;
const BING_BLOCK = /<li class="b_algo"[\s\S]*?(?=<li class="b_algo"|<\/ol>|<\/ul>|$)/gi;
const MOJEEK_LINK = /<a\b[^>]*class=["'][^"']*\bob\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
const P_TAG = /<p\b[^>]*>([\s\S]*?)<\/p>/i;
const BAIDU_HEAD = /<h3\b[^>]*class=["'][^"']*\bt\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/gi;
const BAIDU_SNIPPET = /<(?:div|span)\b[^>]*class=["'][^"']*(?:c-abstract|content-right_)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span)>/gi;

const ENTITIES = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	'#39': "'",
	'#x27': "'"
};

const webSearchService = {

	//对外入口: 永不抛错, 失败返回空数组
	//options: { limit, engine, endpoint }
	async search(query, options = {}) {
		const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 120);

		if (!q) {
			return [];
		}

		const limit = Math.min(Math.max(Number(options.limit) || 5, 1), 10);
		const chain = this.resolveChain(options.engine);
		const endpoint = String(options.endpoint || '').trim();

		for (const engine of chain) {
			try {
				const results = await this.runEngine(engine, q, limit, endpoint);

				if (results.length) {
					return results;
				}
			} catch (e) {
				console.warn(`网页搜索失败 (${engine}): ${e?.name || 'Error'} | ${e?.message || '(empty)'}`);
			}
		}

		return [];
	},

	//指定了合法引擎就把它排在最前, 其余按默认链兜底
	resolveChain(engine) {
		const picked = String(engine || '').trim().toLowerCase();

		if (!ENGINES.includes(picked)) {
			return [...FALLBACK_CHAIN];
		}

		return [picked, ...FALLBACK_CHAIN.filter(item => item !== picked)];
	},

	async runEngine(engine, q, limit, endpoint) {
		if (engine === 'searxng') {
			return this.searxng(q, limit, endpoint);
		}

		if (engine === 'bing') {
			return this.bing(q, limit);
		}

		if (engine === 'baidu') {
			return this.baidu(q, limit);
		}

		if (engine === 'mojeek') {
			return this.mojeek(q, limit);
		}

		return this.duckduckgo(q, limit);
	},

	//DuckDuckGo 的无脚本结果页, html 版失败再试 lite 版
	async duckduckgo(q, limit) {
		for (const endpoint of DDG_ENDPOINTS) {
			const html = await this.request(endpoint, {
				method: 'POST',
				body: `q=${encodeURIComponent(q)}`
			});

			const results = html ? this.parseDuckduckgo(html, limit) : [];

			if (results.length) {
				return results;
			}
		}

		return [];
	},

	async bing(q, limit) {
		const html = await this.request(`https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=zh-CN&count=15`);

		if (!html) {
			return [];
		}

		const results = [];
		BING_BLOCK.lastIndex = 0;

		let block;

		while (results.length < limit && (block = BING_BLOCK.exec(html))) {
			const head = (block[0].match(/<h2\b[\s\S]*?<\/h2>/i) || [])[0] || block[0];
			const anchor = this.firstAnchor(head);
			const snippet = this.clean((block[0].match(P_TAG) || [])[1] || '');

			if (anchor) {
				results.push({ title: anchor.title, url: anchor.url, snippet: snippet.slice(0, SNIPPET_MAX) });
			}
		}

		return results.length ? results : this.generic(html, limit, 'www.bing.com');
	},

	async mojeek(q, limit) {
		const html = await this.request(`https://www.mojeek.com/search?q=${encodeURIComponent(q)}`);

		if (!html) {
			return [];
		}

		const results = [];
		const titles = [];
		MOJEEK_LINK.lastIndex = 0;

		let match;

		while ((match = MOJEEK_LINK.exec(html))) {
			const url = this.normalizeUrl((match[0].match(HREF) || [])[1] || '');
			const title = this.clean(match[1]).slice(0, TITLE_MAX);

			if (url && title) {
				titles.push({ title, url });
			}
		}

		//摘要统一是 <p class="s">...</p>, 按出现顺序与标题一一对应
		const snippets = [];

		this.eachMatch(html, /<p\b[^>]*class=["'][^"']*\bs\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi, 0, text => {
			snippets.push(this.clean(text).slice(0, SNIPPET_MAX));
		});

		for (const item of titles) {
			if (results.length >= limit) {
				break;
			}

			results.push({ title: item.title, url: item.url, snippet: snippets[results.length] || '' });
		}

		return results.length ? results : this.generic(html, limit, 'www.mojeek.com');
	},

	//百度结果链接是加密跳转, 点开仍能到达目标页, 因此直接保留
	async baidu(q, limit) {
		const html = await this.request(`https://www.baidu.com/s?wd=${encodeURIComponent(q)}&rn=15`);

		if (!html) {
			return [];
		}

		const results = [];
		BAIDU_HEAD.lastIndex = 0;

		let match;

		while (results.length < limit && (match = BAIDU_HEAD.exec(html))) {
			const anchor = this.firstAnchor(match[1]);

			if (anchor) {
				results.push({ title: anchor.title, url: anchor.url, snippet: '' });
			}
		}

		if (!results.length) {
			return this.generic(html, limit, 'www.baidu.com');
		}

		let index = 0;

		this.eachMatch(html, BAIDU_SNIPPET, 0, text => {
			const snippet = this.clean(text).slice(0, SNIPPET_MAX);

			if (snippet && results[index]) {
				results[index].snippet = snippet;
				index++;
			}
		});

		return results;
	},

	//SearXNG 的 JSON 接口, 地址由用户自定义(需形如 https://searx.example.com)
	async searxng(q, limit, endpoint) {
		const base = String(endpoint || '').trim().replace(/\/+$/, '');

		if (!/^https?:\/\//i.test(base)) {
			return [];
		}

		const url = `${base}/search?q=${encodeURIComponent(q)}&format=json&language=auto`;
		const text = await this.request(url, { accept: 'application/json' });

		if (!text) {
			return [];
		}

		let data;

		try {
			data = JSON.parse(text);
		} catch (e) {
			console.warn('SearXNG 返回的不是 JSON, 请确认实例已开启 format=json');
			return [];
		}

		const list = Array.isArray(data?.results) ? data.results : [];
		const results = [];

		for (const item of list) {
			if (results.length >= limit) {
				break;
			}

			const url2 = this.normalizeUrl(item?.url);
			const title = this.clean(item?.title).slice(0, TITLE_MAX);

			if (url2 && title) {
				results.push({ title, url: url2, snippet: this.clean(item?.content).slice(0, SNIPPET_MAX) });
			}
		}

		return results;
	},

	async request(url, { method = 'GET', body = '', accept = 'text/html,application/xhtml+xml' } = {}) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

		try {
			const response = await fetch(url, {
				method,
				headers: {
					'Content-Type': method === 'POST' ? 'application/x-www-form-urlencoded' : 'text/plain',
					'User-Agent': UA,
					'Accept': accept,
					'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
				},
				body: method === 'POST' ? body : undefined,
				signal: controller.signal
			});

			if (!response.ok) {
				console.warn(`网页搜索返回 ${response.status} (${url})`);
				return '';
			}

			return await response.text();
		} finally {
			clearTimeout(timer);
		}
	},

	//兼容 html 版与 lite 版的两种结果结构, 逐个抽取标题/链接/摘要
	parseDuckduckgo(html, limit) {
		const text = String(html || '');
		const results = [];

		DDG_LINK.lastIndex = 0;

		let match;

		while (results.length < limit && (match = DDG_LINK.exec(text))) {
			const url = this.normalizeUrl((match[0].match(HREF) || [])[1] || '');
			const title = this.clean(match[1]).slice(0, TITLE_MAX);

			if (url && title) {
				results.push({ title, url, snippet: '' });
			}
		}

		if (!results.length) {
			return results;
		}

		DDG_SNIPPET.lastIndex = 0;

		let index = 0;

		while (index < results.length && (match = DDG_SNIPPET.exec(text))) {
			const snippet = this.clean(match[1]).slice(0, SNIPPET_MAX);

			if (snippet) {
				results[index].snippet = snippet;
				index++;
			}
		}

		return results;
	},

	//通用兜底: 引擎改版导致专用规则失效时, 退化为抓取页面里的正文链接
	generic(html, limit, engineHost) {
		const text = String(html || '');
		const results = [];
		const seen = new Set();
		ANCHOR.lastIndex = 0;

		let match;

		while (results.length < limit && (match = ANCHOR.exec(text))) {
			const url = this.normalizeUrl((match[1].match(HREF) || [])[1] || '');
			const title = this.clean(match[2]).slice(0, TITLE_MAX);

			//过滤导航/页脚之类的短链接与站内链接
			if (!url || title.length < 6 || seen.has(url)) {
				continue;
			}

			if (engineHost && url.includes(engineHost)) {
				continue;
			}

			seen.add(url);
			results.push({ title, url, snippet: '' });
		}

		return results;
	},

	firstAnchor(html) {
		ANCHOR.lastIndex = 0;
		const match = ANCHOR.exec(String(html || ''));

		if (!match) {
			return null;
		}

		const url = this.normalizeUrl((match[1].match(HREF) || [])[1] || '');
		const title = this.clean(match[2]).slice(0, TITLE_MAX);

		return url && title ? { title, url } : null;
	},

	eachMatch(text, pattern, limit, handler) {
		pattern.lastIndex = 0;

		let match;
		let count = 0;

		while ((match = pattern.exec(String(text || '')))) {
			if (limit && count >= limit) {
				break;
			}

			handler(match[1], match);
			count++;
		}
	},

	//结果链接可能是跳转包装, 这里还原真实地址; 只保留 http(s)
	normalizeUrl(href) {
		let url = this.decode(String(href || '').trim()).trim();

		if (!url) {
			return '';
		}

		//DuckDuckGo 的 /l/?uddg=<encoded> 跳转
		const uddg = url.match(/[?&]uddg=([^&]+)/i);

		if (uddg) {
			try {
				url = decodeURIComponent(uddg[1]);
			} catch (e) {
				//解不开就退回原值, 下面还会再校验一次协议
			}
		}

		return /^https?:\/\//i.test(url) ? url : '';
	},

	//去标签并解码实体, 得到可读纯文本
	clean(html) {
		return this.decode(String(html || '').replace(TAG_TEXT, ' '))
			.replace(/\s+/g, ' ')
			.trim();
	},

	decode(str) {
		return str
			.replace(/&#(\d+);/g, (all, code) => String.fromCharCode(Number(code)))
			.replace(/&#x([0-9a-f]+);/gi, (all, code) => String.fromCharCode(parseInt(code, 16)))
			.replace(/&([a-z#0-9x]+);/gi, (all, name) => ENTITIES[name.toLowerCase()] ?? all);
	}
};

export default webSearchService;