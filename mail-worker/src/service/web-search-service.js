//免 Key 的网页搜索: 直接抓取 DuckDuckGo 的无脚本结果页
//零配置、零成本, 代价是稳定性一般(可能被限流), 因此失败时一律返回空数组, 由上层降级为普通聊天
const DDG_ENDPOINTS = [
	'https://html.duckduckgo.com/html/',
	'https://lite.duckduckgo.com/lite/'
];

//搜索请求超时, 避免外部站点卡住整个 AI 回复
const SEARCH_TIMEOUT_MS = 8 * 1000;
//单条摘要长度上限, 控制拼进提示词的体积
const SNIPPET_MAX = 300;
const TITLE_MAX = 160;

const LINK_PATTERN = /<a\b[^>]*class=["']?(?:result__a|result-link)["']?[^>]*>([\s\S]*?)<\/a>/gi;
const SNIPPET_PATTERN = /<(?:a|td)\b[^>]*class=["']?(?:result__snippet|result-snippet)["']?[^>]*>([\s\S]*?)<\/(?:a|td)>/gi;
const HREF_PATTERN = /href=["']([^"']*)["']/i;

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
	async search(query, limit = 5) {
		const q = String(query || '').trim().slice(0, 120);

		if (!q) {
			return [];
		}

		for (const endpoint of DDG_ENDPOINTS) {
			try {
				const html = await this.request(endpoint, q);

				if (!html) {
					continue;
				}

				const results = this.parse(html, limit);

				if (results.length) {
					return results;
				}
			} catch (e) {
				console.warn(`网页搜索失败 (${endpoint}): ${e?.name || 'Error'} | ${e?.message || '(empty)'}`);
			}
		}

		return [];
	},

	async request(url, q) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
					'Accept': 'text/html,application/xhtml+xml',
					'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
				},
				body: `q=${encodeURIComponent(q)}`,
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
	parse(html, limit) {
		const text = String(html || '');
		const results = [];

		LINK_PATTERN.lastIndex = 0;

		let match;

		while (results.length < limit && (match = LINK_PATTERN.exec(text))) {
			const href = (match[0].match(HREF_PATTERN) || [])[1] || '';
			const url = this.normalizeUrl(href);
			const title = this.clean(match[1]).slice(0, TITLE_MAX);

			if (url && title) {
				results.push({ title, url, snippet: '' });
			}
		}

		if (!results.length) {
			return results;
		}

		SNIPPET_PATTERN.lastIndex = 0;

		let index = 0;

		while (index < results.length && (match = SNIPPET_PATTERN.exec(text))) {
			const snippet = this.clean(match[1]).slice(0, SNIPPET_MAX);

			if (snippet) {
				results[index].snippet = snippet;
				index++;
			}
		}

		return results;
	},

	//DuckDuckGo 的结果链接可能是跳转包装, 这里还原真实地址; 只保留 http(s)
	normalizeUrl(href) {
		let url = this.decode(String(href || '').trim()).trim();

		if (!url) {
			return '';
		}

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
		return this.decode(String(html || '').replace(/<[^>]*>/g, ' '))
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