import emailUtils from '../utils/email-utils';
import { emailConst, settingConst } from '../const/entity-const';

const CODE_SYSTEM_PROMPT = 'You extract verification codes from emails. Return only JSON like {"code":"12345678"} or {"code":""}. The code must be 8 characters or fewer and must not contain spaces. If the code is longer than 8 characters or contains spaces, return {"code":""}. Do not explain.';

const CATEGORY_SYSTEM_PROMPT = 'You classify an email into exactly one category. Reply with the category digit only, nothing else.\n' +
	'1 = account: verification codes, sign up, login alerts, password reset, security notices\n' +
	'2 = notice: system or service notifications, order and shipping updates, reminders, support tickets\n' +
	'3 = bill: invoices, receipts, statements, payment, refund or subscription charges\n' +
	'4 = promotion: ads, marketing, sales, coupons, newsletters, event invitations\n' +
	'5 = other: personal messages, social updates, or anything that does not fit above';

const aiService = {
	async extractCode(c, email, options = {}) {
		if (!this.shouldExtractCode(options.aiCode, options.aiCodeFilter, email)) {
			return '';
		}

		try {
			const subject = email.subject || '';
			const text = emailUtils.formatText(email.text || '');
			const htmlText = emailUtils.htmlToText(email.html || '');
			const body = (htmlText || text).slice(0, 6000);

			if (!subject && !body) {
				return '';
			}

			const messages = [
				{
					role: 'system',
					content: CODE_SYSTEM_PROMPT
				},
				{
					role: 'user',
					content: `Subject: ${subject}\n\n${body}`
				}
			];

			const content = options.aiApiKey
				? await this.chatWithExternalAI(options, messages)
				: await this.chatWithWorkersAI(c, messages);

			return this.parseCode(content);
		} catch (e) {
			console.error('验证码提取失败: ', e);
			return '';
		}
	},

	async chatWithWorkersAI(c, messages, maxTokens = 32) {
		const result = await c.env.ai.run(c.env.ai_model || '@cf/meta/llama-3.1-8b-instruct-fast', {
			messages,
			temperature: 0,
			max_tokens: maxTokens
		});

		return typeof result === 'string' ? result : result?.response || '';
	},

	async chatWithExternalAI(options, messages, maxTokens = 32) {
		const baseUrl = (options.aiBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');

		const response = await fetch(`${baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${options.aiApiKey}`
			},
			body: JSON.stringify({
				model: options.aiModel || 'gpt-4o-mini',
				messages,
				temperature: 0,
				max_tokens: maxTokens
			})
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`AI API error ${response.status}: ${text.slice(0, 200)}`);
		}

		const data = await response.json();
		const choice = data?.choices?.[0];
		const message = choice?.message || {};
		//兼容推理型模型：content 为空时回退 reasoning_content
		return (message.content || message.reasoning_content || choice?.text || '').trim();
	},

	parseCode(content) {
		if (!content) {
			return '';
		}

		let json = null;

		if (typeof content === 'object') {
			json = content;
		} else {
			try {
				json = JSON.parse(content);
			} catch (e) {
				const match = String(content).match(/\{[^{}]*\}/);
				json = match ? this.safeParse(match[0]) : null;
			}
		}

		if (!json || typeof json.code !== 'string') {
			return '';
		}

		if (json.code.length > 8 || /\s/.test(json.code)) {
			return '';
		}

		return json.code;
	},

	safeParse(str) {
		try {
			return JSON.parse(str);
		} catch (e) {
			return null;
		}
	},

	async classifyEmail(c, email, options = {}) {
		if (options.aiCategory !== settingConst.aiCategory.OPEN) {
			return emailConst.category.NONE;
		}

		try {
			const subject = (email.subject || '').slice(0, 200);
			const from = email.from?.address || '';
			const text = emailUtils.formatText(email.text || '');
			const htmlText = emailUtils.htmlToText(email.html || '');
			const body = (htmlText || text).slice(0, 800);

			if (!subject && !body) {
				return emailConst.category.NONE;
			}

			const messages = [
				{
					role: 'system',
					content: CATEGORY_SYSTEM_PROMPT
				},
				{
					role: 'user',
					content: `From: ${from}\nSubject: ${subject}\n\n${body}`
				}
			];

			const content = options.aiApiKey
				? await this.chatWithExternalAI(options, messages, 16)
				: await this.chatWithWorkersAI(c, messages, 16);

			const category = this.parseCategory(content);

			if (category === emailConst.category.NONE) {
				console.warn('邮件分类未识别到分类编号, 模型返回: ', JSON.stringify(content).slice(0, 200));
			}

			return category;
		} catch (e) {
			console.error('邮件分类失败: ', e);
			return emailConst.category.NONE;
		}
	},

	parseCategory(content) {
		if (content === undefined || content === null || content === '') {
			return emailConst.category.NONE;
		}

		const str = String(content).trim();
		//优先匹配独立出现的分类编号，避免从推理文本/长句中误取数字
		const match = str.match(/(?:^|\D)([1-5])(?!\d)/) || str.match(/[1-5]/);

		return match ? Number(match[1] || match[0]) : emailConst.category.NONE;
	},

	shouldExtractCode(aiCode, aiCodeFilterStr, email) {
		if (aiCode !== settingConst.aiCode.OPEN) {
			return false;
		}

		const filterList = aiCodeFilterStr ? aiCodeFilterStr.split(',').map(item => item.trim().toLowerCase()).filter(Boolean) : [];

		if (filterList.length === 0) {
			return true;
		}

		const fromEmail = (email.from?.address || '').trim().toLowerCase();
		const fromDomain = emailUtils.getDomain(fromEmail).toLowerCase();

		return filterList.some(item => item === fromEmail || item === fromDomain);
	}
};

export default aiService;
