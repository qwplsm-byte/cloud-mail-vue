<template>
  <emailScroll ref="scroll"
               :cancel-success="cancelStar"
               :star-success="addStar"
               :getEmailList="getEmailList"
               :emailDelete="emailDelete"
               :star-add="starAdd"
               :star-cancel="starCancel"
               :time-sort="params.timeSort"
               :email-read="emailRead"
               :show-unread="true"
               actionLeft="4px"
               @jump="jumpContent"
  >
    <template #first>
      <Icon class="icon" @click="changeTimeSort" icon="material-symbols-light:timer-arrow-down-outline"
            v-if="params.timeSort === 0" width="28" height="28"/>
      <Icon class="icon" @click="changeTimeSort" icon="material-symbols-light:timer-arrow-up-outline" v-else
            width="28" height="28"/>
    </template>

    <template #filter>
      <div class="category-bar">
        <div class="category-tabs">
          <span v-for="item in categoryList"
                :key="item.value"
                :class="['category-tab', { active: params.category === item.value }]"
                @click="changeCategory(item.value)">
            {{ $t(item.label) }}
          </span>
        </div>

        <el-popover :width="340" trigger="click" placement="bottom-end" v-model:visible="filterVisible">
          <template #reference>
            <div :class="['filter-btn', { active: filterActive }]">
              <Icon icon="mdi:filter-variant" width="18" height="18"/>
            </div>
          </template>
          <div class="filter-form">
            <div class="filter-item">
              <span class="filter-label">{{ $t('categoryFilterSubject') }}</span>
              <el-input v-model="filterForm.subject" size="small" clearable :placeholder="$t('searchByContent')"/>
            </div>
            <div class="filter-item">
              <span class="filter-label">{{ $t('categoryFilterContent') }}</span>
              <el-input v-model="filterForm.content" size="small" clearable :placeholder="$t('searchByContent')"/>
            </div>
            <div class="filter-item">
              <span class="filter-label">{{ $t('categoryFilterTime') }}</span>
              <el-date-picker v-model="filterForm.startDate" type="date" size="small" value-format="YYYY-MM-DD"
                              style="width: 100%" :placeholder="$t('categoryStartDate')"/>
              <el-date-picker v-model="filterForm.endDate" type="date" size="small" value-format="YYYY-MM-DD"
                              style="width: 100%" :placeholder="$t('categoryEndDate')"/>
            </div>
            <div class="filter-item row">
              <el-checkbox v-model="filterForm.hasAtt">{{ $t('categoryFilterHasAtt') }}</el-checkbox>
            </div>
            <div class="filter-actions">
              <el-button size="small" @click="resetFilter">{{ $t('categoryFilterReset') }}</el-button>
              <el-button size="small" type="primary" @click="applyFilter">{{ $t('categoryFilterApply') }}</el-button>
            </div>
          </div>
        </el-popover>
      </div>
    </template>

  </emailScroll>
</template>

<script setup>
import {useAccountStore} from "@/store/account.js";
import {useEmailStore} from "@/store/email.js";
import {useSettingStore} from "@/store/setting.js";
import emailScroll from "@/components/email-scroll/index.vue"
import {emailList, emailDelete, emailLatest, emailRead} from "@/request/email.js";
import {starAdd, starCancel} from "@/request/star.js";
import {computed, defineOptions, h, onMounted, reactive, ref, watch} from "vue";
import {sleep} from "@/utils/time-utils.js";
import router from "@/router/index.js";
import {Icon} from "@iconify/vue";
import { useRoute } from 'vue-router'

defineOptions({
  name: 'email'
})

const route = useRoute();
const emailStore = useEmailStore();
const accountStore = useAccountStore();
const settingStore = useSettingStore();
const scroll = ref({})

// category: -1 表示全部，0 为未分类（由 AI 分类失败时产生），1-5 对应 账号/通知/账单/推广/其他
const categoryList = [
  { value: -1, label: 'categoryAll' },
  { value: 1, label: 'categoryAccount' },
  { value: 2, label: 'categoryNotice' },
  { value: 3, label: 'categoryBill' },
  { value: 4, label: 'categoryPromotion' },
  { value: 5, label: 'categoryOther' },
]

const params = reactive({
  timeSort: 0,
  category: -1,
  hasAtt: 0,
  subject: '',
  content: '',
  startTime: '',
  endTime: '',
})

const filterVisible = ref(false)
const filterForm = reactive({
  subject: '',
  content: '',
  hasAtt: false,
  startDate: '',
  endDate: '',
})

const filterActive = computed(() => !!(params.subject || params.content || params.hasAtt || params.startTime))

onMounted(() => {
  emailStore.emailScroll = scroll;
  latest()
})


