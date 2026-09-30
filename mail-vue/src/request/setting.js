import http from '@/axios/index.js';

export function settingSet(setting) {
    return http.put('/setting/set', setting)
}

export function settingQuery() {
    return http.get('/setting/query')
}

export function websiteConfig() {
    return http.get('/setting/websiteConfig')
}

export function setBackground(background) {
    return http.put('/setting/setBackground',{background})
}

export function deleteBackground() {
    return http.delete('/setting/deleteBackground')
}

export function setLayoutBackground(layoutBackground) {
    return http.put('/setting/setLayoutBackground',{layoutBackground})
}

export function settingPresignUpload(params) {
    return http.post('/setting/presignUpload', params)
}

export function deleteLayoutBackground() {
    return http.delete('/setting/deleteLayoutBackground')
}

export function setBlackList(params) {
    return http.put('/setting/setBlacklist', params)
}

export function testAiConnection(params) {
    return http.post('/setting/testAi', params)
}