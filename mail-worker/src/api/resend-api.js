import resendService from '../service/resend-service';
import svixUtils from '../utils/svix-utils';
import app from '../hono/hono';

app.post('/webhooks', async (c) => {
	try {
		//签名校验必须用原始报文, 不能先 json() 再拼回去
		const rawBody = await c.req.text();

		const verified = await svixUtils.verify({
			secret: c.env.RESEND_WEBHOOK_SECRET,
			id: c.req.header('svix-id'),
			timestamp: c.req.header('svix-timestamp'),
			signature: c.req.header('svix-signature'),
			rawBody
		});

		if (verified === false) {
			return c.text('invalid signature', 401);
		}

		//未配置 RESEND_WEBHOOK_SECRET 时保持旧行为, 但打印告警提示尽快配置
		if (verified === null) {
			console.warn('RESEND_WEBHOOK_SECRET 未配置, /webhooks 请求未校验签名');
		}

		let body;
		try {
			body = JSON.parse(rawBody);
		} catch (e) {
			return c.text('invalid json', 400);
		}

		await resendService.webhooks(c, body);
		return c.text('success', 200)
	} catch (e) {
		return c.text(e.message, 500)
	}
})
