//系统桌面通知: 用于"收到新验证码"时提醒, 点击可复制验证码并跳转到该邮件
export function notifySupported() {
    return typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext
}

//浏览器要求用户手势才能授权, 这里在首次点击时静默申请一次
export async function requestNotifyPermission() {
    if (!notifySupported() || Notification.permission !== 'default') return
    try {
        await Notification.requestPermission()
    } catch (e) {
        //忽略: 部分浏览器在无手势时直接拒绝
    }
}

//返回通知实例, 便于调用方绑定 onclick; 未授权或不受支持时返回 null
export function showNotification(title, body) {
    if (!notifySupported() || Notification.permission !== 'granted') return null
    try {
        return new Notification(title, {body, tag: 'cloud-mail-code', renotify: true})
    } catch (e) {
        console.error('桌面通知失败:', e)
        return null
    }
}
