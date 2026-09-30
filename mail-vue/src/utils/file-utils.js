import Compressor from "compressorjs";

export function getExtName(fileName) {
    const index = fileName.lastIndexOf('.')
    return index !== -1 ? fileName.slice(index + 1).toLowerCase() : ''
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