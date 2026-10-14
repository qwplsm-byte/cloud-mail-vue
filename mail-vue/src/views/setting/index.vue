<template>
  <div class="box">
    <div class="container">
      <div class="title">{{$t('profile')}}</div>
      <div class="item">
        <div>{{$t('username')}}</div>
        <div>
          <span v-if="setNameShow" class="edit-name-input">
            <el-input v-model="accountName"  ></el-input>
            <span class="edit-name" @click="setName">
             {{$t('save')}}
            </span>
          </span>
          <span v-else class="user-name">
            <span >{{ userStore.user.name }}</span>
            <span class="edit-name" @click="showSetName">
             {{$t('change')}}
            </span>
          </span>
        </div>
      </div>
      <div class="item">
        <div>{{$t('emailAccount')}}</div>
        <div>{{ userStore.user.email }}</div>
      </div>
      <div class="item">
        <div>{{$t('password')}}</div>
        <div>
          <el-button type="primary" @click="pwdShow = true">{{$t('changePwdBtn')}}</el-button>
        </div>
      </div>
    </div>
    <div class="language">
      <div class="title">{{$t('language')}}</div>
      <el-select
          :model-value="langSelect"
          class="language-select"
          placeholder="Select"
          @change="changeLang"
      >
        <el-option label="中文" value="zh" @pointerdown.prevent.stop="changeLang('zh')"/>
        <el-option label="English" value="en" @pointerdown.prevent.stop="changeLang('en')"/>
      </el-select>
    </div>
    <div class="passkey" v-if="passkeySupported">
      <div class="title">{{$t('passkeyManage')}}</div>
      <div class="passkey-desc">{{$t('passkeyDesc')}}</div>
      <div class="passkey-list" v-if="passkeyItems.length">
        <div class="passkey-item" v-for="item in passkeyItems" :key="item.id">
          <div class="passkey-info">
            <Icon icon="mdi:fingerprint" width="20" height="20" class="passkey-icon"/>
            <div class="passkey-meta">
              <div class="passkey-name">{{ item.name }}</div>
              <div class="passkey-sub">
                {{$t('passkeyCreateTime')}}：{{ item.createTime }}
                <span v-if="item.lastUsedTime"> · {{$t('passkeyLastUsed')}}：{{ item.lastUsedTime }}</span>
                <span v-else> · {{$t('passkeyNeverUsed')}}</span>
              </div>
            </div>
          </div>
          <div class="passkey-ops">
            <span class="edit-name" @click="renamePasskey(item)">{{$t('rename')}}</span>
            <span class="edit-name del" @click="deletePasskey(item)">{{$t('delete')}}</span>
          </div>
        </div>
      </div>
      <div class="passkey-empty" v-else>{{$t('passkeyEmpty')}}</div>
      <div>
        <el-button type="primary" :loading="passkeyAddLoading" @click="addPasskey">{{$t('passkeyAdd')}}</el-button>
      </div>
    </div>
    <div class="del-email" v-perm="'my:delete'">
      <div class="title">{{$t('deleteUser')}}</div>
      <div style="color: var(--regular-text-color);">
        {{$t('delAccountMsg')}}
      </div>
      <div>
        <el-button type="primary" @click="deleteConfirm">{{$t('deleteUserBtn')}}</el-button>
      </div>
    </div>
    <el-dialog v-model="pwdShow" :title="$t('changePassword')" width="340">
      <div class="update-pwd">
        <el-input type="password" :placeholder="$t('newPassword')" v-model="form.password" autocomplete="off" @keyup.enter="submitPwd"/>
        <el-input type="password" :placeholder="$t('confirmPassword')" v-model="form.newPwd" autocomplete="off" @keyup.enter="submitPwd"/>
        <el-button type="primary" :loading="setPwdLoading" @click="submitPwd">{{$t('save')}}</el-button>
      </div>
    </el-dialog>
  </div>
