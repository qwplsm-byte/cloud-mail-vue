<template>
  <div class="ai-page">
    <div class="ai-head">
      <div class="head-badge">
        <img class="badge-img" :src="whaleAvatar" alt=""/>
      </div>
      <div class="head-text">
        <div class="head-title">{{ $t('aiAssistant') }}</div>
        <div class="head-sub">{{ $t('aiAssistantDesc') }}</div>
      </div>
      <el-button v-if="messages.length" text class="head-clear" @click="clearConversation">
        <Icon icon="mdi:broom" :width="16" :height="16" />
        <span>{{ $t('aiClear') }}</span>
      </el-button>
    </div>

    <el-scrollbar ref="scrollRef" class="ai-body">
      <div class="ai-inner">
        <!-- 空状态：介绍 + 预设指令 -->
        <div v-if="!messages.length" class="ai-empty">
          <div class="empty-badge">
            <img class="badge-img" :src="whaleAvatar" alt=""/>
          </div>
          <div class="empty-title">{{ $t('aiIntro') }}</div>
          <div class="empty-desc">{{ $t('aiIntroDesc') }}</div>

          <div class="preset-label">{{ $t('aiPresetTitle') }}</div>
          <div class="preset-grid">
            <button v-for="preset in presetList" :key="preset.key" class="preset-card" :class="{ 'is-danger': preset.danger }" @click="usePreset(preset)">
              <Icon :icon="preset.icon" :width="18" :height="18" />
              <span class="preset-name">{{ $t(preset.label) }}</span>
              <Icon class="preset-arrow" icon="mdi:arrow-top-right" :width="15" :height="15" />
            </button>
          </div>
        </div>

        <!-- 对话消息 -->
        <div v-for="msg in messages" :key="msg.id" class="msg-row" :class="msg.role">
          <template v-if="msg.role === 'user'">
            <div class="user-bubble">
              <!-- 本轮上传的附件: 图片给缩略图, 文本文件只显示文件名 -->
              <div v-if="msg.attachments && msg.attachments.length" class="bubble-attach">
                <template v-for="file in msg.attachments" :key="file.key">
                  <img v-if="file.type === 'image' && file.dataUrl" class="bubble-thumb" :src="file.dataUrl" alt=""/>
                  <span class="bubble-file">
                    <Icon icon="mdi:file-document-outline" :width="13" :height="13" />
                    <span class="bubble-file-name">{{ file.name }}</span>
                  </span>
                </template>
              </div>
              <span v-if="msg.content" class="bubble-text">{{ msg.content }}</span>
            </div>
          </template>

          <template v-else>
            <div class="bot-avatar">
              <img class="badge-img" :src="whaleAvatar" alt=""/>
            </div>
            <div class="bot-content">
              <template v-if="msg.loading">
                <div class="bot-typing">
                  <span class="dot"></span><span class="dot"></span><span class="dot"></span>
                  <span class="typing-text">{{ $t('aiThinking') }}<template v-if="elapsed >= 3"> · {{ elapsed }}s</template></span>
                </div>
                <div v-if="elapsed >= 10" class="typing-hint">{{ $t('aiThinkingHint') }}</div>
              </template>

              <template v-else>
                <div v-if="msg.content" class="bot-reply" :class="msg.error ? 'is-error' : ''">{{ msg.content }}</div>

                <!-- 联网搜索失败时的降级提示 -->
                <div v-if="msg.searchFailed" class="search-fail">
                  <Icon icon="mdi:alert-outline" :width="15" :height="15" />
                  <span>{{ $t('aiSearchEmpty') }}</span>
                </div>

                <!-- 联网搜索的参考来源 -->
                <div v-if="msg.sources && msg.sources.length" class="source-card">
                  <div class="source-head">
                    <Icon icon="mdi:web" :width="15" :height="15" />
                    <span>{{ $t('aiSearchSources') }}</span>
                  </div>
                  <a v-for="(source, index) in msg.sources" :key="source.url" class="source-item"
                     :href="source.url" target="_blank" rel="noopener noreferrer">
                    <span class="source-index">{{ index + 1 }}</span>
                    <span class="source-title">{{ source.title }}</span>
                    <Icon class="source-link" icon="mdi:open-in-new" :width="13" :height="13" />
                  </a>
                </div>

                <!-- 操作计划 -->
                <div v-if="msg.plan && msg.plan.length" class="plan-card">
                  <div class="plan-head">
                    <Icon icon="mdi:clipboard-list-outline" :width="16" :height="16" />
                    <span>{{ $t('aiPlanTitle') }}</span>
                  </div>

                  <div class="plan-actions">
                    <div v-for="(action, index) in msg.plan" :key="index" class="plan-action">
                      <div class="action-top">
                        <span class="action-icon" :class="action.type">
                          <Icon :icon="actionIcon(action.type)" :width="16" :height="16" />
                        </span>
                        <span class="action-name">{{ $t(actionLabel(action.type)) }}</span>
                        <span v-if="action.category" class="action-tag">{{ categoryName(action.category) }}</span>
                        <span class="action-count" :class="action.count ? '' : 'is-empty'">
                          {{ countText(action) }}
                        </span>
                      </div>
                      <div v-if="action.description" class="action-desc">{{ action.description }}</div>
                      <div v-if="action.limited" class="action-hint">{{ limitedText(action) }}</div>

                      <!--发信: 列出实际发件账号、收件人、主题与正文, 主人确认后才真正发出-->
                      <div v-if="action.type === 'sendMail'" class="action-mail">
                        <div class="mail-line">
                          <span class="mail-label">{{ $t('aiSendFrom') }}</span>
                          <span class="mail-value">{{ action.fromEmail }}</span>
                        </div>
                        <div class="mail-line">
                          <span class="mail-label">{{ $t('aiSendTo') }}</span>
                          <span class="mail-value">{{ (action.to || []).join('、') }}</span>
                        </div>
                        <div class="mail-line">
                          <span class="mail-label">{{ $t('aiSendSubject') }}</span>
                          <span class="mail-value">{{ action.subject || $t('noSubject') }}</span>
                        </div>
                        <div class="mail-preview">{{ action.content }}</div>
                        <div class="action-hint">{{ recipientText(action) }}</div>
                      </div>

                      <div v-if="action.samples && action.samples.length" class="action-samples">
                        <span class="samples-label">{{ $t('aiSamples') }}</span>
                        <div v-for="sample in action.samples" :key="sample.emailId || sample.email" class="sample-item">
                          <!--删除类操作列出的是具体账号地址, 邮件类列出主题与发件人-->
                          <template v-if="sample.emailId">
                            <span class="sample-subject">{{ sample.subject || $t('noSubject') }}</span>
                            <span class="sample-from">{{ sample.sendEmail }}</span>
                          </template>
                          <template v-else>
                            <span class="sample-subject">{{ sample.email }}</span>
                          </template>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div v-if="hasDelete(msg.plan)" class="plan-warn">
                    <Icon icon="mdi:alert-outline" :width="15" :height="15" />
                    <span>{{ $t('aiDeleteWarn') }}</span>
                  </div>

                  <div v-if="msg.status === 'pending'" class="plan-footer">
                    <el-button class="btn-ghost" @click="cancelPlan(msg)">{{ $t('aiCancel') }}</el-button>
                    <el-button type="primary" class="btn-run" @click="runPlan(msg)">
                      {{ $t('aiExecute') }}
                    </el-button>
                  </div>

                  <div v-else-if="msg.status === 'executing'" class="plan-footer">
                    <span class="running-text">{{ $t('aiExecuting') }}</span>
                  </div>
                </div>

                <!-- 执行结果 -->
                <div v-if="msg.results && msg.results.length" class="result-card">
                  <div class="result-head">
                    <Icon icon="mdi:check-decagram-outline" :width="16" :height="16" />
                    <span>{{ $t('aiResultTitle') }}</span>
                  </div>
                  <div v-for="(item, index) in msg.results" :key="index" class="result-item">
                    <div class="result-row">
                      <Icon :icon="item.success ? 'mdi:check-circle-outline' : 'mdi:alert-circle-outline'"
                            :width="15" :height="15" :class="item.success ? 'ok' : 'fail'" />
                      <span class="result-text">{{ resultText(item) }}</span>
                    </div>
                    <!--新增/删除的账号都以 items 返回, 新注册用户还会带上随机初始密码, 直接列出来方便保存-->
                    <div v-if="item.items && item.items.length" class="created-list">
                      <div v-for="row in item.items" :key="row.email" class="created-item">
                        <span class="created-email">{{ row.email }}</span>
                        <span v-if="row.password" class="created-pwd">{{ row.password }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </template>
        </div>
      </div>
    </el-scrollbar>

    <!-- 已选附件预览: 图片显示缩略图, 文本文件显示文件名, 可逐个移除 -->
    <div v-if="attachments.length" class="attach-list">
      <div v-for="(file, index) in attachments" :key="file.key" class="attach-item">
        <img v-if="file.type === 'image'" class="attach-thumb" :src="file.dataUrl" alt=""/>
        <Icon v-else icon="mdi:file-document-outline" :width="15" :height="15" />
        <span class="attach-name">{{ file.name }}</span>
        <button class="attach-del" :title="$t('aiAttachRemove')" @click="removeAttachment(index)">
          <Icon icon="mdi:close" :width="13" :height="13" />
        </button>
      </div>
    </div>

    <div class="ai-input">
      <div class="search-tools" :class="{ 'is-on': webSearch }">
        <button class="search-toggle" :title="$t(webSearch ? 'aiWebSearchOn' : 'aiWebSearchOff')"
                @click="webSearch = !webSearch">
          <Icon icon="mdi:web" :width="15" :height="15" />
          <span>{{ $t('aiWebSearch') }}</span>
        </button>
        <!-- 搜索来源设置: 多引擎可选, 选 searxng 时可填自定义实例地址 -->
        <el-popover placement="top-start" :width="272" trigger="click" popper-class="search-set-popover">
          <template #reference>
            <button class="search-caret" :title="$t('aiSearchSettings')">
              <Icon icon="mdi:cog-outline" :width="15" :height="15" />
            </button>
          </template>

          <div class="search-set">
            <div class="set-row">
              <span class="set-title">{{ $t('aiWebSearch') }}</span>
              <el-switch v-model="webSearch" size="small" />
            </div>

            <div class="set-label">{{ $t('aiSearchEngine') }}</div>
            <el-select v-model="searchEngine" size="small" class="set-select" @change="saveSearchPref">
              <el-option v-for="item in ENGINE_LIST" :key="item.value" :label="$t(item.label)" :value="item.value"/>
            </el-select>

            <template v-if="searchEngine === 'searxng'">
              <div class="set-label">{{ $t('aiSearchEndpoint') }}</div>
              <el-input v-model="searchEndpoint" size="small" placeholder="https://searx.example.com"
                        @change="saveSearchPref"/>
              <div class="set-tip">{{ $t('aiSearchEndpointTip') }}</div>
            </template>
            <div v-else class="set-tip">{{ $t('aiSearchEngineTip') }}</div>
          </div>
        </el-popover>
      </div>
      <!-- 附件入口: 支持图片与常见纯文本文件 -->
      <button class="attach-btn" :title="$t('aiAttach')" :disabled="loading" @click="pickFile">
        <Icon icon="mdi:paperclip" :width="17" :height="17" />
      </button>
      <input ref="fileRef" class="file-input" type="file" multiple
             accept="image/*,.txt,.md,.markdown,.json,.csv,.log,.yml,.yaml,.ini,.conf,.xml,.html,.css,.js,.ts,.py,.java,.go,.sql,.sh"
             @change="onFileChange"/>
      <el-input v-model="input" type="textarea" :rows="1" resize="none" :autosize="{minRows: 1, maxRows: 4}"
                :placeholder="$t('aiPlaceholder')" @keydown.enter.exact.prevent="onSend" />
      <el-button type="primary" class="send-btn" :disabled="loading || (!input.trim() && !attachments.length)" @click="onSend">
        <Icon icon="mdi:send" :width="18" :height="18" />
      </el-button>
    </div>
  </div>
</template>

<script setup>
import {computed, defineOptions, nextTick, onBeforeUnmount, reactive, ref, watch} from "vue";
import {Icon} from "@iconify/vue";
import {ElMessage, ElMessageBox} from "element-plus";
import {aiAssistantExecute, aiAssistantPlan} from "@/request/ai.js";
import {useUserStore} from "@/store/user.js";
import i18n from "@/i18n/index.js";
//AI 助手形象: 侧边栏与对话页共用同一张鲸娘头像
import whaleAvatar from "@/assets/whale-girl.png";

defineOptions({
  name: 'ai'
})

const {t} = i18n.global

const userStore = useUserStore()

//对话记录按用户存到 localStorage, 刷新页面后仍能恢复
const STORAGE_PREFIX = 'ai_assistant_chat_'
const MAX_STORED = 40

const scrollRef = ref(null)
const input = ref('')
const loading = ref(false)
const fileRef = ref(null)

//本轮待发送的附件: 图片压缩后转 base64 交给模型看图, 文本文件直接读文本并进提示词
const attachments = ref([])
const MAX_ATTACH = 3
const MAX_ATTACH_BYTES = 8 * 1024 * 1024
const MAX_IMAGE_EDGE = 1280
const MAX_TEXT_CHARS = 12000
//可以当纯文本读的扩展名, 避免把二进制文件读成乱码
const TEXT_EXT = ['txt', 'md', 'markdown', 'json', 'csv', 'log', 'yml', 'yaml', 'ini', 'conf', 'xml', 'html', 'css', 'js', 'ts', 'py', 'java', 'go', 'sql', 'sh']
const messages = ref(loadMessages())
const elapsed = ref(0)
//联网搜索开关, 开启后本次提问会先联网检索再作答
const webSearch = ref(false)

//联网搜索引擎选项: auto 走后端默认链, searxng 需要用户填自定义实例地址
const ENGINE_LIST = [
  {value: 'auto', label: 'aiSearchEngineAuto'},
  {value: 'duckduckgo', label: 'aiSearchEngineDdg'},
  {value: 'bing', label: 'aiSearchEngineBing'},
  {value: 'baidu', label: 'aiSearchEngineBaidu'},
  {value: 'mojeek', label: 'aiSearchEngineMojeek'},
  {value: 'searxng', label: 'aiSearchEngineCustom'},
]

//搜索来源是设备级偏好, 与用户无关, 单独存一个 key
const SEARCH_PREF_KEY = 'ai_search_pref'
const searchPref = loadSearchPref()
const searchEngine = ref(searchPref.engine)
const searchEndpoint = ref(searchPref.endpoint)

function loadSearchPref() {
  try {
    const raw = localStorage.getItem(SEARCH_PREF_KEY)
    const data = raw ? JSON.parse(raw) : {}
    return {
      engine: ENGINE_LIST.some(item => item.value === data.engine) ? data.engine : 'auto',
      endpoint: typeof data.endpoint === 'string' ? data.endpoint : ''
    }
  } catch (e) {
    return {engine: 'auto', endpoint: ''}
  }
}

function saveSearchPref() {
  try {
    localStorage.setItem(SEARCH_PREF_KEY, JSON.stringify({
      engine: searchEngine.value,
      endpoint: searchEndpoint.value.trim()
    }))
  } catch (e) {
    //忽略隐私模式/超出配额导致的写入失败
  }
}

let seed = messages.value.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0)
let timerId = null

