import Compressor from "compressorjs";

export function getExtName(fileName) {
    const index = fileName.lastIndexOf('.')
    return index !== -1 ? fileName.slice(index + 1).toLowerCase() : ''
}

//可作为背景播放的视频扩展名(部分系统不识别 mkv 的 MIME, 只能靠扩展名判断)
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogv', 'ogg', 'mov', 'm4v', 'mkv']

//文件选择框的 accept: 除 MIME 外显式列出扩展名, 否则 mkv 等会被系统对话框过滤掉
export const MEDIA_ACCEPT = 'image/*,video/*,.mp4,.webm,.mov,.m4v,.ogv,.ogg,.mkv'

const EXT_CONTENT_TYPE = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    ogv: 'video/ogg',
    ogg: 'video/ogg',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    wmv: 'video/x-ms-wmv',
    flv: 'video/x-flv',
    zip: 'application/zip',
    '7z': 'application/x-7z-compressed',
    rar: 'application/vnd.rar',
    tar: 'application/x-tar',
    gz: 'application/gzip',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    wav: 'audio/wav',
    aac: 'audio/aac'
}

export function isVideoFile(file) {
    if (!file) return false
    if (file.type && file.type.startsWith('video/')) return true
    return VIDEO_EXTENSIONS.includes(getExtName(file.name || ''))
}

//mkv 等文件浏览器常给不出 MIME(file.type 为空), 上传时需按扩展名补上, 否则会被存成 octet-stream 而无法播放
export function resolveContentType(file) {
    if (file?.type) return file.type
    return EXT_CONTENT_TYPE[getExtName(file?.name || '')] || 'application/octet-stream'
}

/*
 * 手机浏览器对 zip/7z/rar/mkv 等文件常给不出 MIME(file.type 为空), 直接上传会被存成
 * octet-stream, 影响后续预览与播放。这里按扩展名补齐后重建 File;
 * 类型已知或映射不到时原样返回, 不产生任何副作用。
 */
export function ensureContentType(file) {
    if (!file || file.type) return file
    const type = EXT_CONTENT_TYPE[getExtName(file.name || '')]
    if (!type) return file
    try {
        return new File([file], file.name, {type, lastModified: file.lastModified})
    } catch (e) {
        return file
    }
}

// 文件管理器入口的 accept: 必须是 "*/*" 而不是留空 ——
// 手机浏览器(尤其微信/QQ 等内置 WebView)在 accept 为空时往往只弹出相册/拍照,
// 带上 "*/*" 才会提供"文件管理器/文档"入口, 从而能选中 zip、7z、rar、mp4、mkv、mp3 等任意格式。
export const FILE_MANAGER_ACCEPT = '*/*'

/*
 * 用本地 ObjectURL 探测浏览器能否真正解码该视频。
 * 容器/编码的支持完全取决于浏览器实现: 例如 Chrome/Edge/Firefox 都无法解码 mkv 里的
 * HEVC(H.265) 轨, 此时上传照样成功, 但播放只会是一片黑屏。
 * 只有解出首帧(loadeddata/canplay)才算支持, 超时或 error 都判定为不支持。
 */
export function canPlayVideoFile(file, timeout = 10000) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file)
        const video = document.createElement('video')
        let done = false

        const finish = (ok) => {
            if (done) return
            done = true
            clearTimeout(timer)
            video.onloadeddata = null
            video.oncanplay = null
            video.onerror = null
            video.removeAttribute('src')
            video.load()
            URL.revokeObjectURL(url)
            resolve(ok)
        }

        const timer = setTimeout(() => finish(false), timeout)
        video.muted = true
        video.playsInline = true
        video.preload = 'auto'
        video.onloadeddata = () => finish(true)
        video.oncanplay = () => finish(true)
        video.onerror = () => finish(false)
        video.src = url
    })
}

export function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const size = (bytes / Math.pow(k, i)).toFixed(2);
    return `${size} ${units[i]}`;
}

export function fileToBase64(file, type = false) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            if (type) {
                const base64 = reader.result;
                resolve(base64);
            } else {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            }
        };
        reader.onerror = reject;
    });
}

export function base64Size(base64String) {
    const padding = (base64String.match(/=*$/) || [''])[0].length;
    const base64Length = base64String.length;
    return (base64Length * 3) / 4 - padding;
}

/**
 * 通过预签名地址把文件直传到对象存储(如 R2)，绕过 Worker 请求体大小限制。
 * 使用 XHR 以便获取上传进度，适合 GB 级大文件。
 * @param {string} url 预签名 PUT 地址
 * @param {File} file 待上传文件
 * @param {string} contentType 与签名时一致的 Content-Type
 * @param {(percent:number)=>void} onProgress 上传进度回调(0-100)
 * @returns {Promise<void>}
 */
export function uploadToPresignedUrl(url, file, contentType, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url, true);
        if (contentType) {
            xhr.setRequestHeader('Content-Type', contentType);
        }
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
                onProgress(Math.round((e.loaded / e.total) * 100));
            }
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
            } else {
                reject(new Error(`上传失败(${xhr.status}): ${(xhr.responseText || '').slice(0, 200)}`));
            }
        };
        xhr.onerror = () => reject(new Error('上传失败，请检查 R2 存储桶的 CORS 配置'));
        xhr.onabort = () => reject(new Error('上传已取消'));
        xhr.send(file);
    });
}

export function compressImage(file, config = {}) {
    return new Promise((resolve, reject) => {

        if (file.size < (config.convertSize || 1024 * 1024)) {
            resolve(file)
        }

        new Compressor(file, {
            quality: config.quality || 0.8,
            mimeType: 'image/jpeg',
            success(result) {
                resolve(result);
            },
            error(err) {
                reject(err);
            },
        });
    });
}