<template>
  <div class="drive-page">
    <!-- 顶部：标题 + 用量统计 -->
    <div class="drive-head">
      <div class="head-badge">
        <Icon icon="mdi:cloud-outline" :width="20" :height="20"/>
      </div>
      <div class="head-text">
        <div class="head-title">{{ $t('driveTitle') }}</div>
        <div class="head-sub">{{ $t('driveDesc') }}</div>
      </div>
      <div class="head-stats">
        <span class="stat-chip">
          <Icon icon="mdi:file-outline" :width="14" :height="14"/>
          <span>{{ $t('driveStatFiles', {count: stats.files}) }}</span>
        </span>
        <span class="stat-chip">
          <Icon icon="mdi:folder-outline" :width="14" :height="14"/>
          <span>{{ $t('driveStatFolders', {count: stats.folders}) }}</span>
        </span>
        <span class="stat-chip">
          <Icon icon="mdi:database-outline" :width="14" :height="14"/>
          <span>{{ $t('driveStatSize', {size: formatSize(stats.size)}) }}</span>
        </span>
      </div>
    </div>

    <!-- 面包屑 + 工具栏 -->
    <div class="drive-toolbar">
      <div class="crumb">
        <template v-if="!searchMode">
          <button class="crumb-btn" @click="goTo(0, '')">{{ $t('driveRoot') }}</button>
          <template v-for="crumb in crumbs" :key="crumb.id">
            <Icon class="crumb-sep" icon="mdi:chevron-right" :width="14" :height="14"/>
            <button class="crumb-btn" @click="goTo(crumb.id, crumb.name)">{{ crumb.name }}</button>
          </template>
          <template v-if="currentId !== 0">
            <Icon class="crumb-sep" icon="mdi:chevron-right" :width="14" :height="14"/>
            <span class="crumb-current">{{ currentName }}</span>
          </template>
        </template>
        <template v-else>
          <Icon class="crumb-sep" icon="mdi:magnify" :width="14" :height="14"/>
          <span class="crumb-current">{{ $t('driveSearchResults') }}</span>
        </template>
      </div>

      <div class="toolbar-actions">
        <el-button class="tool-btn" size="small" :loading="uploading" @click="pickFiles">
          <Icon icon="mdi:upload" :width="15" :height="15"/>
          <span>{{ $t('driveUpload') }}</span>
        </el-button>
        <el-button class="tool-btn" size="small" @click="newFolder">
          <Icon icon="mdi:folder-plus-outline" :width="15" :height="15"/>
          <span>{{ $t('driveNewFolder') }}</span>
        </el-button>
        <el-button class="tool-btn" size="small" :loading="tidyLoading" @click="runTidy">
          <Icon icon="mdi:auto-fix" :width="15" :height="15"/>
          <span>{{ $t('driveTidy') }}</span>
        </el-button>
        <el-button class="tool-btn icon-only" size="small" :title="$t('driveRefresh')" @click="refreshAll">
          <Icon icon="mdi:refresh" :width="16" :height="16"/>
          <span>{{ $t('driveRefresh') }}</span>
        </el-button>
        <input ref="fileInputRef" class="file-input" type="file" multiple @change="onFileChange"/>
      </div>
    </div>

    <!-- 搜索 -->
    <div class="drive-search">
      <el-input v-model="keyword" size="small" clearable class="search-box"
                :placeholder="$t('driveSearchPlaceholder')">
        <template #prefix>
          <Icon icon="mdi:magnify" :width="15" :height="15"/>
        </template>
      </el-input>
    </div>

    <!-- 选中操作条 -->
    <div v-if="selectedRows.length" class="sel-bar">
      <span class="sel-count">{{ $t('driveSelected', {count: selectedRows.length}) }}</span>
      <div class="sel-actions">
        <el-button size="small" text class="sel-btn" :disabled="!selectedAllFiles"
                   :title="selectedAllFiles ? '' : $t('driveDownloadFilesOnly')" @click="downloadSelected">
          <Icon icon="mdi:download" :width="15" :height="15"/>
          <span>{{ $t('driveDownload') }}</span>
        </el-button>
        <el-button size="small" text class="sel-btn" @click="openPicker('move')">
          <Icon icon="mdi:folder-move-outline" :width="15" :height="15"/>
          <span>{{ $t('driveMove') }}</span>
        </el-button>
        <el-button size="small" text class="sel-btn" @click="openPicker('copy')">
          <Icon icon="mdi:content-copy" :width="15" :height="15"/>
          <span>{{ $t('driveCopy') }}</span>
        </el-button>
        <el-button size="small" text class="sel-btn" :loading="tagLoading" @click="runAutotag">
          <Icon icon="mdi:tag-multiple-outline" :width="15" :height="15"/>
          <span>{{ $t('driveAutotag') }}</span>
        </el-button>
        <el-button size="small" text class="sel-btn is-danger" @click="deleteRows(selectedRows)">
          <Icon icon="mdi:trash-can-outline" :width="15" :height="15"/>
          <span>{{ $t('driveDelete') }}</span>
        </el-button>
        <el-button size="small" text class="sel-btn" @click="clearSelection">{{ $t('driveClearSelection') }}</el-button>
      </div>
    </div>

    <!-- 主体：列表 + 拖拽上传 -->
    <div class="drive-body" v-loading="loading || searchLoading"
         @dragenter.prevent="onDragEnter"
         @dragover.prevent="onDragOver"
         @dragleave.prevent="onDragLeave"
         @drop.prevent="onDrop">
      <!-- 拖拽高亮 -->
      <div v-if="dragActive" class="drop-mask">
        <Icon icon="mdi:cloud-upload-outline" :width="36" :height="36"/>
        <div class="drop-text">{{ $t('driveDropHint') }}</div>
      </div>

      <!-- 错误状态 -->
      <div v-if="loadError && !searchMode" class="state-box">
        <Icon icon="mdi:cloud-alert-outline" :width="36" :height="36"/>
        <div class="state-title">{{ $t('driveLoadFail') }}</div>
        <el-button size="small" type="primary" plain @click="refreshAll">{{ $t('driveRetry') }}</el-button>
      </div>

      <!-- 列表 -->
      <el-table v-else ref="tableRef" :data="tableData" row-key="id" class="drive-table"
                @selection-change="onSelectionChange" @row-dblclick="onRowDblclick">
        <el-table-column type="selection" width="44"/>
        <el-table-column :label="$t('driveColName')" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="name-cell">
              <Icon class="name-icon" :class="row.isDir ? 'is-dir' : 'is-file'"
                    :icon="row.isDir ? 'mdi:folder' : fileIcon(row)" :width="18" :height="18"/>
              <button v-if="row.isDir" class="name-btn" @click.stop="openFolder(row)">{{ row.name }}</button>
              <span v-else class="name-text" @click.stop="downloadFile(row)">{{ row.name }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="$t('driveColSize')" width="104">
          <template #default="{ row }">
            <span class="size-cell">{{ row.isDir ? '—' : formatSize(row.size) }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="!isNarrow" :label="$t('driveColModified')" width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="time-cell">{{ formatTime(row.updateTime) }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="!isNarrow" :label="$t('driveColTags')" min-width="140">
          <template #default="{ row }">
            <div v-if="row.tags && row.tags.length" class="tag-cell">
              <span v-for="tag in row.tags.slice(0, 3)" :key="tag" class="tag-chip">{{ tag }}</span>
              <span v-if="row.tags.length > 3" class="tag-more">+{{ row.tags.length - 3 }}</span>
            </div>
            <span v-else class="tag-empty">—</span>
          </template>
        </el-table-column>
        <el-table-column v-if="searchMode" :label="$t('driveColPath')" min-width="170" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="path-cell">{{ row.path }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('driveColActions')" width="70" align="right">
          <template #default="{ row }">
            <el-dropdown trigger="click" @command="cmd => onRowCommand(cmd, row)">
              <button class="row-more" :title="$t('driveMore')">
                <Icon icon="mdi:dots-horizontal" :width="17" :height="17"/>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="row.isDir" command="open">
                    <Icon icon="mdi:folder-open-outline" :width="15" :height="15"/>
                    <span>{{ $t('driveOpen') }}</span>
                  </el-dropdown-item>
                  <el-dropdown-item command="rename">
                    <Icon icon="mdi:rename-outline" :width="15" :height="15"/>
                    <span>{{ $t('driveRename') }}</span>
                  </el-dropdown-item>
                  <el-dropdown-item command="move">
                    <Icon icon="mdi:folder-move-outline" :width="15" :height="15"/>
                    <span>{{ $t('driveMove') }}</span>
                  </el-dropdown-item>
                  <el-dropdown-item command="copy">
                    <Icon icon="mdi:content-copy" :width="15" :height="15"/>
                    <span>{{ $t('driveCopy') }}</span>
                  </el-dropdown-item>
                  <el-dropdown-item v-if="!row.isDir" command="download">
                    <Icon icon="mdi:download-outline" :width="15" :height="15"/>
                    <span>{{ $t('driveDownload') }}</span>
                  </el-dropdown-item>
                  <el-dropdown-item command="delete" divided>
                    <Icon icon="mdi:trash-can-outline" :width="15" :height="15"/>
                    <span>{{ $t('driveDelete') }}</span>
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>

        <template #empty>
          <div class="table-empty">
            <Icon class="empty-icon" :icon="searchMode ? 'mdi:file-search-outline' : 'mdi:cloud-outline'"
                  :width="38" :height="38"/>
            <div class="state-title">{{ searchMode ? $t('driveSearchEmpty') : $t('driveEmpty') }}</div>
            <div class="state-desc">{{ searchMode ? $t('driveSearchEmptyDesc') : $t('driveEmptyDesc') }}</div>
          </div>
        </template>
      </el-table>
    </div>

    <!-- 上传进度 -->
    <div v-if="uploads.length" class="upload-panel">
      <div class="upload-head">
        <span class="upload-title">{{ uploading ? $t('driveUploading') : $t('driveUploadResult') }}</span>
        <button class="upload-close" :disabled="uploading" @click="clearUploads">
          <Icon icon="mdi:close" :width="14" :height="14"/>
        </button>
      </div>
      <div class="upload-list">
        <div v-for="(u, i) in uploads" :key="i" class="upload-item">
          <Icon class="upload-icon" :class="u.status"
                :icon="u.status === 'error' ? 'mdi:alert-circle-outline' : (u.status === 'done' ? 'mdi:check-circle-outline' : 'mdi:file-upload-outline')"
                :width="15" :height="15"/>
          <span class="upload-name">{{ u.name }}</span>
          <el-progress class="upload-bar" :percentage="u.percent" :show-text="false" :stroke-width="4"
                       :status="u.status === 'error' ? 'exception' : (u.status === 'done' ? 'success' : '')"/>
          <span class="upload-percent">{{ u.percent }}%</span>
        </div>
      </div>
    </div>

    <!-- 文件夹选择器：移动/复制时浏览目标文件夹 -->
    <el-dialog v-model="pickerVisible" append-to-body width="440px"
               :title="pickerMode === 'move' ? $t('driveMoveTitle') : $t('driveCopyTitle')">
      <div class="picker">
        <div class="picker-path">
          <button class="crumb-btn" @click="pickerGoTo(0)">{{ $t('driveRoot') }}</button>
          <template v-for="crumb in pickerCrumbs" :key="crumb.id">
            <Icon class="crumb-sep" icon="mdi:chevron-right" :width="13" :height="13"/>
            <button class="crumb-btn" @click="pickerGoTo(crumb.id)">{{ crumb.name }}</button>
          </template>
        </div>
        <div v-loading="pickerLoading" class="picker-list">
          <div v-if="!pickerFolders.length && !pickerLoading" class="picker-empty">{{ $t('drivePickerEmpty') }}</div>
          <div v-for="f in pickerFolders" :key="f.id" class="picker-item" @click="pickerGoTo(f.id)">
            <Icon icon="mdi:folder" :width="17" :height="17"/>
            <span class="picker-name">{{ f.name }}</span>
            <Icon class="picker-enter" icon="mdi:chevron-right" :width="15" :height="15"/>
          </div>
        </div>
        <div class="picker-tip">{{ $t('drivePickerHere') }}：{{ pickerCurrentLabel }}</div>
      </div>
      <template #footer>
        <el-button @click="pickerVisible = false">{{ $t('cancel') }}</el-button>
        <el-button type="primary" :disabled="pickerInvalid" @click="confirmPicker">{{ $t('confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import {computed, defineOptions, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {Icon} from "@iconify/vue";
import {ElMessage, ElMessageBox} from "element-plus";
import i18n from "@/i18n/index.js";
import {
  driveAutotag,
  driveCopy,
  driveDelete,
  driveList,
  driveMkdir,
  driveMove,
  driveRename,
  driveSearch,
  driveStats,
  driveTidy,
  driveUpload
} from "@/request/drive.js";

defineOptions({
  name: 'drive'
})

const {t} = i18n.global

const tableRef = ref(null)
const fileInputRef = ref(null)

//当前浏览的目录: id 为 0 表示根目录, name 为空时面包屑显示根标签
const currentId = ref(0)
const currentName = ref('')
const breadcrumb = ref([])
const items = ref([])
const loading = ref(false)
const loadError = ref(false)

//用量统计
const stats = ref({files: 0, folders: 0, size: 0})

//搜索
const keyword = ref('')
const searchResults = ref([])
const searchLoading = ref(false)
const searchMode = computed(() => keyword.value.trim().length > 0)

//多选
const selectedRows = ref([])
const selectedAllFiles = computed(() => selectedRows.value.length > 0 && selectedRows.value.every(row => !row.isDir))

//上传与 AI 操作
const uploading = ref(false)
const uploads = ref([])
const tidyLoading = ref(false)
const tagLoading = ref(false)

//文件夹选择器
const pickerVisible = ref(false)
const pickerMode = ref('move')
const pickerLoading = ref(false)
const pickerParentId = ref(0)
const pickerParentName = ref('')
const pickerBreadcrumb = ref([])
const pickerItems = ref([])
const pickerSelectedIds = ref([])

//窄屏隐藏次要列, 避免表格被撑爆
const isNarrow = ref(window.innerWidth < 768)
const onResize = () => {
  isNarrow.value = window.innerWidth < 768
}

const crumbs = computed(() => breadcrumb.value.filter(item => item.id !== 0))
const pickerCrumbs = computed(() => pickerBreadcrumb.value.filter(item => item.id !== 0))
const pickerFolders = computed(() => pickerItems.value.filter(item => item.isDir))
const pickerCurrentLabel = computed(() => pickerParentId.value === 0 ? t('driveRoot') : pickerParentName.value)
const tableData = computed(() => searchMode.value ? searchResults.value : items.value)

//移动时不能选当前文件夹本身, 也不能选中的文件夹自身
const pickerInvalid = computed(() => {
  if (pickerMode.value !== 'move') {
    return false
  }
  if (pickerParentId.value === currentId.value) {
    return true
  }
  return pickerSelectedIds.value.includes(pickerParentId.value)
})

onMounted(() => {
  window.addEventListener('resize', onResize)
  refreshAll()
})

//离开页面时移除监听
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
})

//关键词变化时防抖搜索, 清空则回到正常浏览
let searchTimer = null
watch(keyword, (value) => {
  if (searchTimer) {
    clearTimeout(searchTimer)
  }
  const kw = value.trim()
  if (!kw) {
    searchResults.value = []
    return
  }
  searchTimer = setTimeout(() => runSearch(kw), 300)
})

function formatSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) {
    return `${n} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`
}

//后端时间可能是 ISO 或 "YYYY-MM-DD HH:mm:ss", 统一裁到分钟
function formatTime(value) {
  if (!value) {
    return '—'
  }
  return String(value).replace('T', ' ').slice(0, 16)
}

//按 mime 给个贴切的文件图标
function fileIcon(row) {
  const mime = row.mimeType || ''
  if (mime.startsWith('image/')) {
    return 'mdi:file-image-outline'
  }
  if (mime.startsWith('video/')) {
    return 'mdi:file-video-outline'
  }
  if (mime.startsWith('audio/')) {
    return 'mdi:file-music-outline'
  }
  if (mime.includes('pdf')) {
    return 'mdi:file-pdf-box'
  }
  if (mime.includes('zip') || mime.includes('compressed')) {
    return 'mdi:folder-zip-outline'
  }
  return 'mdi:file-outline'
}

async function load() {
  loading.value = true
  loadError.value = false
  try {
    const data = await driveList(currentId.value)
    items.value = data?.items || []
    breadcrumb.value = data?.breadcrumb || []
  } catch (e) {
    //错误提示已由 axios 拦截器统一处理, 这里只切换到错误态
    items.value = []
    breadcrumb.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  try {
    const data = await driveStats()
    stats.value = data || {files: 0, folders: 0, size: 0}
  } catch (e) {
    //统计失败不影响浏览, 忽略
  }
}

function refreshAll() {
  load()
  loadStats()
}

//切换目录并清空搜索与选择
function goTo(id, name) {
  currentId.value = id
  currentName.value = id === 0 ? '' : (name || '')
  keyword.value = ''
  selectedRows.value = []
  searchResults.value = []
  load()
}

function openFolder(row) {
  goTo(row.id, row.name)
}

function clearSelection() {
  tableRef.value?.clearSelection()
  selectedRows.value = []
}

function onSelectionChange(rows) {
  selectedRows.value = rows || []
}

function onRowDblclick(row) {
  if (row.isDir) {
    openFolder(row)
  } else {
    downloadFile(row)
  }
}

function onRowCommand(command, row) {
  if (command === 'open') {
    openFolder(row)
  } else if (command === 'rename') {
    renameRow(row)
  } else if (command === 'move') {
    openPicker('move', [row])
  } else if (command === 'copy') {
    openPicker('copy', [row])
  } else if (command === 'download') {
    downloadFile(row)
  } else if (command === 'delete') {
    deleteRows([row])
  }
}

//重命名: 用弹窗输入新名称
function renameRow(row) {
  ElMessageBox.prompt(t('driveRenameLabel'), t('driveRenameTitle'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    inputValue: row.name,
  }).then(async ({value}) => {
    const name = (value || '').trim()
    if (!validateName(name)) {
      return
    }
    try {
      await driveRename(row.id, name)
      ElMessage({message: t('driveRenameDone'), type: 'success', plain: true, grouping: true})
      await afterChange()
    } catch (e) {
      //错误提示已由 axios 拦截器统一处理
    }
  }).catch(() => {
  })
}

//新建文件夹
function newFolder() {
  ElMessageBox.prompt(t('driveNewFolderPlaceholder'), t('driveNewFolderTitle'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
  }).then(async ({value}) => {
    const name = (value || '').trim()
    if (!validateName(name)) {
      return
    }
    try {
      await driveMkdir(currentId.value, name)
      ElMessage({message: t('driveMkdirDone'), type: 'success', plain: true, grouping: true})
      await afterChange()
    } catch (e) {
      //错误提示已由 axios 拦截器统一处理
    }
  }).catch(() => {
  })
}

function validateName(name) {
  if (!name) {
    ElMessage({message: t('driveNameRequired'), type: 'warning', plain: true, grouping: true})
    return false
  }
  if (/[/\\:*?"<>|]/.test(name)) {
    ElMessage({message: t('driveNameInvalid'), type: 'warning', plain: true, grouping: true})
    return false
  }
  return true
}

//删除: 网盘无回收站, 必须二次确认
function deleteRows(rows) {
  const ids = (rows || []).map(row => row.id)
  if (!ids.length) {
    ElMessage({message: t('driveSelectFirst'), type: 'warning', plain: true, grouping: true})
    return
  }
  ElMessageBox.confirm(t('driveDeleteConfirm', {count: ids.length}), t('driveDeleteTitle'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning',
  }).then(async () => {
    try {
      const data = await driveDelete(ids)
      ElMessage({message: t('driveDeleteDone', {count: data?.count ?? ids.length}), type: 'success', plain: true, grouping: true})
      await afterChange()
    } catch (e) {
      //错误提示已由 axios 拦截器统一处理
    }
  }).catch(() => {
  })
}

//操作完成后刷新列表、统计并清空选择
async function afterChange() {
  await load()
  await loadStats()
  clearSelection()
}

//搜索
async function runSearch(kw) {
  searchLoading.value = true
  selectedRows.value = []
  try {
    const data = await driveSearch(kw)
    searchResults.value = data?.items || []
  } catch (e) {
    searchResults.value = []
  } finally {
    searchLoading.value = false
  }
}

//下载: 该接口返回二进制流, 不能用 axios 实例, 手动带 token 走 fetch
async function downloadFile(row) {
  if (row.isDir) {
    return
  }
  try {
    const res = await fetch(`${import.meta.env.VITE_BASE_URL}/drive/file/${row.id}?download=1`, {
      headers: {Authorization: localStorage.getItem('token') || ''}
    })
    if (!res.ok) {
      ElMessage({message: t('driveDownloadFail'), type: 'error', plain: true, grouping: true})
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = row.name
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  } catch (e) {
    ElMessage({message: t('driveDownloadFail'), type: 'error', plain: true, grouping: true})
  }
}

async function downloadSelected() {
  if (!selectedAllFiles.value) {
    return
  }
  for (const row of selectedRows.value.slice()) {
    await downloadFile(row)
  }
}

/* ---------------- 上传 ---------------- */

function pickFiles() {
  fileInputRef.value?.click()
}

function onFileChange(e) {
  const files = Array.from(e.target.files || [])
  //清空 value, 否则连选同一个文件不会再触发 change
  e.target.value = ''
  if (files.length) {
    uploadFiles(files)
  }
}

//逐个上传: 简单可靠, 也方便单文件进度展示
async function uploadFiles(files) {
  uploads.value = files.map(file => ({name: file.name, percent: 0, status: 'pending'}))
  uploading.value = true
  let ok = 0
  let fail = 0

  for (let i = 0; i < files.length; i++) {
    const record = uploads.value[i]
    record.status = 'uploading'
    try {
      await driveUpload(files[i], currentId.value, (evt) => {
        if (evt && evt.total) {
          record.percent = Math.round((evt.loaded / evt.total) * 100)
        }
      })
      record.percent = 100
      record.status = 'done'
      ok++
    } catch (e) {
      record.status = 'error'
      fail++
    }
  }

  uploading.value = false

  if (ok && fail) {
    ElMessage({message: t('driveUploadPartial'), type: 'warning', plain: true, grouping: true})
  } else if (ok) {
    ElMessage({message: t('driveUploadSuccess'), type: 'success', plain: true, grouping: true})
  } else if (fail) {
    ElMessage({message: t('driveUploadFail'), type: 'error', plain: true, grouping: true})
  }

  await afterChange()
}

function clearUploads() {
  if (uploading.value) {
    return
  }
  uploads.value = []
}

/* 拖拽上传: 用计数避免子元素 dragleave 误关高亮 */
const dragActive = ref(false)
let dragDepth = 0

function onDragEnter() {
  dragDepth++
  dragActive.value = true
}

function onDragOver(e) {
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy'
  }
}

function onDragLeave() {
  dragDepth--
  if (dragDepth <= 0) {
    dragDepth = 0
    dragActive.value = false
  }
}

function onDrop(e) {
  dragDepth = 0
  dragActive.value = false
  const files = Array.from(e.dataTransfer?.files || [])
  if (files.length) {
    uploadFiles(files)
  }
}

/* ---------------- AI 操作 ---------------- */

//智能归类: 有选中就归类选中项, 否则归类当前文件夹里的全部文件
async function runTidy() {
  const ids = selectedRows.value.length
      ? selectedRows.value.map(row => row.id)
      : items.value.filter(row => !row.isDir).map(row => row.id)
  if (!ids.length) {
    ElMessage({message: t('driveTidyEmpty'), type: 'warning', plain: true, grouping: true})
    return
  }
  tidyLoading.value = true
  const hint = ElMessage({message: t('driveTidyRunning'), type: 'info', plain: true, grouping: true, duration: 0})
  try {
    const data = await driveTidy(ids)
    ElMessage({message: t('driveTidyDone', {count: data?.count ?? ids.length}), type: 'success', plain: true, grouping: true})
    await afterChange()
  } catch (e) {
    ElMessage({message: t('driveAiFail'), type: 'error', plain: true, grouping: true})
  } finally {
    hint.close()
    tidyLoading.value = false
  }
}

//AI 打标签: 仅针对选中的条目
async function runAutotag() {
  const ids = selectedRows.value.map(row => row.id)
  if (!ids.length) {
    ElMessage({message: t('driveSelectFirst'), type: 'warning', plain: true, grouping: true})
    return
  }
  tagLoading.value = true
  const hint = ElMessage({message: t('driveTagRunning'), type: 'info', plain: true, grouping: true, duration: 0})
  try {
    const data = await driveAutotag(ids)
    ElMessage({message: t('driveTagDone', {count: data?.count ?? ids.length}), type: 'success', plain: true, grouping: true})
    await load()
  } catch (e) {
    ElMessage({message: t('driveAiFail'), type: 'error', plain: true, grouping: true})
  } finally {
    hint.close()
    tagLoading.value = false
  }
}

/* ---------------- 移动 / 复制文件夹选择器 ---------------- */

function openPicker(mode, rows) {
  const list = rows && rows.length ? rows : selectedRows.value
  if (!list.length) {
    ElMessage({message: t('driveSelectFirst'), type: 'warning', plain: true, grouping: true})
    return
  }
  pickerMode.value = mode
  pickerSelectedIds.value = list.map(row => row.id)
  pickerParentId.value = 0
  pickerParentName.value = ''
  pickerBreadcrumb.value = []
  pickerItems.value = []
  pickerVisible.value = true
  loadPicker(0)
}

async function loadPicker(parentId) {
  pickerLoading.value = true
  try {
    const data = await driveList(parentId)
    pickerItems.value = data?.items || []
    pickerBreadcrumb.value = data?.breadcrumb || []
    pickerParentId.value = data?.parentId ?? parentId
  } catch (e) {
    pickerItems.value = []
    pickerBreadcrumb.value = []
  } finally {
    pickerLoading.value = false
  }
}

function pickerGoTo(id) {
  if (id === 0) {
    pickerParentName.value = ''
  } else {
    const hit = pickerItems.value.find(item => item.id === id)
      || pickerBreadcrumb.value.find(item => item.id === id)
    pickerParentName.value = hit ? hit.name : pickerParentName.value
  }
  loadPicker(id)
}

async function confirmPicker() {
  const ids = pickerSelectedIds.value.slice()
  const target = pickerParentId.value
  try {
    if (pickerMode.value === 'move') {
      const data = await driveMove(ids, target)
      ElMessage({message: t('driveMoveDone', {count: data?.count ?? ids.length}), type: 'success', plain: true, grouping: true})
    } else {
      const data = await driveCopy(ids, target)
      ElMessage({message: t('driveCopyDone', {count: data?.count ?? ids.length}), type: 'success', plain: true, grouping: true})
    }
    pickerVisible.value = false
    await afterChange()
  } catch (e) {
    //错误提示已由 axios 拦截器统一处理
  }
}
</script>

<style scoped lang="scss">
.drive-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  width: 100%;
  max-width: 100%;
  //兜底: 任何子元素都不该把整页撑出横向滚动条
  overflow-x: hidden;
  background: var(--extra-light-fill, transparent);
}

.drive-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px 12px;

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
    margin-top: 2px;
    color: var(--el-text-color-secondary);
  }

  .head-stats {
    flex-shrink: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  .stat-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    background: var(--glass-bg-soft, var(--el-fill-color-light));
    border: 1px solid var(--glass-border, var(--el-border-color-lighter));
  }
}

.drive-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 0 20px 10px;

  .crumb {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 2px;
    flex-wrap: wrap;
    font-size: 13px;
  }

  .crumb-btn {
    border: none;
    background: none;
    padding: 2px 4px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--el-color-primary);
    cursor: pointer;

    &:hover {
      background: var(--el-color-primary-light-9);
    }
  }

  .crumb-sep {
    flex-shrink: 0;
    color: var(--el-text-color-placeholder);
  }

  .crumb-current {
    padding: 2px 4px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  .toolbar-actions {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .tool-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;

    span {
      line-height: 1;
    }
  }

  .file-input {
    display: none;
  }
}

.drive-search {
  padding: 0 20px 10px;

  .search-box {
    max-width: 360px;
  }
}

.sel-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin: 0 20px 10px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--glass-border, var(--el-border-color-lighter));

  .sel-count {
    font-size: 13px;
    font-weight: 600;
    color: var(--el-color-primary);
  }

  .sel-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .sel-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;

    &.is-danger {
      color: var(--el-color-danger);
    }
  }
}