function storageKey() {
  return STORAGE_PREFIX + (userStore.user?.email || 'anonymous')
}

function loadMessages() {
  try {
    const raw = localStorage.getItem(storageKey())
    const list = raw ? JSON.parse(raw) : []

    if (!Array.isArray(list)) {
      return []
    }

    //刷新后不能停留在"进行中"状态
    return list.map(item => ({
      ...item,
      loading: false,
      status: item.status === 'executing' ? 'pending' : item.status
    }))
  } catch (e) {
    return []
  }
}

function saveMessages() {
  try {
    const list = messages.value.slice(-MAX_STORED).map(({id, role, content, plan, status, results, error, sources, searchFailed, attachments: files}) => ({
      id, role, content, plan, status, results, error, sources, searchFailed,
      //附件只留文件名: 图片 base64 落盘会撑爆 localStorage
      attachments: files ? files.map(({key, type, name}) => ({key, type, name})) : undefined
    }))
    localStorage.setItem(storageKey(), JSON.stringify(list))
  } catch (e) {
    //忽略写入失败(隐私模式/超出配额)
  }
}

watch(messages, saveMessages, {deep: true})

function startTimer() {
  stopTimer()
  elapsed.value = 0
  timerId = setInterval(() => {
    elapsed.value++
  }, 1000)
}

