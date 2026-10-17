import { parseHTML } from 'linkedom';

//邮件正文来自外部发件人, 服务端渲染成页面时同样需要清洗
//这里只做去危险节点/属性, 不改动布局相关的标签与内联样式
const DROP_TAGS = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'base', 'meta', 'link', 'form'];

const URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'poster', 'background'];

const DANGEROUS_URL = /^(javascript:|vbscript:|data:text\/html|data:application\/xhtml)/;

export default function sanitizeEmailHtml(html) {

	if (!html) {
		return '';
	}

	const { document } = parseHTML(html);

	document.querySelectorAll(DROP_TAGS.join(',')).forEach(el => el.remove());

	document.querySelectorAll('*').forEach(el => {
		Array.from(el.attributes || []).forEach(attr => {
			const name = String(attr.name || '').toLowerCase();
			//去掉控制字符再判断, 避免 java\nscript: 这类绕过
			const value = String(attr.value || '').replace(/[\u0000-\u0020]/g, '').toLowerCase();

			if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
				el.removeAttribute(attr.name);
				return;
			}

			if (URL_ATTRS.includes(name) && DANGEROUS_URL.test(value)) {
				el.removeAttribute(attr.name);
			}
		});
	});

	document.querySelectorAll('style').forEach(el => {
		const text = el.textContent || '';
		if (/expression\s*\(|javascript:|@import/i.test(text)) {
			el.remove();
		}
	});

	return document.toString();
}
