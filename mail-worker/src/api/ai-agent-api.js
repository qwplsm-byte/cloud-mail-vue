import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import aiAgentService from '../service/ai-agent-service';
import aiMemoryService from '../service/ai-memory-service';
import aiBriefingService from '../service/ai-briefing-service';
import aiChatService from '../service/ai-chat-service';
import aiDraftService from '../service/ai-draft-service';

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

//每日要务晨报: 汇总过去 24 小时邮件为"必办/账单/其余已归档", 按用户+日期缓存
app.get('/ai/briefing', async (c) => {
	const data = await aiBriefingService.daily(c, userContext.getUserId(c));
	return c.json(result.ok(data));
});

//拟真一键草稿: 结合往来邮件、长期记忆与网盘文件, 生成模仿主人语气的回复草稿并推荐附件
app.post('/ai/draft', async (c) => {
	const data = await aiDraftService.generate(c, await c.req.json(), userContext.getUserId(c));
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
