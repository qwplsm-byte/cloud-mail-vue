import { unzip } from 'fflate'

//本地 Live2D 模型仓库: 上传的压缩包/文件夹解包后按文件存进 IndexedDB, 下次打开直接从本地还原
const DB_NAME = 'ai_live2d_local'
const DB_VERSION = 1
const STORE = 'models'
//最多支持上传 400MB 的模型文件(zip/多选文件总量), 解包后上限 512MB
const MAX_UPLOAD_BYTES = 400 * 1024 * 1024
const MAX_MODEL_BYTES = 512 * 1024 * 1024
//需要被引用的资源类型, 用于从设置 JSON 里收集相对路径
const REF_EXT = /\.(json|png|jpg|jpeg|webp|gif|moc|moc3|mtn|wav|mp3)$/i

const MIME = {
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
}

let dbPromise = null

function fail(code, message) {
  const error = new Error(message || code)
  error.code = code
  return error
}

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.reject(fail('NO_IDB'))
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, {keyPath: 'id'})
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  return dbPromise
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function normalizePath(path) {
  return (path || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

function isJunkPath(path) {
  return /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/.test(path)
}

function mimeOf(path) {
  const ext = path.split('.').pop().toLowerCase()
  return MIME[ext] || 'application/octet-stream'
}

function isSettingsJson(json) {
  if (!json || typeof json !== 'object') return false
  //Cubism 3/4: model3.json 里的 FileReferences
  if (json.FileReferences && (json.FileReferences.Moc || json.FileReferences.Textures)) return true
  //Cubism 2: model.json 里的 model / textures
  return typeof json.model === 'string' && (Array.isArray(json.textures) || json.textures)
}

function isCubism2Settings(json) {
  return !json.FileReferences && typeof json.model === 'string'
}

function collectRefs(node, out) {
  if (typeof node === 'string') {
    if (looksLikeRef(node)) out.push(node)
    return out
  }
  if (Array.isArray(node)) {
    node.forEach(item => collectRefs(item, out))
    return out
  }
  if (node && typeof node === 'object') {
    Object.values(node).forEach(item => collectRefs(item, out))
  }
  return out
}

//设置 JSON 里模型必然需要的文件: moc/moc3 + 贴图
function essentialRefs(json) {
  const refs = []
  const ref = json && json.FileReferences
  if (ref) {
    if (typeof ref.Moc === 'string') refs.push(ref.Moc)
    if (Array.isArray(ref.Textures)) ref.Textures.forEach(item => {
      if (typeof item === 'string') refs.push(item)
    })
  }
  if (typeof json.model === 'string') refs.push(json.model)
  if (Array.isArray(json.textures)) json.textures.forEach(item => {
    if (typeof item === 'string') refs.push(item)
  })
  return refs
}

function looksLikeRef(value) {
  return typeof value === 'string' && value !== '' &&
    !/^(https?|data|blob):/i.test(value) && REF_EXT.test(value)
}

function dirname(path) {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

function resolveRef(settingsPath, ref) {
  const raw = String(ref).replace(/\\/g, '/')
  const parts = []
  //以 / 开头表示相对压缩包根目录
  if (!raw.startsWith('/')) {
    const dir = dirname(settingsPath)
    if (dir) parts.push(...dir.split('/'))
  }
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/')
}

function relativePath(fromDir, target) {
  const from = fromDir ? fromDir.split('/') : []
  const to = target.split('/')
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++
  return [...new Array(from.length - common).fill('..'), ...to.slice(common)].join('/')
}

//把路径清洗成 URL 安全字符: 库内部会用 encodeURI 校验文件路径, 中文/空格/特殊字符会被误判为缺失
function sanitizePath(path) {
  return normalizePath(path).split('/').map(segment => {
    if (/^[A-Za-z0-9._-]+$/.test(segment)) return segment
    return Array.from(segment).map(char => (
      /^[A-Za-z0-9._-]$/.test(char) ? char : `_${char.codePointAt(0).toString(16)}`
    )).join('')
  }).join('/')
}

function uniquePath(path, taken) {
  if (!taken.has(path)) return path
  const dir = dirname(path)
  const base = path.split('/').pop()
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  let index = 1
  let candidate
  do {
    candidate = `${dir ? dir + '/' : ''}${stem}_${index}${ext}`
    index++
  } while (taken.has(candidate))
  return candidate
}

//保证设置文件名能被 pixi-live2d-display 识别 (它只认 model.json / model3.json)
function canonicalSettingsPath(path, cubism2) {
  if (/model(3)?\.json$/.test(path)) return path
  const dir = dirname(path)
  const name = cubism2 ? 'model.json' : 'model3.json'
  return dir ? `${dir}/${name}` : name
}

export function detectModelCandidates(entries) {
  const candidates = []
  for (const entry of entries) {
    if (!/\.json$/i.test(entry.path) || entry.data.length > 2 * 1024 * 1024) continue
    let json
    try {
      json = JSON.parse(new TextDecoder('utf-8').decode(entry.data))
    } catch (e) {
      continue
    }
    if (isSettingsJson(json)) candidates.push({entry, json, cubism2: isCubism2Settings(json)})
  }
  //优先选层级最浅的设置文件, 压缩包里常见的 “外层文件夹/模型名.model3.json”
  candidates.sort((a, b) => a.entry.path.split('/').length - b.entry.path.split('/').length)
  return candidates
}

//把用户选择的文件(压缩包 / 文件夹 / 多选文件)统一成 [{path, data}]
export async function readUploadFiles(fileList) {
  const files = Array.from(fileList || []).filter(file => file && !isJunkPath(file.name))
  if (!files.length) return []

  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    if (files[0].size > MAX_UPLOAD_BYTES) throw fail('TOO_LARGE')
    let entries
    try {
      entries = await unzipToEntries(files[0])
    } catch (e) {
      throw fail('ZIP_INVALID')
    }
    if (entries.reduce((sum, entry) => sum + entry.data.length, 0) > MAX_MODEL_BYTES) throw fail('TOO_LARGE')
    return entries
  }

  const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0)
  if (totalSize > MAX_UPLOAD_BYTES) throw fail('TOO_LARGE')
  const hasRelative = files.some(file => file.webkitRelativePath)
  const entries = []
  for (const file of files) {
    entries.push({
      path: normalizePath(file.webkitRelativePath || file.name),
      data: new Uint8Array(await file.arrayBuffer()),
      name: file.name,
      //没有目录信息时按文件名兜底, 后面再按模型 JSON 里的引用补全相对路径
      flat: !hasRelative,
    })
  }
  return entries
}

function unzipToEntries(blob) {
  return blob.arrayBuffer().then(buffer => new Promise((resolve, reject) => {
    unzip(new Uint8Array(buffer), (error, result) => {
      if (error) return reject(error)
      resolve(Object.entries(result)
        .filter(([path]) => !path.endsWith('/') && !isJunkPath(normalizePath(path)))
        .map(([path, data]) => {
          const normalized = normalizePath(path)
          return {path: normalized, data, name: normalized.split('/').pop()}
        }))
    })
  }))
}

const DELETE = Symbol('delete')

function isEmptyContainer(value) {
  if (Array.isArray(value)) return value.length === 0
  return !!value && typeof value === 'object' && Object.keys(value).length === 0
}

//动作/表情条目丢了文件后只剩名字, 直接整条移除, 避免运行时加载缺失文件
function dropBrokenEntries(json) {
  const refs = json.FileReferences || {}
  const motionGroups = refs.Motions || json.motions
  if (motionGroups && typeof motionGroups === 'object') {
    for (const name of Object.keys(motionGroups)) {
      const list = Array.isArray(motionGroups[name]) ? motionGroups[name] : [motionGroups[name]]
      const kept = list.filter(item => item && (item.File || item.file))
      if (kept.length) motionGroups[name] = kept
      else delete motionGroups[name]
    }
  }
  const expressions = refs.Expressions || json.expressions
  if (Array.isArray(expressions)) {
    const kept = expressions.filter(item => item && (item.File || item.file || typeof item === 'string'))
    if (kept.length) {
      if (refs.Expressions) refs.Expressions = kept
      else json.expressions = kept
    } else if (refs.Expressions) {
      delete refs.Expressions
    } else {
      delete json.expressions
    }
  }
}

//剔除失效引用后留下的空对象/空数组, 例如 motions: { idle: [{}] }
function pruneEmpty(node) {
  if (Array.isArray(node)) {
    for (let index = node.length - 1; index >= 0; index--) {
      pruneEmpty(node[index])
      if (isEmptyContainer(node[index])) node.splice(index, 1)
    }
    return
  }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      pruneEmpty(node[key])
      if (isEmptyContainer(node[key])) delete node[key]
    }
  }
}