function stopTimer() {
  if (timerId) {
    clearInterval(timerId)
    timerId = null
  }
}

onBeforeUnmount(stopTimer)

function errorText(e) {
  //ECONNABORTED 是前端主动超时, 换成更好理解的中文提示
  if (e?.code === 'ECONNABORTED' || /timeout|超时/i.test(e?.message || '')) {
    return t('aiTimeout')
  }
  return e?.response?.data?.message || e?.message || t('reqFailErrorMsg')
}

const presets = [
  {key: 'uncategorized', icon: 'mdi:folder-move-outline', label: 'aiPresetUncategorized', prompt: 'aiPresetUncategorizedPrompt'},
  {key: 'promo', icon: 'mdi:tag-remove-outline', label: 'aiPresetDeletePromo', prompt: 'aiPresetDeletePromoPrompt'},
  {key: 'notice', icon: 'mdi:email-open-outline', label: 'aiPresetReadNotice', prompt: 'aiPresetReadNoticePrompt'},
  {key: 'summary', icon: 'mdi:text-box-search-outline', label: 'aiPresetSummary', prompt: 'aiPresetSummaryPrompt'},
  //这几个要自己填数量或关键词, 所以只把模板填进输入框, 不直接提交
  {key: 'addEmails', icon: 'mdi:email-plus-outline', label: 'aiPresetAddEmails', prompt: 'aiPresetAddEmailsPrompt', fill: true},
  {key: 'registerUsers', icon: 'mdi:account-multiple-plus-outline', label: 'aiPresetRegisterUsers', prompt: 'aiPresetRegisterUsersPrompt', fill: true, perm: 'user:add'},
  {key: 'deleteEmails', icon: 'mdi:email-minus-outline', label: 'aiPresetDeleteEmails', prompt: 'aiPresetDeleteEmailsPrompt', fill: true, danger: true, perm: 'account:delete'},
  {key: 'deleteUsers', icon: 'mdi:account-multiple-minus-outline', label: 'aiPresetDeleteUsers', prompt: 'aiPresetDeleteUsersPrompt', fill: true, danger: true, perm: 'user:delete'},
  //发信必须自己填收件人, 所以只把模板填进输入框
  {key: 'sendMail', icon: 'mdi:send-outline', label: 'aiPresetSendMail', prompt: 'aiPresetSendMailPrompt', fill: true},
]

