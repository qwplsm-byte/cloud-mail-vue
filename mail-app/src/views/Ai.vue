<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  aiAssistant, aiExecute, aiThinking, aiChatHistory, aiChatSave, aiChatClear,
  aiMemory, aiMemorySave, aiMemoryRemove, aiMemoryClear, aiMemorySaveProfile
} from '../api/index.js'
import { registerBack, unregisterBack } from '../utils/back.js'
import { toast } from '../toast.js'
import { confirmDialog, pickDialog } from '../ui/dialog.js'
import Live2DView from '../components/Live2DView.vue'
import {
  deleteLocalModel,
  detectModelCandidates,
  newLocalModelId,
  readUploadFiles,
  saveUploadedModel
} from '../utils/live2dLocal.js'

const presets = [
  { label: '整理未分类邮件', prompt: '帮我整理未分类的邮件，按类型归类' },
  { label: '清理推广邮件', prompt: '找出推广/广告类邮件并删除' },
  { label: '未读摘要', prompt: '总结我未读的邮件，按重要程度列出' },
  { label: '写一封邮件', prompt: '帮我写一封邮件，收件人是' }
]

const MEMORY_CATEGORIES = [
  { value: 'fact', label: '事实' },
  { value: 'preference', label: '偏好' },
  { value: 'identity', label: '身份' },
  { value: 'contact', label: '联系人' },
  { value: 'sendFrom', label: '默认发件' },
  { value: 'other', label: '其它' }
]

const ENGINES = [
  { value: 'auto', label: '自动' },
  { value: 'duckduckgo', label: 'DuckDuckGo' },
  { value: 'bing', label: 'Bing' },
  { value: 'baidu', label: '百度' },
  { value: 'mojeek', label: 'Mojeek' },
  { value: 'searxng', label: '自定义 SearXNG' }
]

const MAX_ATTACH = 3
const MAX_ATTACH_BYTES = 8 * 1024 * 1024
const MAX_TEXT_CHARS = 12000
const MAX_IMAGE_EDGE = 1280
const TEXT_EXT = ['txt', 'md', 'markdown', 'json', 'csv', 'log', 'yml', 'yaml', 'ini', 'conf', 'xml', 'html', 'css', 'js', 'ts', 'py', 'java', 'go', 'sql', 'sh']

const messages = ref([])
const input = ref('')
const busy = ref(false)
const caps = ref(null)
const thinking = ref('')
const webSearch = ref(false)
const searchOpen = ref(false)
const searchEngine = ref('auto')
const searchEndpoint = ref('')
const attachments = ref([])
const fileRef = ref(null)

const chatRef = ref(null)
const anchorRef = ref(null)
const inputRef = ref(null)
// 历史记录加载完成前不触发保存，避免把空列表写回服务端
const historyReady = ref(false)

/* ---------------- AI 记忆 ---------------- */
const memoryOpen = ref(false)
const memory = ref(null)
const memoryLoading = ref(false)
const memEdit = ref({ open: false, id: 0, category: 'fact', content: '' })
const profileEdit = ref({ open: false, content: '' })

const LEVEL_LABEL = { off: '关闭', low: '低', medium: '中', high: '高' }

const levels = computed(() => {
  const c = caps.value
  return c && c.supported && Array.isArray(c.levels) ? c.levels : []
})

function loadPrefs() {
  try {
    const raw = localStorage.getItem('ai_search_pref')
    const data = raw ? JSON.parse(raw) : {}
    if (ENGINES.some(e => e.value === data.engine)) searchEngine.value = data.engine
    if (typeof data.endpoint === 'string') searchEndpoint.value = data.endpoint
  } catch (e) { /* 忽略损坏的本地配置 */ }
  try {
    const lv = localStorage.getItem('ai_thinking_level')
    if (lv) thinking.value = lv
  } catch (e) { /* 忽略 */ }
}

function saveSearchPref() {
  try {
    localStorage.setItem('ai_search_pref', JSON.stringify({
      engine: searchEngine.value,
      endpoint: searchEndpoint.value.trim()
    }))
  } catch (e) { /* 忽略配额错误 */ }
}

const engineLabel = computed(() => (ENGINES.find(e => e.value === searchEngine.value) || ENGINES[0]).label)

async function pickEngine() {
  const v = await pickDialog({
    title: '搜索引擎',
    options: ENGINES.map(e => ({ value: e.value, label: e.label })),
    value: searchEngine.value
  })
  if (v === null) return
  searchEngine.value = v
  saveSearchPref()
}

async function pickMemoryCategory() {
  const v = await pickDialog({ title: '记忆类型', options: MEMORY_CATEGORIES, value: memEdit.value.category })
  if (v === null) return
  memEdit.value.category = v
}

