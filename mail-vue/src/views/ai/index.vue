<template>
  <div class="ai-page">
    <div class="ai-head">
      <div class="head-badge">
        <Icon icon="mdi:robot-outline" :width="22" :height="22" />
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
            <Icon icon="mdi:robot-happy-outline" :width="34" :height="34" />
          </div>
          <div class="empty-title">{{ $t('aiIntro') }}</div>
          <div class="empty-desc">{{ $t('aiIntroDesc') }}</div>

          <div class="preset-label">{{ $t('aiPresetTitle') }}</div>
          <div class="preset-grid">
            <button v-for="preset in presets" :key="preset.key" class="preset-card" @click="usePreset(preset)">
              <Icon :icon="preset.icon" :width="18" :height="18" />
              <span class="preset-name">{{ $t(preset.label) }}</span>
              <Icon class="preset-arrow" icon="mdi:arrow-top-right" :width="15" :height="15" />
            </button>
          </div>
        </div>

        <!-- 对话消息 -->
        <div v-for="msg in messages" :key="msg.id" class="msg-row" :class="msg.role">
          <template v-if="msg.role === 'user'">
            <div class="user-bubble">{{ msg.content }}</div>
          </template>

          <template v-else>
            <div class="bot-avatar">
              <Icon icon="mdi:robot-outline" :width="17" :height="17" />
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
                          {{ action.count ? $t('aiMatchCount', {count: action.count}) : $t('aiNoMatch') }}
                        </span>
                      </div>
                      <div v-if="action.description" class="action-desc">{{ action.description }}</div>
                      <div v-if="action.limited" class="action-hint">{{ $t('aiLimited') }}</div>

                      <div v-if="action.samples && action.samples.length" class="action-samples">
                        <span class="samples-label">{{ $t('aiSamples') }}</span>
                        <div v-for="sample in action.samples" :key="sample.emailId" class="sample-item">
                          <span class="sample-subject">{{ sample.subject || $t('noSubject') }}</span>
                          <span class="sample-from">{{ sample.sendEmail }}</span>
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
                    <Icon :icon="item.success ? 'mdi:check-circle-outline' : 'mdi:alert-circle-outline'"
                          :width="15" :height="15" :class="item.success ? 'ok' : 'fail'" />
                    <span class="result-text">{{ resultText(item) }}</span>
                  </div>
                </div>
              </template>
            </div>
          </template>
        </div>
      </div>
    </el-scrollbar>

    <div class="ai-input">
      <el-input v-model="input" type="textarea" :rows="1" resize="none" :autosize="{minRows: 1, maxRows: 4}"
                :placeholder="$t('aiPlaceholder')" @keydown.enter.exact.prevent="onSend" />
      <el-button type="primary" class="send-btn" :disabled="loading || !input.trim()" @click="onSend">
        <Icon icon="mdi:send" :width="18" :height="18" />
      </el-button>
    </div>
  </div>
</template>

<script setup>
import {defineOptions, nextTick, onBeforeUnmount, ref, watch} from "vue";
import {Icon} from "@iconify/vue";
import {ElMessage, ElMessageBox} from "element-plus";
import {aiAssistantExecute, aiAssistantPlan} from "@/request/ai.js";
import {useUserStore} from "@/store/user.js";
import i18n from "@/i18n/index.js";

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
const messages = ref(loadMessages())
const elapsed = ref(0)

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
    const list = messages.value.slice(-MAX_STORED).map(({id, role, content, plan, status, results, error}) => ({
      id, role, content, plan, status, results, error
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
]

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
}

const ACTION_ICON = {
  delete: 'mdi:trash-can-outline',
  categorize: 'mdi:folder-move-outline',
  markRead: 'mdi:email-open-outline',
  star: 'mdi:star-outline',
  autoCategorize: 'mdi:auto-fix',
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
  return plan.some(action => action.type === 'delete')
}

function resultText(item) {
  const name = t(actionLabel(item.type))
  if (!item.success) {
    return `${name} · ${item.message || t('aiSkipped')}`
  }
  return `${name} · ${t('aiAffected', {count: item.count})}`
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
  submit(t(preset.prompt))
}

function onSend() {
  if (loading.value) {
    return
  }
  const text = input.value.trim()
  if (!text) {
    return
  }
  input.value = ''
  submit(text)
}

async function submit(text) {
  if (loading.value) {
    return
  }

  messages.value.push({id: ++seed, role: 'user', content: text})
  const bot = {id: ++seed, role: 'assistant', content: '', loading: true}
  messages.value.push(bot)
  loading.value = true
  startTimer()
  scrollToBottom()

  try {
    const data = await aiAssistantPlan(text)
    bot.loading = false
    bot.content = data?.reply || ''
    bot.plan = data?.actions || []
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

  const actions = msg.plan.map(action => ({
    type: action.type,
    category: action.category,
    description: action.description,
    filter: action.filter,
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
}

.ai-inner {
  max-width: 760px;
  margin: 0 auto;
  padding: 22px 20px 26px;
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
  }
}

.msg-row {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;

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

    &.delete {
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
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 3px 0;
    font-size: 12.5px;
    color: var(--el-text-color-regular);

    .ok {
      color: var(--el-color-success);
    }

    .fail {
      color: var(--el-color-danger);
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

  :deep(.el-textarea__inner) {
    border-radius: 10px;
    padding: 9px 12px;
    box-shadow: none;
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

  .ai-input {
    padding: 12px 14px 14px;
  }
}
</style>