//注册/删除用户、删除邮箱都有对应权限要求, 与后端判定一致, 没权限就不显示对应预设
function hasPerm(key) {
  const keys = userStore.user?.permKeys || []
  return keys.includes('*') || keys.includes(key)
}

const presetList = computed(() => presets.filter(item => !item.perm || hasPerm(item.perm)))

const CATEGORY_LABEL = {
  1: 'categoryAccount',
  2: 'categoryNotice',
  3: 'categoryBill',
  4: 'categoryPromotion',
  5: 'categoryOther',
}

const ACTION_LABEL = {
  delete: 'aiTypeDelete',
  categorize: 'aiTypeCategorize',
  markRead: 'aiTypeMarkRead',
  star: 'aiTypeStar',
  autoCategorize: 'aiTypeAutoCategorize',
  addEmails: 'aiTypeAddEmails',
  registerUsers: 'aiTypeRegisterUsers',
  deleteEmails: 'aiTypeDeleteEmails',
  deleteUsers: 'aiTypeDeleteUsers',
  sendMail: 'aiTypeSendMail',
}

const ACTION_ICON = {
  delete: 'mdi:trash-can-outline',
  categorize: 'mdi:folder-move-outline',
  markRead: 'mdi:email-open-outline',
  star: 'mdi:star-outline',
  autoCategorize: 'mdi:auto-fix',
  addEmails: 'mdi:email-plus-outline',
  registerUsers: 'mdi:account-multiple-plus-outline',
  deleteEmails: 'mdi:email-minus-outline',
  deleteUsers: 'mdi:account-multiple-minus-outline',
  sendMail: 'mdi:send-outline',
}

