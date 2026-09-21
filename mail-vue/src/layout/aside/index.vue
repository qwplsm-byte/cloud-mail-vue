<template>
  <div class="aside-shell">
    <div class="brand" @click="router.push({name: 'email'})">
      <span class="brand-badge"><Icon icon="mdi:email-outline" :width="20" :height="20" /></span>
      <div class="brand-name">{{settingStore.settings.title}}</div>
    </div>

    <el-scrollbar class="scrollbar">
      <el-menu
          :collapse="false"
          :default-openeds="['mail', 'manage']"
          class="glass-menu"
          text-color="var(--aside-text)"
          active-text-color="var(--aside-text-active)">
        <!-- 收件箱：主入口，独立展示 -->
        <el-menu-item @click="router.push({name: 'email'})" index="email"
                      :class="route.meta.name === 'email' ? 'is-active' : ''">
          <Icon icon="hugeicons:mailbox-01" :width="19" :height="19" />
          <span class="menu-name">{{$t('inbox')}}</span>
        </el-menu-item>

        <!-- 邮件分类：已发送 / 草稿 / 收藏 -->
        <el-sub-menu index="mail">
          <template #title>
            <Icon icon="fluent:folder-16-regular" :width="19" :height="19" />
            <span class="menu-name">{{$t('mailbox')}}</span>
          </template>
          <el-menu-item @click="router.push({name: 'send'})" index="send" v-perm="'email:send'"
                        :class="route.meta.name === 'send' ? 'is-active' : ''">
            <Icon icon="cil:send" :width="17" :height="17" />
            <span class="menu-name">{{$t('sent')}}</span>
          </el-menu-item>
          <el-menu-item @click="router.push({name: 'draft'})" index="draft" v-perm="'email:send'"
                        :class="route.meta.name === 'draft' ? 'is-active' : ''">
            <Icon icon="ep:document" :width="16" :height="16" />
            <span class="menu-name">{{$t('drafts')}}</span>
          </el-menu-item>
          <el-menu-item @click="router.push({name: 'star'})" index="star"
                        :class="route.meta.name === 'star' ? 'is-active' : ''">
            <Icon icon="solar:star-line-duotone" :width="18" :height="18" />
            <span class="menu-name">{{$t('starred')}}</span>
          </el-menu-item>
        </el-sub-menu>

        <!-- 管理与系统：合并同类管理功能 -->
        <el-sub-menu index="manage" v-perm="['analysis:query','user:query','role:query','all-email:query','reg-key:query','setting:query']">
          <template #title>
            <Icon icon="majesticons:settings-gear-line" :width="19" :height="19" />
            <span class="menu-name">{{$t('manage')}}</span>
          </template>
          <el-menu-item @click="router.push({name: 'analysis'})" index="analysis" v-perm="'analysis:query'"
                        :class="route.meta.name === 'analysis' ? 'is-active' : ''">
            <Icon icon="fluent:data-pie-20-regular" :width="18" :height="18" />
            <span class="menu-name">{{$t('analytics')}}</span>
          </el-menu-item>
          <el-menu-item @click="router.push({name: 'all-email'})" index="all-email" v-perm="'all-email:query'"
                        :class="route.meta.name === 'all-email' ? 'is-active' : ''">
            <Icon icon="fluent:mail-list-28-regular" :width="18" :height="18" />
            <span class="menu-name">{{$t('allMail')}}</span>
          </el-menu-item>
          <el-menu-item @click="router.push({name: 'user'})" index="user" v-perm="'user:query'"
                        :class="route.meta.name === 'user' ? 'is-active' : ''">
            <Icon icon="si:user-alt-2-line" :width="17" :height="17" />
            <span class="menu-name">{{$t('allUsers')}}</span>
          </el-menu-item>
          <el-menu-item @click="router.push({name: 'role'})" index="role" v-perm="'role:query'"
                        :class="route.meta.name === 'role' ? 'is-active' : ''">
            <Icon icon="fluent:lock-closed-16-regular" :width="18" :height="18" />
            <span class="menu-name">{{$t('permissions')}}</span>
          </el-menu-item>
          <el-menu-item @click="router.push({name: 'reg-key'})" index="reg-key" v-perm="'reg-key:query'"
                        :class="route.meta.name === 'reg-key' ? 'is-active' : ''">
            <Icon icon="fluent:fingerprint-20-filled" :width="18" :height="18" />
            <span class="menu-name">{{$t('inviteCode')}}</span>
          </el-menu-item>
          <el-menu-item @click="router.push({name: 'sys-setting'})" index="sys-setting" v-perm="'setting:query'"
                        :class="route.meta.name === 'sys-setting' ? 'is-active' : ''">
            <Icon icon="eos-icons:system-ok-outlined" :width="16" :height="16" />
            <span class="menu-name">{{$t('SystemSettings')}}</span>
          </el-menu-item>
        </el-sub-menu>
      </el-menu>
    </el-scrollbar>

    <!-- 个人设置：常驻底部 -->
    <div class="aside-footer">
      <el-menu-item @click="router.push({name: 'setting'})" index="setting"
                    :class="route.meta.name === 'setting' ? 'is-active' : ''">
        <Icon icon="fluent:settings-48-regular" :width="19" :height="19" />
        <span class="menu-name">{{$t('settings')}}</span>
      </el-menu-item>
    </div>
  </div>