/* ---------------- AI 形象 (Live2D) ---------------- */
const LIVE2D_KEY = 'ai_live2d_v2'
const LEGACY_KEY = 'ai_live2d_v1'
const live2dOpen = ref(false)
const live2d = ref({ enabled: false, models: [], current: '' })
const live2dError = ref('')
const newModelName = ref('')
const newModelUrl = ref('')
const uploadingModel = ref(false)
const modelFileRef = ref(null)
const live2dRef = ref(null)

//对话驱动形象: 思考时显示"加载", 回答成功给个好脸色, 出错流冷汗
const HAPPY_STATES = ['＞＜', '爱心眼', '兔牙', '脸红', '屑屑眼']
const SAD_STATES = ['流冷汗', '黑脸']

function live2dHold(name) {
  const view = live2dRef.value
  if (view && view.hasState(name)) view.hold(name)
}

function live2dReact(candidates) {
  const view = live2dRef.value
  if (!view) return
  const pool = candidates.filter(name => view.hasState(name))
  if (!pool.length) return
  view.react(pool[Math.floor(Math.random() * pool.length)])
}

function live2dClear() {
  if (live2dRef.value) live2dRef.value.clear()
}

const currentLive2d = computed(() => {
  const d = live2d.value
  return d.models.find(m => m.key === d.current) || d.models[0] || null
})
//关闭开关或没有可用模型时侧栏不渲染, 页面自动回到全屏对话
const live2dShown = computed(() => live2d.value.enabled && !!currentLive2d.value)

//形象栏宽度可拖动调整, 收起后对话区占满全宽
const LV_WIDTH_KEY = 'ai_live2d_width'
const LV_COLLAPSED_KEY = 'ai_live2d_collapsed'
const LV_MIN_WIDTH = 88
const lvWidth = ref(0)
const lvCollapsed = ref(false)
const lvAsideRef = ref(null)
const lvAsideShown = computed(() => live2dShown.value && !lvCollapsed.value)
const lvStyle = computed(() => (lvWidth.value > 0 ? {'--ai-lv-w': lvWidth.value + 'px'} : {}))
try {
  const savedWidth = Number(localStorage.getItem(LV_WIDTH_KEY))
  if (savedWidth > 0) lvWidth.value = savedWidth
  lvCollapsed.value = localStorage.getItem(LV_COLLAPSED_KEY) === '1'
} catch (e) { /* 忽略读取失败 */ }

function startLvResize(event) {
  if (event.button !== undefined && event.button !== 0) return
  event.preventDefault()
  const startX = event.clientX
  const startWidth = lvWidth.value || (lvAsideRef.value && lvAsideRef.value.clientWidth) || 0
  const maxWidth = Math.round(window.innerWidth * 0.62)
  const move = ev => {
    lvWidth.value = Math.min(maxWidth, Math.max(LV_MIN_WIDTH, startWidth + ev.clientX - startX))
  }
  const up = () => {
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', up)
    try {
      localStorage.setItem(LV_WIDTH_KEY, String(lvWidth.value))
    } catch (e) { /* 忽略写入失败 */ }
  }
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', up)
}

function resetLvWidth() {
  lvWidth.value = 0
  try {
    localStorage.removeItem(LV_WIDTH_KEY)
  } catch (e) { /* 忽略 */ }
}

function toggleLvCollapse() {
  lvCollapsed.value = !lvCollapsed.value
  try {
    localStorage.setItem(LV_COLLAPSED_KEY, lvCollapsed.value ? '1' : '0')
  } catch (e) { /* 忽略 */ }
}

function normalizeModel(item) {
  if (!item || typeof item.name !== 'string') return null
  if (item.type === 'local' && typeof item.id === 'string') {
    return { key: 'local:' + item.id, type: 'local', name: item.name, id: item.id }
  }
  if (typeof item.url === 'string' && item.url) {
    return { key: 'url:' + item.url, type: 'url', name: item.name, url: item.url }
  }
  return null
}

function loadLive2dPref() {
  try {
    let raw = JSON.parse(localStorage.getItem(LIVE2D_KEY) || 'null')
    //旧版本只支持 URL 模型, 这里做一次结构迁移
    if (!raw) {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null')
      if (legacy && Array.isArray(legacy.models)) {
        legacy.models = legacy.models
          .filter(m => m && typeof m.name === 'string' && typeof m.url === 'string')
          .map(m => ({ type: 'url', name: m.name, url: m.url }))
        legacy.current = legacy.current ? 'url:' + legacy.current : ''
        raw = legacy
      }
    }
    if (!raw || !Array.isArray(raw.models)) return
    const models = raw.models.map(normalizeModel).filter(Boolean)
    let current = raw.current || (models[0] && models[0].key) || ''
    if (!models.some(m => m.key === current)) current = (models[0] && models[0].key) || ''
    live2d.value = { enabled: !!raw.enabled && models.length > 0, models, current }
    saveLive2dPref()
  } catch (e) {
    //本地存档损坏时按未启用处理
  }
}