function transformRefs(node, visit) {
  if (typeof node === 'string') return visit(node)
  if (Array.isArray(node)) {
    const kept = []
    for (const item of node) {
      const value = transformRefs(item, visit)
      if (value !== DELETE) kept.push(value)
    }
    node.length = 0
    node.push(...kept)
    return node
  }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      const value = transformRefs(node[key], visit)
      if (value === DELETE) delete node[key]
      else node[key] = value
    }
    return node
  }
  return node
}

//平铺选择时没有目录信息, 按设置 JSON 里的引用补回相对路径
function repairFlatPaths(entries, settingsEntry, settingsJson) {
  for (const entry of entries) {
    if (entry === settingsEntry) continue
    if (entry.flat) entry.path = entry.name || entry.path
  }
  const used = new Set([settingsEntry])
  for (const ref of collectRefs(settingsJson, []).map(normalizePath)) {
    const base = ref.split('/').pop().toLowerCase()
    const target = entries.find(entry => !used.has(entry) &&
      (entry.name || entry.path.split('/').pop() || '').toLowerCase() === base)
    if (target) {
      target.path = ref
      used.add(target)
    }
  }
}

export async function saveUploadedModel({id, name, entries, candidate}) {
  if (!candidate) throw fail('NO_MODEL')
  const settingsEntry = candidate.entry
  const originalJson = candidate.json
  const cubism2 = candidate.cubism2 === true || isCubism2Settings(originalJson)

  if (settingsEntry.flat) repairFlatPaths(entries, settingsEntry, originalJson)

  //1. 全部文件路径清洗成 URL 安全字符, 同时记录原始 -> 新路径的映射
  const pathMap = new Map()
  const taken = new Set()
  for (const entry of entries) {
    const target = uniquePath(sanitizePath(entry.path), taken)
    pathMap.set(entry.path, target)
    taken.add(target)
  }
  let settingsPath = pathMap.get(settingsEntry.path)
  const canonical = canonicalSettingsPath(settingsPath, cubism2)
  if (canonical !== settingsPath) {
    taken.delete(settingsPath)
    settingsPath = uniquePath(canonical, taken)
    taken.add(settingsPath)
    pathMap.set(settingsEntry.path, settingsPath)
  }

  //2. 重写设置 JSON: 引用改成清洗后的相对路径, 缺失的可选文件直接剔除
  const settingsDir = dirname(settingsPath)
  const essentialSet = new Set(essentialRefs(originalJson))
  const findEntryPath = originalPath => {
    if (pathMap.has(originalPath)) return originalPath
    const lower = originalPath.toLowerCase()
    for (const key of pathMap.keys()) {
      if (key.toLowerCase() === lower) return key
    }
    return null
  }
  const rewritten = JSON.parse(JSON.stringify(originalJson))
  transformRefs(rewritten, value => {
    if (!looksLikeRef(value)) return value
    const originalPath = resolveRef(settingsEntry.path, value)
    const hit = findEntryPath(originalPath)
    if (!hit) {
      //moc/贴图缺失必须报错, 动作/物理等可选文件缺失就丢掉引用, 避免运行时找不到文件
      return essentialSet.has(value) ? value : DELETE
    }
    return relativePath(settingsDir, pathMap.get(hit))
  })
  dropBrokenEntries(rewritten)
  pruneEmpty(rewritten)

  //3. 更新文件路径与设置文件内容
  const paths = new Set()
  for (const entry of entries) {
    entry.path = entry === settingsEntry ? settingsPath : pathMap.get(entry.path)
    paths.add(entry.path)
  }
  settingsEntry.data = new TextEncoder().encode(JSON.stringify(rewritten))

  //4. 只强制校验核心文件, 与 pixi-live2d-display 的 validateFiles 行为一致
  const missing = essentialRefs(rewritten)
    .map(ref => resolveRef(settingsPath, ref))
    .filter(path => !paths.has(path))
  if (missing.length) {
    throw fail('MISSING_FILES', missing.slice(0, 5).join(', '))
  }

  const total = entries.reduce((sum, entry) => sum + entry.data.length, 0)
  if (total > MAX_MODEL_BYTES) throw fail('TOO_LARGE')

  const record = {
    id,
    name,
    settingsPath,
    size: total,
    createdAt: Date.now(),
    files: entries.map(entry => ({
      path: entry.path,
      blob: new Blob([entry.data], {type: mimeOf(entry.path)}),
    })),
  }
  await putRecord(record)
  return record
}

async function putRecord(record) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error && tx.error.name === 'QuotaExceededError' ? fail('QUOTA') : fail('SAVE_FAILED'))
  })
}

export async function loadLocalModelFiles(id) {
  const db = await openDb()
  const record = await requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).get(id))
  if (!record || !Array.isArray(record.files) || !record.files.length) throw fail('LOCAL_MISSING')

  const files = record.files.map(item => {
    const name = item.path.split('/').pop()
    const file = new File([item.blob], name, {type: item.blob.type || mimeOf(item.path)})
    //pixi-live2d-display 依赖 webkitRelativePath 来还原模型内的相对目录
    Object.defineProperty(file, 'webkitRelativePath', {value: item.path})
    return file
  })
  //让当前选中的设置文件排在最前, 压缩包内有多个模型时不会被别的模型顶掉
  const settingsIndex = files.findIndex(file => file.webkitRelativePath === record.settingsPath)
  if (settingsIndex > 0) files.unshift(...files.splice(settingsIndex, 1))
  return files
}

export async function deleteLocalModel(id) {
  const db = await openDb()
  return requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id))
}

export function newLocalModelId() {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}
