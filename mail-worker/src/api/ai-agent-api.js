import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import aiAgentService from '../service/ai-agent-service';

app.post('/ai/assistant', async (c) => {
	const data = await aiAgentService.plan(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.post('/ai/assistant/execute', async (c) => {
	const data = await aiAgentService.execute(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});