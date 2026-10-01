import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import aiAgentService from '../service/ai-agent-service';
import aiMemoryService from '../service/ai-memory-service';

app.post('/ai/assistant', async (c) => {
	const data = await aiAgentService.plan(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.post('/ai/assistant/execute', async (c) => {
	const data = await aiAgentService.execute(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

//AI 记忆与用户画像: 供前端记忆面板查看与管理
app.get('/ai/memory', async (c) => {
	const data = await aiMemoryService.detail(c, userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.post('/ai/memory/save', async (c) => {
	const data = await aiMemoryService.save(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.post('/ai/memory/remove', async (c) => {
	const data = await aiMemoryService.remove(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.post('/ai/memory/clear', async (c) => {
	const data = await aiMemoryService.clear(c, userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.post('/ai/memory/profile', async (c) => {
	const data = await aiMemoryService.saveProfile(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});