</template>
<script setup>
import {reactive, ref, defineOptions, onMounted} from 'vue'
import {Icon} from "@iconify/vue";
import {startRegistration} from "@simplewebauthn/browser";
import {
  passkeyRegisterOptions,
  passkeyRegisterVerify,
  passkeyList,
  passkeyRename,
  passkeyDelete
} from "@/request/passkey.js";
import {resetPassword, userDelete} from "@/request/my.js";
import {useUserStore} from "@/store/user.js";
import router from "@/router/index.js";
import {accountSetName} from "@/request/account.js";
import {useAccountStore} from "@/store/account.js";
import {useI18n} from "vue-i18n";
import {useSettingStore} from "@/store/setting.js";

const { t } = useI18n()
const accountStore = useAccountStore()
const settingStore = useSettingStore()
const userStore = useUserStore();
const setPwdLoading = ref(false)
const setNameShow = ref(false)
const accountName = ref(null)
const langSelect = ref(settingStore.lang)

defineOptions({
  name: 'setting'
})

function showSetName() {
  accountName.value = userStore.user.name
  setNameShow.value = true
}

function setName() {

  if (!accountName.value) {
    ElMessage({
      message: t('emptyUserNameMsg'),
      type: 'error',
      plain: true,
    })
    return;
  }

  setNameShow.value = false
  let name = accountName.value

  if (name === userStore.user.name) {
    return
  }

  userStore.user.name = accountName.value

  accountSetName(userStore.user.account.accountId,name).then(() => {
    ElMessage({
      message: t('saveSuccessMsg'),
      type: 'success',
      plain: true,
    })

    accountStore.changeUserAccountName = name

  }).catch(() => {
    userStore.user.name = name
  })
}

function changeLang(lang) {
  let setting = {}
  try {
    setting = JSON.parse(localStorage.getItem('setting') || '{}')
  } catch (e) {
    setting = {}
  }
  localStorage.setItem('setting', JSON.stringify({...setting, lang}))
  window.location.reload()
}

const pwdShow = ref(false)
const form = reactive({
  password: '',
  newPwd: '',
})

const deleteConfirm = () => {
  ElMessageBox.confirm(t('delAccountConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    userDelete().then(() => {
      localStorage.removeItem('token');
      router.replace('/login');
      ElMessage({
        message: t('delSuccessMsg'),
        type: 'success',
        plain: true,
      })
    })
  })
}


