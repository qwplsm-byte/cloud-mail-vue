import http from '@/axios/index.js';

export function aiAssistantPlan(prompt) {
    return http.post('/ai/assistant', {prompt}, {timeout: 60 * 1000})
}

export function aiAssistantExecute(actions) {
    return http.post('/ai/assistant/execute', {actions}, {timeout: 120 * 1000})
}