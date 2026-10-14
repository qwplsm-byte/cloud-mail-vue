import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import passkeyService from '../service/passkey-service';

//登录相关: 免鉴权, 已在 security 中间件放行
app.post('/passkey/login/options', async (c) => {
	const data = await passkeyService.loginOptions(c);
	return c.json(result.ok(data));
});

app.post('/passkey/login/verify', async (c) => {
	const token = await passkeyService.loginVerify(c, await c.req.json());
	return c.json(result.ok({ token }));
});

//凭证管理: 需要已登录
app.post('/passkey/register/options', async (c) => {
	const data = await passkeyService.registerOptions(c, userContext.getUser(c));
	return c.json(result.ok(data));
});

app.post('/passkey/register/verify', async (c) => {
	const data = await passkeyService.registerVerify(c, userContext.getUser(c), await c.req.json());
	return c.json(result.ok(data));
});

app.get('/passkey/list', async (c) => {
	const data = await passkeyService.list(c, userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.post('/passkey/rename', async (c) => {
	const data = await passkeyService.rename(c, userContext.getUserId(c), await c.req.json());
	return c.json(result.ok(data));
});

app.post('/passkey/delete', async (c) => {
	await passkeyService.remove(c, userContext.getUserId(c), await c.req.json());
	return c.json(result.ok());
});