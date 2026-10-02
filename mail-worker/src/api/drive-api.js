import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import driveService from '../service/drive-service';

//网盘浏览与搜索
app.get('/drive/list', async (c) => {
	const data = await driveService.list(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.get('/drive/search', async (c) => {
	const data = await driveService.search(c, c.req.query('keyword'), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.get('/drive/stats', async (c) => {
	const data = await driveService.stats(c, userContext.getUserId(c));
	return c.json(result.ok(data));
});

//文件下载/预览: 直接返回二进制流, 不走统一 JSON 包装
app.get('/drive/file/:id', async (c) => {
	return await driveService.file(c, c.req.param('id'), userContext.getUserId(c));
});

//上传: multipart 表单, 字段为 file 与 parentId
app.post('/drive/upload', async (c) => {
	const data = await driveService.upload(c, await c.req.formData(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.post('/drive/mkdir', async (c) => {
	const data = await driveService.mkdir(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.post('/drive/rename', async (c) => {
	const data = await driveService.rename(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.post('/drive/move', async (c) => {
	const data = await driveService.move(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.post('/drive/copy', async (c) => {
	const data = await driveService.copy(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.post('/drive/delete', async (c) => {
	const data = await driveService.remove(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

//AI 打标签 / 智能归类
app.post('/drive/autotag', async (c) => {
	const data = await driveService.autotag(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.post('/drive/tidy', async (c) => {
	const data = await driveService.tidy(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});