import emailUtils from '../utils/email-utils';
import { settingConst } from '../const/entity-const';

const CODE_SYSTEM_PROMPT = 'You extract verification codes from emails. Return only JSON like {"code":"12345678"} or {"code":""}. The code must be 8 characters or fewer and must not contain spaces. If the code is longer than 8 characters or contains spaces, return {"code":""}. Do not explain.';

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

	async chatWithWorkersAI(c, messages) {
		const result = await c.env.ai.run(c.env.ai_model || '@cf/meta/llama-3.1-8b-instruct-fast', {
			messages,
			temperature: 0,
			max_tokens: 32
		});

		return typeof result === 'string' ? result : result?.response || '';
	},

	async chatWithExternalAI(options, messages) {
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
				max_tokens: 32
			})
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`AI API error ${response.status}: ${text.slice(0, 200)}`);
		}

		const data = await response.json();
		return data?.choices?.[0]?.message?.content || '';
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