//这两个是按数量创建账号, 与按邮件封数统计的操作文案不同
const BULK_TYPES = ['addEmails', 'registerUsers']
//这两个是按账号个数删除, 文案用"删除"而不是"影响"
const DELETE_TARGET_TYPES = ['deleteEmails', 'deleteUsers']

function isBulk(type) {
  return BULK_TYPES.includes(type)
}

function isDeleteTarget(type) {
  return DELETE_TARGET_TYPES.includes(type)
}

function actionLabel(type) {
  return ACTION_LABEL[type] || 'aiPlanTitle'
}

function actionIcon(type) {
  return ACTION_ICON[type] || 'mdi:cog-outline'
}

function categoryName(category) {
  return t(CATEGORY_LABEL[category] || 'categoryOther')
}

function hasDelete(plan) {
  return plan.some(action => action.type === 'delete' || isDeleteTarget(action.type))
}

//发信发出去就收不回来, 执行前也要再确认一次
function hasSendMail(plan) {
  return plan.some(action => action.type === 'sendMail')
}

//发信审查给出的收件人身份, 让主人在确认前就看清楚这封信是发给谁的
function recipientText(action) {
  return action.recipientType === 'personal' ? t('aiSendRecipientPersonal') : t('aiSendRecipientOrg')
}

function resultText(item) {
  const name = t(actionLabel(item.type))
  if (!item.success) {
    return `${name} · ${item.message || t('aiSkipped')}`
  }
  if (item.type === 'sendMail') {
    return `${name} · ${t('aiSent')}`
  }
  if (isBulk(item.type)) {
    return `${name} · ${t('aiCreated', {count: item.count})}`
  }
  if (isDeleteTarget(item.type)) {
    return `${name} · ${t('aiDeleted', {count: item.count})}`
  }
  return `${name} · ${t('aiAffected', {count: item.count})}`
}

function countText(action) {
  if (action.type === 'sendMail') {
    return t('aiSendRecipientCount', {count: (action.to || []).length})
  }
  if (isBulk(action.type)) {
    //批量创建没有"匹配"的概念, 直接显示将要创建的数量
    return t('aiCreateCount', {count: action.count || 0})
  }
  if (isDeleteTarget(action.type)) {
    return action.count ? t('aiDeleteCount', {count: action.count}) : t('aiNoMatch')
  }
  return action.count ? t('aiMatchCount', {count: action.count}) : t('aiNoMatch')
}

function limitedText(action) {
  if (isBulk(action.type)) {
    return t('aiCreateLimited')
  }
  if (isDeleteTarget(action.type)) {
    return t('aiDeleteLimited')
  }
  return t('aiLimited')
}

function scrollToBottom() {
  nextTick(() => {
    const wrap = scrollRef.value?.wrapRef
    if (wrap) {
      wrap.scrollTop = wrap.scrollHeight
    }
  })
}

function usePreset(preset) {
  //需要自己填数量的预设只把模板填进输入框, 用户改完数量再发送
  if (preset.fill) {
    input.value = t(preset.prompt)
    return
  }
  submit(t(preset.prompt))
}

function pickFile() {
  fileRef.value?.click()
}

function removeAttachment(index) {
  attachments.value.splice(index, 1)
}

//图片压到最长边 1280 再转 jpeg base64, 控制请求体积
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
        //透明图铺白底, 否则转 jpeg 后透明区域会变黑
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

function isTextFile(file) {
  if (file.type.startsWith('text/')) {
    return true
  }
  if (/^application\/(json|xml|x-yaml|javascript)/.test(file.type)) {
    return true
  }
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  return TEXT_EXT.includes(ext)
}

async function readAttachment(file) {
  if (file.size > MAX_ATTACH_BYTES) {
    ElMessage({message: t('aiAttachTooLarge'), type: 'warning', plain: true, grouping: true})
    return null
  }

  const key = `${Date.now()}_${file.name}`

  if (file.type.startsWith('image/')) {
    return {key, type: 'image', name: file.name, dataUrl: await shrinkImage(file)}
  }

  if (!isTextFile(file)) {
    ElMessage({message: t('aiAttachUnsupported'), type: 'warning', plain: true, grouping: true})
    return null
  }

  return {key, type: 'text', name: file.name, content: (await file.text()).slice(0, MAX_TEXT_CHARS)}
}

async function onFileChange(e) {
  const files = Array.from(e.target.files || [])
  //清空 value, 否则连续选同一个文件不会再触发 change
  e.target.value = ''

  for (const file of files) {
    if (attachments.value.length >= MAX_ATTACH) {
      ElMessage({message: t('aiAttachLimit'), type: 'warning', plain: true, grouping: true})
      break
    }

    try {
      const item = await readAttachment(file)
      if (item) {
        attachments.value.push(item)
      }
    } catch (err) {
      ElMessage({message: t('aiAttachFail'), type: 'error', plain: true, grouping: true})
    }
  }
}

function onSend() {
  if (loading.value) {
    return
  }
  const text = input.value.trim()
  const files = attachments.value.slice()
  //只传附件不写文字也允许发送
  if (!text && !files.length) {
    return
  }
  input.value = ''
  attachments.value = []
  submit(text, files)
}

//取最近几轮纯文本对话作为上下文, 让普通聊天能记住前文
function buildHistory() {
  return messages.value
    .filter(msg => !msg.loading && msg.content)
    .slice(-10)
    .map(msg => ({role: msg.role === 'user' ? 'user' : 'assistant', content: String(msg.content)}))
}