function saveLive2dPref() {
  try {
    localStorage.setItem(LIVE2D_KEY, JSON.stringify(live2d.value))
  } catch (e) {
    //隐私模式下写不进 localStorage, 只影响下次打开时的记忆
  }
}

function onLive2dToggle() {
  if (!live2d.value.enabled && !live2d.value.models.length) {
    toast('请先添加一个模型')
    return
  }
  live2d.value.enabled = !live2d.value.enabled
  live2dError.value = ''
  saveLive2dPref()
}

function selectLive2dModel(item) {
  live2d.value.current = item.key
  live2dError.value = ''
  saveLive2dPref()
}

function addLive2dModel() {
  const name = newModelName.value.trim()
  const url = newModelUrl.value.trim()
  if (!name) { toast('请填写模型名称'); return }
  if (!/\.model(3)?\.json($|\?)/i.test(url)) { toast('请填写以 .model3.json 或 .model.json 结尾的模型地址'); return }
  if (live2d.value.models.some(m => m.url === url)) { toast('这个模型已经添加过了'); return }
  const item = { key: 'url:' + url, type: 'url', name, url }
  live2d.value.models.push(item)
  live2d.value.current = item.key
  live2d.value.enabled = true
  live2dError.value = ''
  newModelName.value = ''
  newModelUrl.value = ''
  saveLive2dPref()
  toast('模型已添加')
}

function guessModelName(files, candidate) {
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    return files[0].name.replace(/\.zip$/i, '').slice(0, 40)
  }
  const relative = files.find(file => file.webkitRelativePath)?.webkitRelativePath
  if (relative) return relative.split('/')[0].slice(0, 40)
  const path = candidate.entry.path
  if (path.includes('/')) return path.split('/')[0].slice(0, 40)
  return path.replace(/\.model(3)?\.json$/i, '').slice(0, 40) || '本地模型'
}

async function onModelFilesChange(event) {
  const input = event.target
  const files = Array.from(input.files || [])
  //清空 input, 方便再次选择同一个文件
  input.value = ''
  if (!files.length) return

  uploadingModel.value = true
  try {
    const entries = await readUploadFiles(files)
    const candidates = detectModelCandidates(entries)
    if (!candidates.length) { toast('没有找到 Live2D 设置文件（model3.json / model.json）'); return }
    const candidate = candidates[0]
    const name = newModelName.value.trim() || guessModelName(files, candidate)
    const id = newLocalModelId()
    await saveUploadedModel({ id, name, entries, candidate })

    const item = { key: 'local:' + id, type: 'local', name, id }
    live2d.value.models.push(item)
    live2d.value.current = item.key
    live2d.value.enabled = true
    live2dError.value = ''
    newModelName.value = ''
    saveLive2dPref()
    toast('模型已上传并启用')
  } catch (e) {
    const code = e && e.code
    let message = '模型保存失败，请重试'
    if (code === 'NO_MODEL') message = '没有找到 Live2D 设置文件'
    else if (code === 'MISSING_FILES') message = '模型缺少文件：' + (e.message || '')
    else if (code === 'TOO_LARGE') message = '模型体积过大（上限 400MB）'
    else if (code === 'QUOTA') message = '本地存储空间不足，模型保存失败'
    else if (code === 'ZIP_INVALID') message = '压缩包读取失败，请确认是有效的 zip'
    toast(message)
    console.warn('[live2d] upload failed', e)
  } finally {
    uploadingModel.value = false
  }
}

async function removeLive2dModel(item) {
  if (!await confirmDialog({ title: '删除模型', message: `删除「${item.name}」？`, okText: '删除', danger: true })) return
  const d = live2d.value
  const index = d.models.findIndex(m => m.key === item.key)
  if (index < 0) return
  d.models.splice(index, 1)
  if (item.type === 'local' && item.id) {
    deleteLocalModel(item.id).catch(e => console.warn('[live2d] delete local model failed', e))
  }
  if (d.current === item.key) d.current = (d.models[0] && d.models[0].key) || ''
  if (!d.models.length) d.enabled = false
  live2dError.value = ''
  saveLive2dPref()
}

function onLive2dError(message) {
  live2dError.value = message || '形象加载失败'
}

