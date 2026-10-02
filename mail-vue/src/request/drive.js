import http from '@/axios/index.js';

//网盘: 列表/搜索/增删改查等接口封装
//上传与 AI 归类耗时较长, 前端给足时间并让视图自己渲染进度与错误提示

//列出目录内容, 返回面包屑与条目(文件夹在前)
export function driveList(parentId) {
    return http.get('/drive/list', {params: {parentId}})
}

//按关键词搜索, 命中的条目会额外带 path 便于展示位置
export function driveSearch(keyword) {
    return http.get('/drive/search', {params: {keyword}})
}

export function driveMkdir(parentId, name) {
    return http.post('/drive/mkdir', {parentId, name})
}

export function driveRename(id, name) {
    return http.post('/drive/rename', {id, name})
}

export function driveMove(ids, targetId) {
    return http.post('/drive/move', {ids, targetId})
}

export function driveCopy(ids, targetId) {
    return http.post('/drive/copy', {ids, targetId})
}

export function driveDelete(ids) {
    return http.post('/drive/delete', {ids})
}

//单文件上传: multipart 带 file 与 parentId, 用 onUploadProgress 驱动进度条
export function driveUpload(file, parentId, onUploadProgress) {
    const data = new FormData()
    data.append('file', file)
    data.append('parentId', String(parentId))
    return http.post('/drive/upload', data, {
        timeout: 300 * 1000,
        noMsg: true,
        onUploadProgress
    })
}

//AI 为选中文件生成标签, 逐文件调用模型, 需要更长时间
export function driveAutotag(ids) {
    return http.post('/drive/autotag', {ids}, {timeout: 300 * 1000, noMsg: true})
}

//AI 智能归类: 自动打标签并移动到 AI 新建的文件夹, 需要更长时间
export function driveTidy(ids) {
    return http.post('/drive/tidy', {ids}, {timeout: 300 * 1000, noMsg: true})
}

//网盘用量统计: 文件数/文件夹数/占用字节
export function driveStats() {
    return http.get('/drive/stats')
}