async function submit(text, files = []) {
  if (loading.value) {
    return
  }

  //上下文要在推入本轮消息之前取, 否则会把当前提问重复带进去
  const history = buildHistory()
  const useSearch = webSearch.value

  //顺手落盘一次搜索偏好, 避免用户填了地址没失焦就直接发送
  if (useSearch) {
    saveSearchPref()
  }

  messages.value.push({id: ++seed, role: 'user', content: text, attachments: files.length ? files : undefined})
  //必须是响应式对象, 否则请求回来后直接改 bot.xxx 不会触发视图更新和持久化 watch
  const bot = reactive({id: ++seed, role: 'assistant', content: '', loading: true})
  messages.value.push(bot)
  loading.value = true
  startTimer()
  scrollToBottom()

  try {
    const data = await aiAssistantPlan(text, history, useSearch, searchEngine.value, searchEndpoint.value.trim(), files)
    bot.loading = false
    bot.content = data?.reply || ''
    bot.plan = data?.actions || []
    bot.sources = data?.sources || []
    bot.searchFailed = !!data?.searchFailed
    bot.status = bot.plan.length ? 'pending' : 'done'
  } catch (e) {
    bot.loading = false
    bot.error = true
    bot.content = errorText(e)
  } finally {
    stopTimer()
    loading.value = false
    scrollToBottom()
  }
}

async function runPlan(msg) {
  if (msg.status !== 'pending') {
    return
  }

  //删除与发信都不可撤回, 执行前再确认一次
  if (hasDelete(msg.plan) || hasSendMail(msg.plan)) {
    const sendMail = hasSendMail(msg.plan)

    try {
      await ElMessageBox.confirm(
        sendMail ? t('aiSendConfirm') : t('aiDeleteConfirm'),
        sendMail ? t('aiSendConfirmTitle') : t('aiDeleteConfirmTitle'),
        {
          confirmButtonText: t('aiExecute'),
          cancelButtonText: t('cancel'),
          type: 'warning',
        }
      )
    } catch (e) {
      return
    }
  }

  const actions = msg.plan.map(action => ({
    type: action.type,
    category: action.category,
    count: action.count,
    prefix: action.prefix,
    keyword: action.keyword,
    status: action.status,
    description: action.description,
    filter: action.filter,
    //发信要把收件人、主题、正文和审查凭证原样带回后端, 凭证对不上就不会发出去
    to: action.to,
    subject: action.subject,
    content: action.content,
    ticket: action.ticket,
  }))

  msg.status = 'executing'
  scrollToBottom()

  try {
    const data = await aiAssistantExecute(actions)
    msg.results = data?.results || []
    msg.status = 'done'
  } catch (e) {
    msg.status = 'pending'
    ElMessage({message: e?.message || t('reqFailErrorMsg'), type: 'error', plain: true, grouping: true})
  }
  scrollToBottom()
}

function cancelPlan(msg) {
  msg.status = 'done'
  msg.plan = []
}

function clearConversation() {
  ElMessageBox.confirm(t('aiClearConfirm'), t('aiClear'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning',
  }).then(() => {
    messages.value = []
  }).catch(() => {
  })
}
</script>

<style scoped lang="scss">
.ai-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  width: 100%;
  max-width: 100%;
  //兜底: 任何子元素都不该把整页撑出横向滚动条(手机端会被裁断)
  overflow-x: hidden;
  background: var(--extra-light-fill, transparent);
}

.ai-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--el-border-color-lighter);

  .head-badge {
    flex-shrink: 0;
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 12px;
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }

  .head-text {
    flex: 1;
    min-width: 0;
  }

  .head-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  .head-sub {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    margin-top: 2px;
  }

  .head-clear {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--el-text-color-secondary);
    font-size: 13px;
  }
}

.ai-body {
  flex: 1;
  min-height: 0;
  width: 100%;

  //消息区只允许纵向滚动, 横向一律由内容换行解决
  :deep(.el-scrollbar__wrap) {
    overflow-x: hidden;
  }
}

.ai-inner {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 22px 20px 26px;
  box-sizing: border-box;
  //overflow-wrap 会继承: 长串(URL/邮箱/密码/连续英文)强制断行, 修复手机端被撑破后裁断
  overflow-wrap: anywhere;
  word-break: break-word;
}

.ai-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 26px 0 10px;
  text-align: center;

  .empty-badge {
    width: 66px;
    height: 66px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 20px;
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }

  .empty-title {
    margin-top: 16px;
    font-size: 18px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  .empty-desc {
    margin-top: 8px;
    max-width: 460px;
    font-size: 13px;
    line-height: 1.7;
    color: var(--el-text-color-secondary);
  }

  .preset-label {
    margin: 30px 0 12px;
    font-size: 12px;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--el-text-color-placeholder);
  }

  .preset-grid {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    @media (max-width: 600px) {
      grid-template-columns: 1fr;
    }
  }

  .preset-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-radius: 12px;
    border: 1px solid var(--el-border-color);
    background: var(--el-bg-color);
    color: var(--el-text-color-regular);
    cursor: pointer;
    text-align: left;
    font-size: 13px;
    transition: border-color .18s ease, transform .18s ease, box-shadow .18s ease;

    &:hover {
      border-color: var(--el-color-primary);
      transform: translateY(-1px);
      box-shadow: 0 8px 20px -14px rgba(0, 0, 0, .5);
    }

    .preset-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .preset-arrow {
      color: var(--el-text-color-placeholder);
    }

    //删除类预设用危险色区分, 避免和普通整理操作混淆
    &.is-danger {
      color: var(--el-color-danger);

      &:hover {
        border-color: var(--el-color-danger);
      }
    }
  }
}