loadLive2dPref()

onMounted(async () => {
  registerBack(() => {
    if (profileEdit.value.open) { profileEdit.value.open = false; return true }
    if (memEdit.value.open) { memEdit.value.open = false; return true }
    if (live2dOpen.value) { live2dOpen.value = false; return true }
    if (memoryOpen.value) { memoryOpen.value = false; return true }
    if (searchOpen.value) { searchOpen.value = false; return true }
    return false
  })

  loadPrefs()

  aiThinking().then(c => {
    caps.value = c
    if (c && c.supported && Array.isArray(c.levels) && !c.levels.includes(thinking.value)) thinking.value = ''
  }).catch(() => {})

  try {
    const data = await aiChatHistory()
    const rows = (data && data.messages) || []
    // 若历史还没回来用户就已发消息，不能覆盖本地内容
    if (!messages.value.length) {
      messages.value = rows
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({
          id: m.id,
          role: m.role,
          content: m.content || '',
          actions: (m.plan && m.plan.actions) || [],
          results: m.results || [],
          sources: m.sources || [],
          status: m.status || 'done',
          loading: false
        }))
    }
    scrollSoon()
  } catch (e) { /* 首次登录/无历史时忽略 */ }
  historyReady.value = true

  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', flushSave)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('pagehide', flushSave)
  flushSave()
})

watch(messages, scheduleSave, { deep: true })

function onVisibility() {
  if (document.hidden) flushSave()
}

function uid() {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function scrollSoon() {
  nextTick(() => {
    if (anchorRef.value) anchorRef.value.scrollIntoView({ block: 'end' })
  })
}

function historyPayload() {
  return messages.value
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
    .map(m => ({ role: m.role, content: m.content }))
}

/* ---------------- 附件 ---------------- */

function isTextFile(file) {
  if (file.type.startsWith('text/')) return true
  if (/^application\/(json|xml|x-yaml|javascript)/.test(file.type)) return true
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  return TEXT_EXT.includes(ext)
}

function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const image = new Image()
      image.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.width, image.height, 1))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      image.onerror = reject
      image.src = reader.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function readAttachment(file) {
  if (file.size > MAX_ATTACH_BYTES) { toast('附件超过 8MB'); return null }
  const key = Date.now() + '_' + file.name
  if (file.type.startsWith('image/')) {
    return { key, type: 'image', name: file.name, dataUrl: await shrinkImage(file) }
  }
  if (!isTextFile(file)) { toast('仅支持图片和纯文本文件'); return null }
  return { key, type: 'text', name: file.name, content: (await file.text()).slice(0, MAX_TEXT_CHARS) }
}

async function onFileChange(e) {
  const files = Array.from(e.target.files || [])
  e.target.value = ''
  for (const file of files) {
    if (attachments.value.length >= MAX_ATTACH) { toast(`最多 ${MAX_ATTACH} 个附件`); break }
    try {
      const item = await readAttachment(file)
      if (item) attachments.value.push(item)
    } catch (err) {
      toast('读取附件失败')
    }
  }
}

function removeAttachment(i) {
  attachments.value.splice(i, 1)
}

/* ---------------- 发送 ---------------- */

async function send() {
  const text = input.value.trim()
  const files = attachments.value.slice()
  if ((!text && !files.length) || busy.value) return

  const history = historyPayload()
  messages.value.push({ id: uid(), role: 'user', content: text, attachments: files, status: 'done' })
  input.value = ''
  attachments.value = []
  if (inputRef.value) inputRef.value.style.height = 'auto'
  busy.value = true
  scrollSoon()

  const placeholder = { id: uid(), role: 'assistant', content: '正在思考…', pending: true, status: 'pending', actions: [], results: [], sources: [] }
  messages.value.push(placeholder)
  //思考期间一直保持"加载"状态
  live2dHold('加载')

  if (webSearch.value) saveSearchPref()

  try {
    const data = await aiAssistant(text || '（见附件）', history, thinking.value, {
      webSearch: webSearch.value,
      searchEngine: searchEngine.value,
      searchEndpoint: searchEndpoint.value.trim(),
      attachments: files
    })
    placeholder.content = (data && data.reply) || '（空回复）'
    placeholder.actions = (data && data.actions) || []
    placeholder.sources = (data && data.sources) || []
    placeholder.searchFailed = !!data?.searchFailed
    placeholder.status = placeholder.actions.length ? 'pending' : 'done'
    //有操作计划时戴单片眼镜装懂, 普通回答换个好脸色
    if (placeholder.actions.length) {
      live2dHold('单片眼镜')
    } else {
      live2dReact(HAPPY_STATES)
    }
  } catch (e) {
    placeholder.content = '请求失败：' + (e.message || '未知错误')
    placeholder.error = true
    placeholder.status = 'error'
    live2dReact(SAD_STATES)
  } finally {
    placeholder.pending = false
    busy.value = false
    scrollSoon()
    save()
  }
}

