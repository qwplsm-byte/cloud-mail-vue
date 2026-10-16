import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import aiAgentService from '../service/ai-agent-service';
import aiMemoryService from '../service/ai-memory-service';
import aiChatService from '../service/ai-chat-service';

app.post('/ai/assistant', async (c) => {
	const data = await aiAgentService.plan(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.post('/ai/assistant/execute', async (c) => {
	const data = await aiAgentService.execute(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

//AI 对话记录: 存服务端, 多设备登录同一账号时同步
app.get('/ai/chat/history', async (c) => {
	const data = await aiChatService.history(c, userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.post('/ai/chat/save', async (c) => {
	await aiChatService.save(c, userContext.getUserId(c), await c.req.json());
	return c.json(result.ok());
});

app.post('/ai/chat/clear', async (c) => {
	await aiChatService.clear(c, userContext.getUserId(c));
	return c.json(result.ok());
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
