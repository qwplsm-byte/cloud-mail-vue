import http from '@/axios/index.js';

//生成计划要等模型推理; 后端已把模型超时压到 80s 并返回友好提示, 前端给到网关(Cloudflare) 100s 上限即可
//history 用于让 AI 记住多轮上下文, webSearch 表示本次是否手动开启联网搜索
//searchEngine/searchEndpoint 决定联网搜索用哪个来源, endpoint 仅 searxng 需要
//attachments 是本轮上传的图片/文本文件, 图片以 base64 传给支持看图的模型
export function aiAssistantPlan(
    prompt,
    history = [],
    webSearch = false,
    searchEngine = 'auto',
    searchEndpoint = '',
    attachments = []
) {
    return http.post('/ai/assistant', {prompt, history, webSearch, searchEngine, searchEndpoint, attachments}, {
        timeout: 100 * 1000,
        noMsg: true
    })
}

//执行动作(如批量归类)会逐封调用模型; 后端用时间预算兜底, 请求会在网关 100s 内返回, 返回体带 remaining 表示未处理完
export function aiAssistantExecute(actions) {
    return http.post('/ai/assistant/execute', {actions}, {timeout: 100 * 1000, noMsg: true})
}

//AI 对话记录: 存服务端, 多设备登录同一账号时同步
export function aiChatHistory() {
    return http.get('/ai/chat/history', {noMsg: true})
}

export function aiChatSave(messages) {
    return http.post('/ai/chat/save', {messages}, {noMsg: true})
}

export function aiChatClear() {
    return http.post('/ai/chat/clear', {noMsg: true})
}

//每日要务晨报: 后端汇总过去24小时邮件, 按用户+日期缓存
export function aiBriefing() {
    return http.get('/ai/briefing', {noMsg: true})
}

//AI 记忆与用户画像: 记忆面板读取列表与画像
export function aiMemoryDetail() {
    return http.get('/ai/memory', {noMsg: true})
}

//新增或修改一条记忆, 带 id 表示修改
export function aiMemorySave(data) {
    return http.post('/ai/memory/save', data)
}

export function aiMemoryRemove(ids) {
    return http.post('/ai/memory/remove', {ids})
}

export function aiMemoryClear() {
    return http.post('/ai/memory/clear')
}

//手动保存用户画像
export function aiMemorySaveProfile(content) {
    return http.post('/ai/memory/profile', {content})
}