.msg-row {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  //flex 子项默认 min-width:auto, 会被长内容顶宽, 这里显式压成 0
  min-width: 0;

  &.user {
    justify-content: flex-end;
  }

  &.assistant {
    align-items: flex-start;
  }
}

.user-bubble {
  max-width: 78%;
  padding: 10px 14px;
  border-radius: 14px 14px 4px 14px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

/* AI 形象图: 头像容器保持原尺寸, 图片撑满并沿用容器的圆角 */
.badge-img {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: inherit;
  object-fit: cover;
}

/* 用户气泡里的附件 */
.bubble-attach {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.bubble-thumb {
  display: block;
  max-width: 160px;
  max-height: 160px;
  border-radius: 8px;
}

.bubble-file {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 3px 8px;
  border-radius: 8px;
  font-size: 12px;
  background: rgba(255, 255, 255, .22);
}

.bubble-file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 输入框上方的待发送附件 */
.attach-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 20px 10px;
}

.attach-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 5px 6px 5px 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-light);
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.attach-thumb {
  display: block;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  object-fit: cover;
}

.attach-name {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attach-del {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  color: var(--el-text-color-secondary);
  background: transparent;

  &:hover {
    color: var(--el-color-danger);
    background: var(--el-color-danger-light-9);
  }
}

.bot-avatar {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.bot-content {
  flex: 1;
  min-width: 0;
}

.bot-reply {
  font-size: 14px;
  line-height: 1.75;
  color: var(--el-text-color-primary);
  white-space: pre-wrap;
  word-break: break-word;

  &.is-error {
    color: var(--el-color-danger);
  }
}

.search-fail {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 8px 11px;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}

.source-card {
  margin-top: 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
  background: var(--el-bg-color);
  padding: 10px 14px;

  .source-head {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  .source-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--el-text-color-regular);
    text-decoration: none;

    &:hover .source-title {
      color: var(--el-color-primary);
      text-decoration: underline;
    }
  }

  .source-index {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    font-size: 11px;
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }

  .source-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .source-link {
    flex-shrink: 0;
    color: var(--el-text-color-placeholder);
  }
}

.bot-typing {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 0;

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--el-color-primary);
    animation: ai-blink 1.2s infinite ease-in-out;
  }

  .dot:nth-child(2) {
    animation-delay: .18s;
  }

  .dot:nth-child(3) {
    animation-delay: .36s;
  }

  .typing-text {
    margin-left: 6px;
    font-size: 13px;
    color: var(--el-text-color-secondary);
  }
}

.typing-hint {
  margin-top: 8px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--el-text-color-placeholder);
}

