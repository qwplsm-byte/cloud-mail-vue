//Resend 的 Webhook 用 Svix 签名: 头部 svix-id / svix-timestamp / svix-signature
//签名内容 = `${svix-id}.${svix-timestamp}.${rawBody}`, 密钥为 whsec_ 前缀的 base64

const TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(base64) {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function bytesToBase64(bytes) {
	let binary = '';
	const view = new Uint8Array(bytes);
	for (let i = 0; i < view.length; i++) {
		binary += String.fromCharCode(view[i]);
	}
	return btoa(binary);
}

//长度固定的常量时间比较, 避免按字节提前返回
function safeEqual(a, b) {
	if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
		return false;
	}
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

const svixUtils = {

	//返回 true 表示校验通过; secret 为空时返回 null, 由调用方决定降级策略
	async verify({ secret, id, timestamp, signature, rawBody }) {

		if (!secret) {
			return null;
		}

		if (!id || !timestamp || !signature || typeof rawBody !== 'string') {
			return false;
		}

		const now = Math.floor(Date.now() / 1000);
		const ts = Number(timestamp);

		if (!Number.isFinite(ts) || Math.abs(now - ts) > TOLERANCE_SECONDS) {
			return false;
		}

		const keyBytes = base64ToBytes(secret.replace(/^whsec_/, ''));
		const key = await crypto.subtle.importKey(
			'raw',
			keyBytes,
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['sign']
		);

		const signedContent = `${id}.${timestamp}.${rawBody}`;
		const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
		const expected = bytesToBase64(mac);

		//头部形如 "v1,xxx v1,yyy", 命中任意一个即通过
		return signature.split(' ').some(item => {
			const [version, value] = item.split(',');
			return version === 'v1' && safeEqual(value || '', expected);
		});
	}
};

export default svixUtils;
