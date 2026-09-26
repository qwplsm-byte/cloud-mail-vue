import http from '@/axios/index.js';

//生成计划要等模型推理, 慢模型可能一分钟以上, 前端给足时间, 由后端 120s 超时兜底并返回友好提示
//history 用于让 AI 记住多轮上下文, webSearch 表示本次是否手动开启联网搜索
export function aiAssistantPlan(prompt, history = [], webSearch = false) {
    return http.post('/ai/assistant', {prompt, history, webSearch}, {timeout: 180 * 1000, noMsg: true})
}

//自动归类会逐封调用模型, 需要更长时间
export function aiAssistantExecute(actions) {
    return http.post('/ai/assistant/execute', {actions}, {timeout: 300 * 1000, noMsg: true})
}