async function run(msg, action) {
  if (!action || msg.executing || msg.executed) return
  msg.executing = true
  live2dHold('加载')
  try {
    const res = await aiExecute([action])
    msg.results = (msg.results || []).concat(res || [])
    msg.executed = true
    msg.status = 'done'
    live2dReact(HAPPY_STATES)
  } catch (e) {
    msg.results = (msg.results || []).concat([{ success: false, message: e.message || '执行失败' }])
    msg.status = 'error'
    live2dReact(SAD_STATES)
  } finally {
    msg.executing = false
    save()
  }
}

function resultLine(r) {
  if (r.success === false) return '失败：' + (r.message || '未知原因')
  const d = r.description || r.type || '操作'
  return '已完成：' + d + (r.count ? `（${r.count}）` : '')
}

// 附件只保存元信息: 图片 base64 体积很大, 上传会撑爆保存请求导致整段对话丢失
function stripAttachments(list) {
  return (Array.isArray(list) ? list : []).map(f => ({ key: f.key, type: f.type, name: f.name }))
}

function savePayload() {
  return messages.value
    .filter(m => !m.pending && (m.role === 'user' || m.role === 'assistant'))
    .map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      plan: m.actions && m.actions.length ? { actions: m.actions } : undefined,
      status: m.status,
      results: m.results,
      sources: m.sources,
      searchFailed: !!m.searchFailed,
      attachments: m.attachments && m.attachments.length ? stripAttachments(m.attachments) : undefined
    }))
}

let saveTimer = null
let retryTimer = null

async function save() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  const payload = savePayload()
  if (!payload.length) return
  try {
    await aiChatSave(payload)
  } catch (e) {
    // 保存失败不能静默丢弃: 稍后重试, 网络恢复后仍能补上
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = setTimeout(() => { retryTimer = null; save() }, 3000)
  }
}

// 深度监听 + 防抖: 任何消息变化都会触发增量保存
function scheduleSave() {
  if (!historyReady.value) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { saveTimer = null; save() }, 600)
}

// 切后台/退出前立即落盘, 防止进程被回收导致最近的对话丢失
function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  if (historyReady.value) save()
}

async function clearAll() {
  if (!messages.value.length) return
  if (!await confirmDialog({ title: '清空对话', message: '清空全部对话？', okText: '清空', danger: true })) return
  try {
    await aiChatClear()
    messages.value = []
    live2dClear()
    toast('已清空')
  } catch (e) {
    toast(e.message || '清空失败')
  }
}

function pickLevel(lv) {
  thinking.value = thinking.value === lv ? '' : lv
  try { localStorage.setItem('ai_thinking_level', thinking.value) } catch (e) { /* 忽略 */ }
}

function grow() {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 112) + 'px'
}

/* ---------------- 记忆面板 ---------------- */

async function openMemory() {
  memoryOpen.value = true
  await loadMemory()
}

async function loadMemory() {
  memoryLoading.value = true
  try {
    memory.value = await aiMemory()
  } catch (e) {
    toast(e.message || '读取记忆失败')
  } finally {
    memoryLoading.value = false
  }
}

function categoryLabel(c) {
  const hit = MEMORY_CATEGORIES.find(x => x.value === c)
  return hit ? hit.label : '其它'
}

function startAddMemory() {
  memEdit.value = { open: true, id: 0, category: 'fact', content: '' }
}

function startEditMemory(m) {
  memEdit.value = { open: true, id: m.id, category: m.category || 'fact', content: m.content || '' }
}

async function saveMemory() {
  const content = memEdit.value.content.trim()
  if (!content) { toast('记忆内容不能为空'); return }
  try {
    await aiMemorySave({ id: memEdit.value.id || undefined, category: memEdit.value.category, content })
    memEdit.value.open = false
    toast('已保存')
    await loadMemory()
  } catch (e) {
    toast(e.message || '保存失败')
  }
}

async function removeMemory(m) {
  if (!await confirmDialog({ title: '删除记忆', message: '删除这条记忆？', okText: '删除', danger: true })) return
  try {
    await aiMemoryRemove([m.id])
    toast('已删除')
    await loadMemory()
  } catch (e) {
    toast(e.message || '删除失败')
  }
}