.drive-body {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 20px 16px;
}

.drop-mask {
  position: absolute;
  inset: 8px 20px 16px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-radius: var(--radius-md);
  border: 2px dashed var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  pointer-events: none;

  .drop-text {
    font-size: 14px;
    font-weight: 600;
  }
}

.state-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 0;
  color: var(--el-text-color-secondary);
}

.table-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 46px 0;

  .empty-icon {
    color: var(--el-text-color-placeholder);
  }

  .state-title {
    margin-top: 6px;
    font-size: 15px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  .state-desc {
    font-size: 12.5px;
    color: var(--el-text-color-secondary);
  }
}

.drive-table {
  width: 100%;
  background: transparent;

  :deep(.el-table__inner-wrapper:before) {
    background: var(--el-bg-color);
  }

  :deep(.el-table__header th) {
    background: var(--glass-bg-soft, var(--el-fill-color-light));
  }

  :deep(.el-table__row) {
    cursor: default;
  }
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  .name-icon {
    flex-shrink: 0;

    &.is-dir {
      color: var(--el-color-warning);
    }

    &.is-file {
      color: var(--el-text-color-secondary);
    }
  }

  .name-btn {
    min-width: 0;
    border: none;
    background: none;
    padding: 0;
    font-size: 13px;
    color: var(--el-text-color-primary);
    cursor: pointer;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;

    &:hover {
      color: var(--el-color-primary);
      text-decoration: underline;
    }
  }

  .name-text {
    min-width: 0;
    font-size: 13px;
    color: var(--el-text-color-regular);
    cursor: pointer;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;

    &:hover {
      color: var(--el-color-primary);
    }
  }
}