watch(() => accountStore.currentAccountId, () => {
  scroll.value.refreshList();
})

function changeTimeSort() {
  params.timeSort = params.timeSort ? 0 : 1
  scroll.value.refreshList();
}

function changeCategory(category) {
  if (params.category === category) return
  params.category = category
  scroll.value.refreshList();
}

function applyFilter() {
  syncFilter()
  filterVisible.value = false
}

function resetFilter() {
  filterForm.subject = ''
  filterForm.content = ''
  filterForm.hasAtt = false
  filterForm.startDate = ''
  filterForm.endDate = ''
  syncFilter()
}

function syncFilter() {
  params.subject = (filterForm.subject || '').trim()
  params.content = (filterForm.content || '').trim()
  params.hasAtt = filterForm.hasAtt ? 1 : 0
  params.startTime = filterForm.startDate ? `${filterForm.startDate} 00:00:00` : ''
  params.endTime = filterForm.endDate ? `${filterForm.endDate} 23:59:59` : ''
  scroll.value.refreshList();
}

function jumpContent(email) {
  emailStore.contentData.email = emailStore.toContentEmail(email)
  emailStore.contentData.delType = 'logic'
  emailStore.contentData.showUnread = true
  emailStore.contentData.showStar = true
  emailStore.contentData.showReply = true
  router.push('/mail')
}

const existIds = new Set();

async function latest() {
  while (true) {

    let autoRefresh = settingStore.settings.autoRefresh;
    await sleep(autoRefresh > 1 ? autoRefresh * 1000 : 3000);

    if (route.name !== 'email') {
      continue;
    }

    //有主题/内容/附件/时间筛选时无法判断新邮件是否符合条件，交给手动刷新
    if (filterActive.value) {
      continue;
    }

    const latestId = scroll.value.latestEmail?.emailId

    if (!scroll.value.firstLoad && autoRefresh > 1) {
      try {
        const accountId = accountStore.currentAccountId
        const allReceive = scroll.value.latestEmail?.allReceive
        const curTimeSort = params.timeSort
        const curCategory = params.category
        let list = []

        //确保发起请求时最后一个邮件是当前账号的,或者
        if (accountId === scroll.value.latestEmail?.reqAccountId) {
          list = await emailLatest(latestId, accountId, allReceive);
        }

        //确保请求回来后，账号没有切换，时间排序没有改变，全部邮件类型没变
        if (accountId === accountStore.currentAccountId && params.timeSort === curTimeSort && allReceive === accountStore.currentAccount.allReceive) {
          if (list.length > 0) {
            emailStore.applyFullList(list)

            for (let email of list) {

              //切换了分类就跳过不属于当前分类的新邮件
              if (curCategory > 0 && email.category !== curCategory) {
                continue
              }

              email.reqAccountId = accountId;
              email.allReceive = allReceive;

              if (!existIds.has(email.emailId)) {

                existIds.add(email.emailId)
                scroll.value.addItem(email)

                await sleep(50)
              }

            }

          }

        }
      } catch (e) {
        if (e.code === 401 || e.code === 403) {
          settingStore.settings.autoRefresh = 0;
        }
        console.error(e)
      }
    }
  }
}

function addStar(email) {
  emailStore.starScroll?.addItem(email)
}

function cancelStar(email) {
  emailStore.starScroll?.deleteEmail([email.emailId])
}

function getEmailList(emailId, size) {
  const accountId =  accountStore.currentAccountId;
  const allReceive = accountStore.currentAccount.allReceive;
  return emailStore.fetchList(full =>
    emailList(accountId, allReceive, emailId, params.timeSort, size, 0, full, {
      category: params.category,
      hasAtt: params.hasAtt,
      subject: params.subject,
      content: params.content,
      startTime: params.startTime,
      endTime: params.endTime,
    })
  ).then(data => {
    data.latestEmail.reqAccountId = accountId;
    data.latestEmail.allReceive = allReceive;
    return data;
  })
}

</script>
<style>
.icon {
  cursor: pointer;
}
</style>

<style scoped>
.category-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 15px;
  box-shadow: var(--header-actions-border);
  color: var(--el-text-color-primary);
}

.category-tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.category-tab {
  padding: 2px 12px;
  font-size: 13px;
  line-height: 20px;
  border-radius: 12px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-light);
  border: 1px solid transparent;
  transition: all .2s;
}

.category-tab:hover {
  color: var(--el-color-primary);
}

.category-tab.active {
  color: #fff;
  background: var(--el-color-primary);
}

.filter-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-light);
}

.filter-btn:hover,
.filter-btn.active {
  color: var(--el-color-primary);
}

.filter-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.filter-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.filter-item.row {
  flex-direction: row;
  align-items: center;
}

.filter-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 2px;
}
</style>