@keyframes ai-blink {
  0%, 80%, 100% {
    opacity: .25;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

.plan-card {
  margin-top: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
  background: var(--el-bg-color);
  overflow: hidden;

  .plan-head {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 11px 14px;
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    background: var(--el-fill-color-light);
    border-bottom: 1px solid var(--el-border-color-lighter);
  }
}

.plan-actions {
  padding: 6px 14px;
}

.plan-action {
  padding: 10px 0;
  border-bottom: 1px dashed var(--el-border-color-lighter);

  &:last-child {
    border-bottom: 0;
  }

  .action-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .action-icon {
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: var(--el-fill-color);
    color: var(--el-text-color-regular);

    &.delete, &.deleteEmails, &.deleteUsers {
      background: var(--el-color-danger-light-9);
      color: var(--el-color-danger);
    }

    &.categorize, &.autoCategorize {
      background: var(--el-color-primary-light-9);
      color: var(--el-color-primary);
    }

    &.star {
      background: var(--el-color-warning-light-9);
      color: var(--el-color-warning);
    }
  }

  .action-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  .action-tag {
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 6px;
    color: var(--el-color-primary);
    background: var(--el-color-primary-light-9);
  }

  .action-count {
    margin-left: auto;
    font-size: 12px;
    color: var(--el-text-color-secondary);

    &.is-empty {
      color: var(--el-text-color-placeholder);
    }
  }

  .action-desc {
    margin-top: 6px;
    padding-left: 34px;
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--el-text-color-secondary);
  }

  .action-hint {
    margin-top: 4px;
    padding-left: 34px;
    font-size: 12px;
    color: var(--el-color-warning);
  }

  .action-samples {
    margin-top: 8px;
    padding-left: 34px;

    .samples-label {
      display: block;
      margin-bottom: 4px;
      font-size: 11px;
      letter-spacing: .04em;
      text-transform: uppercase;
      color: var(--el-text-color-placeholder);
    }

    .sample-item {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 2px 0;
      font-size: 12px;
      line-height: 1.5;
    }

    .sample-subject {
      flex: 1;
      min-width: 0;
      color: var(--el-text-color-regular);
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .sample-from {
      flex-shrink: 0;
      max-width: 45%;
      color: var(--el-text-color-placeholder);
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
  }

  /*发信卡片: 逐行列出收件信息, 正文单独给出预览区*/
  .action-mail {
    margin-top: 8px;
    padding-left: 34px;

    .mail-line {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 1px 0;
      font-size: 12px;
      line-height: 1.5;
    }

    .mail-label {
      flex-shrink: 0;
      width: 44px;
      color: var(--el-text-color-placeholder);
    }

    .mail-value {
      flex: 1;
      min-width: 0;
      color: var(--el-text-color-regular);
      overflow-wrap: anywhere;
    }

    .mail-preview {
      margin-top: 6px;
      padding: 8px 10px;
      max-height: 140px;
      overflow-y: auto;
      border-radius: 8px;
      font-size: 12px;
      line-height: 1.6;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      color: var(--el-text-color-regular);
      background: var(--el-fill-color-light);
    }
  }
}

.plan-warn {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 14px;
  padding: 8px 11px;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}

.plan-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 14px;

  .btn-ghost {
    color: var(--el-text-color-regular);
  }

  .btn-run {
    min-width: 112px;
  }

  .running-text {
    font-size: 13px;
    color: var(--el-text-color-secondary);
  }
}

.result-card {
  margin-top: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
  background: var(--el-bg-color);
  padding: 11px 14px;

  .result-head {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
    margin-bottom: 6px;
  }

  .result-item {
    padding: 3px 0;
    font-size: 12.5px;
    color: var(--el-text-color-regular);

    .result-row {
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .ok {
      color: var(--el-color-success);
    }

    .fail {
      color: var(--el-color-danger);
    }

    .created-list {
      margin: 4px 0 2px 22px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .created-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      color: var(--el-text-color-primary);
      word-break: break-all;
    }

    .created-pwd {
      color: var(--el-color-warning);
    }
  }
}

.ai-input {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 14px 20px 16px;
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);

  //输入框占据剩余宽度, 两侧的开关与发送按钮固定在两端
  :deep(.el-textarea) {
    flex: 1;
    min-width: 0;
  }

  :deep(.el-textarea__inner) {
    border-radius: 10px;
    padding: 9px 12px;
    box-shadow: none;
  }

  //联网搜索: 开关 + 来源设置合成一组, 窄屏也不容易挤爆输入栏
  .search-tools {
    flex-shrink: 0;
    display: inline-flex;
    align-items: stretch;
    height: 38px;
    border: 1px solid var(--el-border-color);
    border-radius: 10px;
    background: var(--el-bg-color);
    overflow: hidden;
    transition: border-color .18s ease, background .18s ease;

    &:hover {
      border-color: var(--el-color-primary);
    }

    //开启联网搜索时整组高亮, 让用户明确知道本次会联网
    &.is-on {
      border-color: var(--el-color-primary);
      background: var(--el-color-primary-light-9);
    }

    .search-toggle,
    .search-caret {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: none;
      background: transparent;
      color: var(--el-text-color-secondary);
      font-size: 13px;
      cursor: pointer;
      white-space: nowrap;
      padding: 0 11px;
      transition: color .18s ease;

      &:hover {
        color: var(--el-color-primary);
      }
    }

    .search-caret {
      border-left: 1px solid var(--el-border-color-lighter);
      padding: 0 8px;
    }

    &.is-on .search-toggle,
    &.is-on .search-caret {
      color: var(--el-color-primary);
    }
  }

  //附件按钮与隐藏的文件选择框
  .attach-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 38px;
    padding: 0;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 10px;
    cursor: pointer;
    color: var(--el-text-color-regular);
    background: var(--el-fill-color-light);

    &:hover:not(:disabled) {
      color: var(--el-color-primary);
      border-color: var(--el-color-primary);
    }

    &:disabled {
      cursor: not-allowed;
      opacity: .55;
    }
  }

  .file-input {
    display: none;
  }

  .send-btn {
    flex-shrink: 0;
    height: 38px;
    width: 46px;
    padding: 0;
  }
}

@media (max-width: 600px) {
  .ai-head {
    padding: 13px 14px;
  }

  .ai-inner {
    padding: 18px 14px 22px;
  }

  //窄屏左右内边距与输入栏对齐
  .attach-list {
    padding: 0 14px 8px;
  }

  .ai-input {
    padding: 12px 14px 14px;
    gap: 8px;

    //窄屏只留图标, 给输入框让出空间
    .search-tools {
      .search-toggle {
        padding: 0 9px;

        span {
          display: none;
        }
      }

      .search-caret {
        padding: 0 7px;
      }
    }
  }
}
</style>

<!-- 弹层会被 teleport 到 body 外, 所以这层样式不能加 scoped -->
<style lang="scss">
.search-set-popover {
  .search-set {
    display: flex;
    flex-direction: column;
    gap: 6px;

    .set-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }

    .set-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--el-text-color-primary);
    }

    .set-label {
      font-size: 12px;
      color: var(--el-text-color-secondary);
    }

    .set-select {
      width: 100%;
    }

    .set-tip {
      font-size: 11.5px;
      line-height: 1.55;
      color: var(--el-text-color-placeholder);
    }
  }
}
</style>