.size-cell,
.time-cell,
.path-cell {
  font-size: 12.5px;
  color: var(--el-text-color-secondary);
}

.tag-cell {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.tag-chip {
  max-width: 90px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11.5px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.tag-more,
.tag-empty {
  font-size: 11.5px;
  color: var(--el-text-color-placeholder);
}

.row-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  color: var(--el-text-color-secondary);
  background: transparent;

  &:hover {
    color: var(--el-color-primary);
    background: var(--el-fill-color-light);
  }
}

.upload-panel {
  margin: 0 20px 12px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--glass-bg-soft, var(--el-fill-color-light));
  border: 1px solid var(--glass-border, var(--el-border-color-lighter));

  .upload-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .upload-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  .upload-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    color: var(--el-text-color-secondary);
    background: transparent;

    &:disabled {
      cursor: not-allowed;
      opacity: .4;
    }

    &:hover:not(:disabled) {
      color: var(--el-color-danger);
    }
  }

  .upload-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 160px;
    overflow-y: auto;
  }

  .upload-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .upload-icon {
    flex-shrink: 0;
    color: var(--el-text-color-secondary);

    &.done {
      color: var(--el-color-success);
    }

    &.error {
      color: var(--el-color-danger);
    }
  }

  .upload-name {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    color: var(--el-text-color-regular);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .upload-bar {
    flex-shrink: 0;
    width: 120px;
  }

  .upload-percent {
    flex-shrink: 0;
    width: 40px;
    text-align: right;
    font-size: 12px;
    color: var(--el-text-color-secondary);
  }
}