function submitPwd() {

  if (setPwdLoading.value) return

  if (!form.password) {
    ElMessage({
      message: t('emptyPwdMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (form.password.length < 6) {
    ElMessage({
      message: t('pwdLengthMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (form.password !== form.newPwd) {
    ElMessage({
      message: t('confirmPwdFailMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  setPwdLoading.value = true
  resetPassword(form.password).then(() => {
    ElMessage({
      message: t('saveSuccessMsg'),
      type: 'success',
      plain: true,
    })
    pwdShow.value = false
    setPwdLoading.value = false
    form.password = ''
    form.newPwd = ''
  }).catch(() => {
    setPwdLoading.value = false
  })

}

//通行密钥管理: 需要安全上下文且浏览器支持
const passkeySupported = ref(typeof window !== 'undefined' && !!window.PublicKeyCredential && window.isSecureContext)
const passkeyAddLoading = ref(false)
const passkeyItems = ref([])

async function loadPasskeys() {
  if (!passkeySupported.value) return
  try {
    const {items} = await passkeyList()
    passkeyItems.value = items || []
  } catch (e) {
    console.warn('获取通行密钥列表失败', e)
  }
}

//添加: 取注册 options -> 调起系统验证 -> 回服务端持久化
async function addPasskey() {

  if (passkeyAddLoading.value) return

  passkeyAddLoading.value = true

  try {
    const {options, nonce} = await passkeyRegisterOptions()
    const response = await startRegistration({optionsJSON: options})
    await passkeyRegisterVerify({nonce, response})
    ElMessage({
      message: t('passkeyAddSuccess'),
      type: 'success',
      plain: true,
    })
    await loadPasskeys()
  } catch (e) {
    //用户主动取消系统弹窗时不报错
    if (e?.name !== 'NotAllowedError') {
      ElMessage({
        message: t('passkeyAddFail'),
        type: 'error',
        plain: true,
      })
    }
    console.warn('添加通行密钥未完成', e)
  } finally {
    passkeyAddLoading.value = false
  }
}

function renamePasskey(item) {
  ElMessageBox.prompt(t('passkeyRenamePrompt'), t('passkeyRenameTitle'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    inputValue: item.name,
    inputValidator: (value) => !!(value || '').trim()
  }).then(({value}) => {
    const name = (value || '').trim()
    if (!name || name === item.name) return
    passkeyRename({id: item.id, name}).then(() => {
      item.name = name
      ElMessage({
        message: t('passkeyRenamed'),
        type: 'success',
        plain: true,
      })
    })
  }).catch(() => {})
}

function deletePasskey(item) {
  ElMessageBox.confirm(t('passkeyDeleteConfirm'), t('delete'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    passkeyDelete({id: item.id}).then(() => {
      passkeyItems.value = passkeyItems.value.filter(p => p.id !== item.id)
      ElMessage({
        message: t('passkeyDeleteSuccess'),
        type: 'success',
        plain: true,
      })
    }).catch(() => {
      ElMessage({
        message: t('passkeyDeleteFail'),
        type: 'error',
        plain: true,
      })
    })
  }).catch(() => {})
}

onMounted(() => {
  loadPasskeys()
})

</script>
<style scoped lang="scss">
.box {
  height: 100%;
  overflow-y: auto;
  padding: 40px 40px;

  @media (max-width: 767px) {
    padding: 30px 30px;
  }

  .update-pwd {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }

  .title {
    font-size: 18px;
    font-weight: bold;
  }

  .container {
    font-size: 14px;
    display: grid;
    gap: 20px;
    margin-bottom: 40px;

    .item {
      display: grid;
      grid-template-columns: 50px 1fr;
      gap: 140px;
      position: relative;
      .user-name {
        display: grid;
        grid-template-columns: auto 1fr;
        span:first-child {
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
      }

      .edit-name-input {
        position: absolute;
        bottom: -6px;
        .el-input {
          width: min(200px,calc(100vw - 222px));
        }
      }

      .edit-name {
        color: #4dabff;
        padding-left: 10px;
        cursor: pointer;
      }

      @media (max-width: 767px) {
        gap: 70px;
      }

      div:first-child {
        font-weight: bold;
      }

      div:last-child {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
    }
  }

  .language {
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin-bottom: 40px;

    .language-select {
      width: 100px;
    }
  }

  .passkey {
    font-size: 14px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 40px;

    .passkey-desc {
      color: var(--regular-text-color);
    }

    .passkey-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .passkey-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border: 1px solid var(--border-color);
      border-radius: 8px;

      .passkey-info {
        display: flex;
        align-items: center;
        gap: 12px;
        overflow: hidden;

        .passkey-icon {
          flex-shrink: 0;
          color: var(--regular-text-color);
        }

        .passkey-meta {
          overflow: hidden;

          .passkey-name {
            font-weight: bold;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
          }

          .passkey-sub {
            color: var(--regular-text-color);
            font-size: 12px;
            margin-top: 4px;
          }
        }
      }

      .passkey-ops {
        flex-shrink: 0;
        display: flex;
        gap: 12px;

        .edit-name {
          color: #4dabff;
          cursor: pointer;
        }

        .edit-name.del {
          color: var(--el-color-danger);
        }
      }
    }

    .passkey-empty {
      color: var(--regular-text-color);
    }
  }

  .del-email {
    font-size: 14px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
}
</style>
