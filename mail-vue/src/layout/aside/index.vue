<template>
  <div class="aside-shell" :class="collapse ? 'collapsed' : ''">
    <div class="brand" @click="router.push({name: 'email'})">
      <span class="brand-badge"><Icon icon="mdi:email-outline" :width="20" :height="20" /></span>
      <div class="brand-name">{{settingStore.settings.title}}</div>
    </div>

    <el-scrollbar class="scrollbar">
      <el-menu
          :collapse="collapse"
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

        <!-- 网盘：每个登录用户都有自己的空间 -->
        <el-menu-item @click="router.push({name: 'drive'})" index="drive"
                      :class="route.meta.name === 'drive' ? 'is-active' : ''">
          <Icon icon="mdi:cloud-outline" :width="19" :height="19" />
          <span class="menu-name">{{$t('drive')}}</span>
        </el-menu-item>

        <!-- AI 助手：位于管理之下、个人设置之上 -->
        <el-menu-item @click="router.push({name: 'ai'})" index="ai"
                      :class="route.meta.name === 'ai' ? 'is-active' : ''">
          <img class="menu-avatar" :src="whaleAvatar" alt=""/>
          <span class="menu-name">{{$t('aiAssistant')}}</span>
        </el-menu-item>
      </el-menu>
    </el-scrollbar>

    <!-- 个人设置：常驻底部（原生元素，确保一定渲染） -->
    <div class="aside-footer">
      <div class="profile-item" role="button" tabindex="0"
           :class="route.meta.name === 'setting' ? 'is-active' : ''"
           @click="router.push({name: 'setting'})">
        <Icon icon="fluent:settings-48-regular" :width="19" :height="19" />
        <span class="menu-name">{{$t('settings')}}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import router from "@/router/index.js";
import { useRoute } from "vue-router";
import {Icon} from "@iconify/vue";
import {useSettingStore} from "@/store/setting.js";
//AI 助手改用鲸娘头像, 侧边栏与对话页保持同一形象
import whaleAvatar from "@/assets/whale-girl.png";

defineProps({
  collapse: { type: Boolean, default: false },
});

const settingStore = useSettingStore();
const route = useRoute();
</script>

<style lang="scss" scoped>
.aside-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  width: 100%;
  max-width: 248px;
  padding: 16px 12px 14px;
  background: var(--aside-bg, var(--glass-bg-soft));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  border-right: 1px solid var(--aside-border, var(--glass-border));
  box-shadow: var(--aside-shadow, var(--glass-highlight), 6px 0 30px -22px rgba(30, 55, 110, 0.4));
  transition: max-width .32s cubic-bezier(.25, .8, .3, 1), padding .32s cubic-bezier(.25, .8, .3, 1);
}

/* 侧边栏 AI 图标: 鲸娘头像, 尺寸与其它菜单图标一致 */
.menu-avatar {
  width: 19px;
  height: 19px;
  flex-shrink: 0;
  border-radius: 50%;
  object-fit: cover;
  background: var(--el-color-primary-light-9);
}

/* 桌面端折叠为图标栏 */
.aside-shell.collapsed {
  max-width: 60px;
  padding: 16px 0 14px;
  border-right: 1px solid var(--aside-border, var(--glass-border));

  .brand {
    justify-content: center;
    padding: 0;
    gap: 0;
  }
  .brand-name {
    display: none;
  }

  /* 折叠态：底部"个人设置"只显示图标并居中 */
  .aside-footer .menu-name {
    display: none;
  }
  .aside-footer .profile-item {
    justify-content: center;
    padding: 0;
  }
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
    color: var(--brand-badge-text, #fff);
    border-radius: 12px;
    background: var(--brand-badge-bg, linear-gradient(135deg, #4c9aff, #7b5cff));
    box-shadow: var(--brand-badge-shadow, 0 8px 20px -8px rgba(74, 130, 255, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.4));
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
  /* 折叠态：让图标栏占满、无多余内边距 */
  :deep(.el-menu--collapse) {
    width: 100%;
    border-right: 0;
  }
  :deep(.el-menu--collapse .el-menu-item),
  :deep(.el-menu--collapse .el-sub-menu__title) {
    padding: 0 !important;
    margin: 3px 0;
  }
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
    border-radius: var(--menu-item-radius, 12px);
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
    background: var(--menu-hover-bg, rgba(255, 255, 255, 0.5));
  }

  :deep(.el-sub-menu__icon-arrow) {
    transition: transform 0.25s ease;
  }

  :deep(.el-sub-menu.is-opened > .el-sub-menu__title .el-sub-menu__icon-arrow) {
    transform: rotate(90deg);
  }

  :deep(.el-menu-item.is-active),
  :deep(.el-menu .el-menu-item.is-active) {
    background: var(--menu-active-bg, linear-gradient(135deg, rgba(26, 123, 255, 0.9), rgba(91, 96, 255, 0.9)));
    color: var(--menu-active-text, #fff) !important;
    box-shadow: var(--menu-active-shadow, 0 10px 24px -10px rgba(45, 100, 255, 0.6));
  }
}

.aside-footer {
  margin-top: 10px;
  padding-top: 12px;
  border-top: 1px solid var(--aside-border, var(--glass-border));

  .profile-item {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 40px;
    margin: 3px 0;
    padding: 0 12px;
    border-radius: var(--menu-item-radius, 12px);
    color: var(--aside-text);
    cursor: pointer;
    user-select: none;
    transition: background 0.18s ease, color 0.18s ease;
  }

  .profile-item:hover {
    background: var(--menu-hover-bg, rgba(255, 255, 255, 0.5));
  }

  .profile-item.is-active {
    background: var(--menu-active-bg, linear-gradient(135deg, rgba(26, 123, 255, 0.9), rgba(91, 96, 255, 0.9)));
    color: var(--menu-active-text, #fff) !important;
    box-shadow: var(--menu-active-shadow, 0 10px 24px -10px rgba(45, 100, 255, 0.6));
  }
}

.menu-name {
  user-select: none;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>