.picker {
  display: flex;
  flex-direction: column;
  gap: 10px;

  .picker-path {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-wrap: wrap;
    font-size: 13px;
  }

  .crumb-btn {
    border: none;
    background: none;
    padding: 2px 4px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--el-color-primary);
    cursor: pointer;

    &:hover {
      background: var(--el-color-primary-light-9);
    }
  }

  .crumb-sep {
    color: var(--el-text-color-placeholder);
  }

  .picker-list {
    min-height: 200px;
    max-height: 320px;
    overflow-y: auto;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 10px;
    padding: 4px;
  }

  .picker-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 13px;
    color: var(--el-text-color-regular);
    cursor: pointer;

    &:hover {
      background: var(--el-fill-color-light);
    }

    .picker-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .picker-enter {
      color: var(--el-text-color-placeholder);
    }
  }

  .picker-empty {
    padding: 40px 0;
    text-align: center;
    font-size: 12.5px;
    color: var(--el-text-color-placeholder);
  }

  .picker-tip {
    font-size: 12px;
    color: var(--el-text-color-secondary);
    overflow-wrap: anywhere;
  }
}

@media (max-width: 600px) {
  .drive-head {
    padding: 13px 14px 10px;
    flex-wrap: wrap;

    .head-stats {
      width: 100%;
      justify-content: flex-start;
    }
  }

  .drive-toolbar {
    padding: 0 14px 10px;

    .tool-btn span {
      display: none;
    }
  }

  .drive-search {
    padding: 0 14px 10px;

    .search-box {
      max-width: 100%;
    }
  }

  .sel-bar {
    margin: 0 14px 10px;
  }

  .drive-body {
    padding: 0 14px 12px;
  }

  .upload-panel {
    margin: 0 14px 10px;

    .upload-bar {
      width: 70px;
    }
  }
}
</style>