</template>

<script setup>
import router from "@/router/index.js";
import { useRoute } from "vue-router";
import {Icon} from "@iconify/vue";
import {useSettingStore} from "@/store/setting.js";

const settingStore = useSettingStore();
const route = useRoute();
</script>

<style lang="scss" scoped>
.aside-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 248px;
  padding: 16px 12px 14px;
  background: var(--glass-bg-soft);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  backdrop-filter: blur(30px) saturate(180%);
  border-right: 1px solid var(--glass-border);
  box-shadow: var(--glass-highlight), 6px 0 30px -22px rgba(30, 55, 110, 0.4);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 48px;
  padding: 0 10px;
  margin-bottom: 14px;
  border-radius: var(--radius-md);
  cursor: pointer;
  user-select: none;

  .brand-badge {
    flex-shrink: 0;
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    border-radius: 12px;
    background: linear-gradient(135deg, #4c9aff, #7b5cff);
    box-shadow: 0 8px 20px -8px rgba(74, 130, 255, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }

  .brand-name {
    font-weight: 700;
    font-size: 16px;
    letter-spacing: 0.2px;
    color: var(--el-text-color-primary);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}

.scrollbar {
  flex: 1;
  min-height: 0;
}

.glass-menu {
  background: transparent;
  border-right: 0;
  /* 层级修正 */
  :deep(.el-menu),
  :deep(.el-sub-menu .el-menu) {
    background: transparent;
  }

  :deep(.el-menu-item),
  :deep(.el-sub-menu__title) {
    height: 40px;
    line-height: 40px;
    margin: 3px 0;
    padding: 0 12px !important;
    border-radius: 12px;
    color: var(--aside-text);
    transition: background 0.18s ease, color 0.18s ease;
  }

  :deep(.el-sub-menu .el-menu-item) {
    height: 38px;
    line-height: 38px;
    padding-left: 24px !important;
    font-size: 13px;
  }

  :deep(.el-sub-menu .el-menu-item .el-icon) {
    margin-right: 10px;
  }

  :deep(.el-menu-item:hover),
  :deep(.el-sub-menu__title:hover) {
    background: rgba(255, 255, 255, 0.5);
  }

  :deep(.el-sub-menu__icon-arrow) {
    transition: transform 0.25s ease;
  }

  :deep(.el-sub-menu.is-opened > .el-sub-menu__title .el-sub-menu__icon-arrow) {
    transform: rotate(90deg);
  }

  :deep(.el-menu-item.is-active),
  :deep(.el-menu .el-menu-item.is-active) {
    background: linear-gradient(135deg, rgba(26, 123, 255, 0.9), rgba(91, 96, 255, 0.9));
    color: #fff !important;
    box-shadow: 0 10px 24px -10px rgba(45, 100, 255, 0.6);
  }
}

.aside-footer {
  margin-top: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--glass-border);

  :deep(.el-menu-item) {
    height: 40px;
    line-height: 40px;
    margin: 3px 0;
    border-radius: 12px;
    padding: 0 12px !important;
    color: var(--aside-text);
  }

  :deep(.el-menu-item:hover) {
    background: rgba(255, 255, 255, 0.5);
  }

  :deep(.el-menu-item.is-active) {
    background: linear-gradient(135deg, rgba(26, 123, 255, 0.9), rgba(91, 96, 255, 0.9));
    color: #fff !important;
    box-shadow: 0 10px 24px -10px rgba(45, 100, 255, 0.6);
  }
}

.menu-name {
  user-select: none;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>