async function clearMemory() {
  if (!await confirmDialog({ title: '清空记忆', message: '清空全部记忆与画像？', okText: '清空', danger: true })) return
  try {
    await aiMemoryClear()
    toast('已清空')
    await loadMemory()
  } catch (e) {
    toast(e.message || '清空失败')
  }
}

function startEditProfile() {
  profileEdit.value = { open: true, content: (memory.value && memory.value.profile) || '' }
}

async function saveProfile() {
  try {
    await aiMemorySaveProfile(profileEdit.value.content || '')
    profileEdit.value.open = false
    toast('画像已保存')
    await loadMemory()
  } catch (e) {
    toast(e.message || '保存失败')
  }
}
</script>

<template>
  <div class="page ai-page" :class="{ 'has-live2d': lvAsideShown }" :style="lvStyle">
    <!-- 左侧半身 Live2D 形象; 关闭开关或没有模型时整块不渲染, 布局回到原来的全屏对话 -->
    <aside v-if="lvAsideShown" ref="lvAsideRef" class="ai-live2d">
      <!-- 拖动调整形象栏宽度, 双击恢复默认 -->
      <div class="lv-resizer" @pointerdown="startLvResize" @dblclick="resetLvWidth"></div>
      <div class="live2d-stage">
        <Live2DView ref="live2dRef"
                    :url="currentLive2d.type === 'url' ? currentLive2d.url : ''"
                    :local-id="currentLive2d.type === 'local' ? currentLive2d.id : ''"
                    @ready="live2dError = ''" @error="onLive2dError" />
      </div>
      <div class="live2d-foot">
        <span class="live2d-name">{{ currentLive2d.name }}</span>
        <button class="live2d-set" title="收起形象" @click="toggleLvCollapse">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 6l-6 6 6 6"/>
          </svg>
        </button>
        <button class="live2d-set" title="AI 形象" @click="live2dOpen = true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z"/>
          </svg>
        </button>
      </div>
      <div v-if="live2dError" class="live2d-err">{{ live2dError }}</div>
    </aside>

    <header class="hdr glass">
      <div class="hdr-top">
        <div>
          <h1>AI</h1>
          <div class="sub">{{ caps && caps.model ? caps.model : '爱蜜莉雅' }}</div>
        </div>
        <button v-if="live2dShown && lvCollapsed" class="icon-btn" @click="toggleLvCollapse" title="展开形象">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 6l6 6-6 6"/>
          </svg>
        </button>
        <button class="icon-btn" @click="live2dOpen = true" title="AI 形象">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="8" r="4"/>
            <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6"/>
            <path d="M17.5 4.5l.7 1.5 1.5.7-1.5.7-.7 1.5-.7-1.5-1.5-.7 1.5-.7Z"/>
          </svg>
        </button>
        <button class="icon-btn" @click="openMemory" title="AI 记忆">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0 0 6v1a3 3 0 0 0 3 3" />
            <path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 0 6v1a3 3 0 0 1-3 3" />
            <path d="M12 4v16" />
          </svg>
        </button>
        <button class="icon-btn" @click="clearAll" title="清空对话">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 7h16" />
            <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            <path d="M6 7l1 13h10l1-13" />
          </svg>
        </button>
      </div>

      <div class="tool-row">
        <div v-if="levels.length" class="levels inline">
          <button
            v-for="lv in levels"
            :key="lv"
            :class="{ on: thinking === lv }"
            @click="pickLevel(lv)"
          >思考 · {{ LEVEL_LABEL[lv] || lv }}</button>
        </div>
        <button class="chip search-chip" :class="{ on: webSearch }" @click="webSearch = !webSearch; saveSearchPref()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
          </svg>
          联网搜索
        </button>
        <button class="chip" :class="{ on: searchOpen }" @click="searchOpen = true">搜索来源</button>
      </div>
    </header>

    <div ref="chatRef" class="chat">
      <div v-if="!messages.length" class="empty">
        <b>有什么可以帮你？</b>
        <span>可以问邮件、写草稿、找文件，也能发图片和文件给我看</span>
      </div>

      <div v-if="!messages.length" class="presets">
        <button v-for="p in presets" :key="p.label" @click="input = p.prompt; nextTick(() => { grow(); if (inputRef) inputRef.focus() })">{{ p.label }}</button>
      </div>

      <div v-for="m in messages" :key="m.id" class="msg" :class="m.role === 'user' ? 'me' : 'ai'">
        <div class="bubble" :class="{ pending: m.pending }">
          <template v-if="m.attachments && m.attachments.length">
            <div class="bubble-atts">
              <span v-for="f in m.attachments" :key="f.key" class="bubble-att">{{ f.type === 'image' ? '图片' : '文件' }}：{{ f.name }}</span>
            </div>
          </template>
          {{ m.content }}
          <div v-if="m.actions && m.actions.length && !m.executed" class="actions">
            <div v-for="(a, i) in m.actions" :key="i" class="act">
              <span>{{ a.description || a.type }}</span>
              <button class="go" :disabled="m.executing || m.error" @click="run(m, a)">
                {{ m.executing ? '执行中…' : '执行' }}
              </button>
            </div>
          </div>
          <div v-if="m.results && m.results.length" class="sources">
            <div v-for="(r, i) in m.results" :key="i">{{ resultLine(r) }}</div>
          </div>
          <div v-if="m.sources && m.sources.length" class="sources">
            <a v-for="(s, i) in m.sources" :key="i" :href="s.url" target="_blank" rel="noreferrer">{{ s.title || s.url }}</a>
          </div>
          <div v-if="m.searchFailed" class="sources">联网搜索失败，已按离线知识回答</div>
        </div>
      </div>
      <div ref="anchorRef" style="height: 130px"></div>
    </div>

    <div class="composer">
      <div v-if="attachments.length" class="attach-list">
        <div v-for="(f, i) in attachments" :key="f.key" class="attach-item">
          <img v-if="f.type === 'image'" class="attach-thumb" :src="f.dataUrl" alt="" />
          <span v-else class="attach-file">文件</span>
          <span class="attach-name">{{ f.name }}</span>
          <button class="attach-del" @click="removeAttachment(i)">×</button>
        </div>
      </div>
      <div class="box">
        <button class="attach-btn" title="添加图片或文件" :disabled="busy" @click="fileRef && fileRef.click()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.5l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l9-9a3.8 3.8 0 0 1 5.4 5.4l-8.5 8.5a2.1 2.1 0 0 1-3-3l7.8-7.8" />
          </svg>
        </button>
        <input ref="fileRef" class="hidden-file" type="file" multiple
               accept="image/*,.txt,.md,.markdown,.json,.csv,.log,.yml,.yaml,.ini,.conf,.xml,.html,.css,.js,.ts,.py,.java,.go,.sql,.sh"
               @change="onFileChange" />
        <textarea
          ref="inputRef"
          v-model="input"
          rows="1"
          placeholder="说点什么…"
          @input="grow"
          @keydown.enter.exact.prevent="send"
        ></textarea>
        <button class="send" :disabled="busy || (!input.trim() && !attachments.length)" @click="send">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12l16-8-6 16-3-6-7-2Z" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 搜索来源设置 -->
    <section v-if="searchOpen" class="sheet-mask" @click.self="searchOpen = false">
      <div class="sheet">
        <div class="sheet-bar">
          <b>联网搜索设置</b>
          <button class="x" @click="searchOpen = false">完成</button>
        </div>
        <div class="sheet-scroll">
          <div class="set-row">
            <span class="set-label">启用联网搜索</span>
            <button class="sw" :class="{ on: webSearch }" @click="webSearch = !webSearch; saveSearchPref()"><span></span></button>
          </div>
          <div class="set-row">
            <span class="set-label">搜索引擎</span>
            <button class="set-select pick" @click="pickEngine">
              <span>{{ engineLabel }}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
          </div>
          <div class="form-field" v-if="searchEngine === 'searxng'">
            <label>SearXNG 实例地址</label>
            <input v-model="searchEndpoint" placeholder="https://searx.example.com" @change="saveSearchPref" />
          </div>
          <div class="hint">搜索来源按设备保存；开启后本次提问会先联网检索再回答。</div>
        </div>
      </div>
    </section>

    <!-- AI 记忆 -->
    <section v-if="memoryOpen" class="sheet-mask" @click.self="memoryOpen = false">
      <div class="sheet">
        <div class="sheet-bar">
          <b>AI 记忆</b>
          <button class="x" @click="memoryOpen = false">关闭</button>
        </div>
        <div class="sheet-scroll">
          <div v-if="memoryLoading" class="empty small"><b>加载中…</b></div>
          <template v-else>
            <div class="mem-profile">
              <div class="mem-head">
                <span>用户画像</span>
                <button class="mini-btn" @click="startEditProfile">编辑</button>
              </div>
              <div v-if="memory && memory.profile" class="mem-body">{{ memory.profile }}</div>
              <div v-else class="hint">还没有画像，点编辑手动写一段。</div>
            </div>

            <div class="mem-head">
              <span>记忆 {{ (memory && memory.memories || []).length }} 条</span>
              <div class="mem-head-acts">
                <button class="mini-btn" @click="startAddMemory">新增</button>
                <button class="mini-btn danger" @click="clearMemory">清空</button>
              </div>
            </div>

            <div v-if="!(memory && (memory.memories || []).length)" class="empty small">
              <b>还没有记忆</b>
              <span>多和 AI 聊天，它会记住你的偏好</span>
            </div>
            <div v-for="m in (memory && memory.memories) || []" :key="m.id" class="mem-row">
              <span class="mem-cat">{{ categoryLabel(m.category) }}</span>
              <span class="mem-txt">{{ m.content }}</span>
              <div class="mem-acts">
                <button @click="startEditMemory(m)">改</button>
                <button class="danger" @click="removeMemory(m)">删</button>
              </div>
            </div>
          </template>
        </div>

        <!-- 记忆编辑表单 -->
        <div v-if="memEdit.open" class="mem-editor">
          <button class="set-select pick block" @click="pickMemoryCategory">
            <span>{{ categoryLabel(memEdit.category) }}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          <textarea v-model="memEdit.content" class="set-input set-area" rows="3" placeholder="要记住的内容"></textarea>
          <div class="mem-head-acts">
            <button class="mini-btn" @click="memEdit.open = false">取消</button>
            <button class="mini-btn primary" @click="saveMemory">保存</button>
          </div>
        </div>

        <!-- 画像编辑表单 -->
        <div v-if="profileEdit.open" class="mem-editor">
          <textarea v-model="profileEdit.content" class="set-input set-area" rows="4" placeholder="描述主人的身份、偏好等"></textarea>
          <div class="mem-head-acts">
            <button class="mini-btn" @click="profileEdit.open = false">取消</button>
            <button class="mini-btn primary" @click="saveProfile">保存</button>
          </div>
        </div>
      </div>
    </section>
    <!-- AI 形象: Live2D 开关 + 模型自定义 -->
    <section v-if="live2dOpen" class="sheet-mask" @click.self="live2dOpen = false">
      <div class="sheet">
        <div class="sheet-bar">
          <b>AI 形象</b>
          <button class="x" @click="live2dOpen = false">完成</button>
        </div>
        <div class="sheet-scroll">
          <div class="set-row">
            <span class="set-label">显示 Live2D 形象</span>
            <button class="sw" :class="{ on: live2d.enabled }" @click="onLive2dToggle"><span></span></button>
          </div>
          <div class="hint">开启后左侧展示半身形象，右侧继续对话；关闭即恢复全屏对话。</div>

          <div class="mem-head">
            <span>我的模型</span>
          </div>

          <div v-if="!live2d.models.length" class="empty small">
            <b>还没有模型</b>
            <span>上传 zip/文件夹，或添加一个模型地址即可使用</span>
          </div>
          <div v-for="item in live2d.models" :key="item.key" class="lv-model"
               :class="{ on: item.key === live2d.current }" @click="selectLive2dModel(item)">
            <span class="lv-dot"></span>
            <span class="lv-name">{{ item.name }}</span>
            <span class="lv-tag">{{ item.type === 'local' ? '本地' : 'URL' }}</span>
            <button class="lv-del" title="删除" @click.stop="removeLive2dModel(item)">×</button>
          </div>

          <div class="form-field">
            <label>上传本地模型</label>
            <button class="mini-btn lv-upload" :disabled="uploadingModel" @click="modelFileRef && modelFileRef.click()">
              {{ uploadingModel ? '正在解析模型…' : '上传 zip / 多选文件' }}
            </button>
            <input ref="modelFileRef" class="lv-file" type="file" multiple
                   accept=".zip,.json,.moc,.moc3,.png,.jpg,.jpeg,.webp,.mtn,.wav,.mp3"
                   @change="onModelFilesChange" />
          </div>
          <div class="hint">支持 Cubism 2.1（model.json）与 Cubism 3/4（model3.json），单个模型最大 400MB；手机端建议把模型文件夹打成 zip 再上传，上传后离线也能用。</div>

          <div class="form-field">
            <label>模型名称</label>
            <input v-model="newModelName" maxlength="40" placeholder="如：爱蜜莉雅" />
          </div>
          <div class="form-field">
            <label>模型地址（.model3.json / .model.json）</label>
            <input v-model="newModelUrl" placeholder="https://…/xxx.model3.json" />
          </div>
          <button class="mini-btn primary lv-add" @click="addLive2dModel">添加模型</button>
          <div class="hint">填模型设置文件的直链，例如 https://cdn.jsdelivr.net/gh/用户/仓库@main/模型/xxx.model3.json；不要填文件夹或网页地址。远程地址需允许跨域（CORS），贴图和动作也要能一并加载。</div>
        </div>
      </div>
    </section>
  </div>
</template>
