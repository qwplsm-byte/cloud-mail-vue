<template>
  <el-dialog
      v-model="visible"
      class="briefing-dialog"
      :title="t('briefingTitle')"
      width="min(560px, calc(100% - 32px))"
      align-center
      append-to-body
      destroy-on-close
  >
    <div class="briefing" v-if="data">
      <div class="briefing-summary" v-if="data.summary">{{ data.summary }}</div>

      <div class="briefing-section" v-if="data.urgent.length">
        <div class="section-title">
          <Icon icon="solar:bolt-bold" width="16" height="16"/>
          <span>{{ t('briefingUrgent') }}</span>
        </div>
        <div class="item" v-for="item in data.urgent" :key="'u' + item.id" @click="open(item.id)">
          <div class="item-title">{{ item.title || t('noSubject') }}</div>
          <div class="item-meta">
            <span class="ask" v-if="item.ask">{{ item.ask }}</span>
            <span class="deadline" v-if="item.deadline">{{ t('briefingDeadline') }}: {{ item.deadline }}</span>
          </div>
        </div>
      </div>

      <div class="briefing-section" v-if="data.bills.length">
        <div class="section-title">
          <Icon icon="solar:wallet-bold" width="16" height="16"/>
          <span>{{ t('briefingBills') }}</span>
        </div>
        <div class="item" v-for="item in data.bills" :key="'b' + item.id" @click="open(item.id)">
          <div class="item-title">{{ item.title || t('noSubject') }}</div>
          <div class="item-meta">
            <span class="amount" v-if="item.amount">{{ item.amount }}</span>
            <span v-if="item.due">{{ item.due }}</span>
          </div>
        </div>
      </div>

      <div class="briefing-archive" v-if="data.archiveCount > 0">
        {{ t('briefingArchive', {count: data.archiveCount}) }}
      </div>
    </div>
  </el-dialog>
</template>

<script setup>
import {onMounted, ref} from 'vue'
import {useI18n} from 'vue-i18n'
import {useRouter} from 'vue-router'
import {Icon} from '@iconify/vue'
import {aiBriefing} from '@/request/ai.js'
import {useEmailStore} from '@/store/email.js'

defineOptions({
  name: 'dailyBriefing'
})

const {t} = useI18n()
const router = useRouter()
const emailStore = useEmailStore()

const visible = ref(false)
const data = ref(null)

//本地记录"今天已展示过", 保证每天首次打开时只弹一次
const SHOWN_KEY = 'briefing_shown_date'

function today() {
  const d = new Date()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

onMounted(async () => {
  if (localStorage.getItem(SHOWN_KEY) === today()) return
  try {
    const res = await aiBriefing()
    localStorage.setItem(SHOWN_KEY, today())
    if (res && ((res.urgent?.length) || (res.bills?.length) || res.archiveCount > 0)) {
      data.value = res
      visible.value = true
    }
  } catch (e) {
    //接口失败不打扰用户, 下次进入再试
    console.error(e)
  }
})

//点击条目: 关闭卡片, 交给收件箱列表定位到该邮件
function open(id) {
  visible.value = false
  emailStore.pendingOpenEmailId = id
  router.push('/inbox')
}
</script>

<style scoped>
.briefing-summary {
  font-size: 14px;
  line-height: 22px;
  color: var(--el-text-color-regular);
  margin-bottom: 14px;
}

.briefing-section {
  margin-bottom: 14px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 8px;
}

.item {
  padding: 8px 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 200ms;
}

.item:hover {
  background: var(--el-fill-color-light);
}

.item-title {
  font-size: 14px;
  color: var(--el-text-color-primary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.item-meta .ask {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.item-meta .deadline {
  flex: 0 0 auto;
  color: var(--el-color-danger);
}

.item-meta .amount {
  flex: 0 0 auto;
  color: var(--el-color-warning);
  font-weight: 600;
}

.briefing-archive {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  padding-top: 6px;
  border-top: 1px solid var(--el-border-color-lighter);
}
</style>
