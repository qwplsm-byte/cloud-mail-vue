import http from '@/axios/index.js';

//通行密钥登录: 免登录态, 分两步(options -> verify)
export function passkeyLoginOptions() {
    return http.post('/passkey/login/options')
}

export function passkeyLoginVerify(data) {
    return http.post('/passkey/login/verify', data)
}

//通行密钥管理: 需要已登录
export function passkeyRegisterOptions() {
    return http.post('/passkey/register/options')
}

export function passkeyRegisterVerify(data) {
    return http.post('/passkey/register/verify', data)
}

export function passkeyList() {
    return http.get('/passkey/list')
}

export function passkeyRename(data) {
    return http.post('/passkey/rename', data)
}

export function passkeyDelete(data) {
    return http.post('/passkey/delete', data)
}