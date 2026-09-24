<template>
  <div class="layout">
    <div v-if="wallpaper" class="wallpaper">
      <video
          v-if="wallpaperIsVideo"
          class="wallpaper-media"
          :src="wallpaper"
          autoplay
          muted
          loop
          playsinline
      ></video>
      <div
          v-else
          class="wallpaper-media wallpaper-image"
          :style="{ backgroundImage: `url('${wallpaper}')` }"
      ></div>
      <div class="wallpaper-mask" :style="{ opacity: maskOpacity }"></div>
    </div>
    <div class="ambient" :class="{ 'ambient-hide': wallpaper }"></div>
    <div class="layout-skin"></div>
    <el-aside
        class="aside"
        :class="uiStore.asideShow ? 'aside-show' : 'el-aside-hide'">
      <Aside :collapse="collapse" />
    </el-aside>
    <div
        :class="(uiStore.asideShow && isMobile)? 'overlay-show':'overlay-hide'"
        @click="uiStore.asideShow = false"
    ></div>
    <el-container class="main-container">
      <el-main>
        <el-header>
            <Header />
        </el-header>
        <Main />
      </el-main>
    </el-container>
  </div>
  <writer ref="writerRef" />
</template>

<script setup>
import Aside from '@/layout/aside/index.vue'
import Header from '@/layout/header/index.vue'
import Main from '@/layout/main/index.vue'
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import {useUiStore} from "@/store/ui.js";
import {useSettingStore} from "@/store/setting.js";
import {cvtR2Url} from "@/utils/convert.js";
import writer from '@/layout/write/index.vue'

const uiStore = useUiStore();
const settingStore = useSettingStore();

/* 主界面壁纸：图片/动图走背景图，视频用 video 标签静音循环播放 */
const wallpaperIsVideo = computed(() => /\.(mp4|webm|ogv|ogg|mov|m4v)$/i.test(settingStore.settings.layoutBackground || ''))

const wallpaper = computed(() => {
  const key = settingStore.settings.layoutBackground
  if (!key) return ''
  const url = cvtR2Url(key)
  if (!url || url === 'https://') return ''
  return url.startsWith('http') ? url : '/' + url.replace(/^\/+/, '')
})

const maskOpacity = computed(() => {
  const value = Number(settingStore.settings.layoutBackgroundMask)
  return (Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 45) / 100
})
const writerRef = ref({})
const isMobile = ref(window.innerWidth < 1025)
const handleResize = () => {
  isMobile.value = window.innerWidth < 1025
  uiStore.asideShow = window.innerWidth > 1024;
}

/* 桌面端：侧边栏折叠为图标栏（移动端为抽屉，不参与折叠） */
const collapse = computed(() => !isMobile.value && !uiStore.asideShow)

onMounted(() => {
  uiStore.writerRef = writerRef

  window.addEventListener('resize', handleResize)
  handleResize()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<style lang="scss" scoped>
.el-aside.el-aside-hide {
  width: 60px; /* 桌面端折叠为图标栏，而非整体隐藏 */
}

.el-aside.aside-show {
  width: 248px;
  -webkit-box-shadow: var(--aside-right-border);
  box-shadow: var(--aside-right-border);
}

.el-aside {
  position: relative;
  z-index: 102;
  flex: none;
  height: 100%;
  min-height: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  transition: width .32s cubic-bezier(.25, .8, .3, 1);
}

.layout {
  height: 100vh;
  width: 100%;
  display: flex;
  overflow: hidden;
  position: relative;
}

/* 主界面壁纸：图片/GIF 用背景图，视频用 <video>，上层压一层可调透明度的遮罩保证可读性 */
.wallpaper {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.wallpaper-media {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.wallpaper-image {
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}

.wallpaper-mask {
  position: absolute;
  inset: 0;
  background: var(--el-bg-color);
}

/* 有壁纸时隐藏氛围光，避免和壁纸叠在一起发花 */
.ambient.ambient-hide {
  display: none;
}

/* 玻璃背后的淡彩氛围光 */
.ambient {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
      radial-gradient(60% 70% at 12% 18%, var(--ambient-1), transparent 62%),
      radial-gradient(55% 65% at 88% 20%, var(--ambient-2), transparent 60%),
      radial-gradient(50% 60% at 78% 88%, var(--ambient-3), transparent 60%),
      radial-gradient(45% 55% at 16% 86%, var(--ambient-4), transparent 58%),
      var(--el-bg-color);
  filter: saturate(1.1);
}

.layout-skin {
  position: fixed;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.12), transparent 40%, rgba(255, 255, 255, 0.04));
}

.main-container {
  flex: 1;
  min-width: 0;
  position: relative;
  z-index: 2;
  min-height: 100%;
  background: transparent;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.el-main {
  padding: 0;
  height: 100%;
}

.el-header {
  background: transparent;
  border-bottom: none;
  padding: 0;
  position: sticky;
  top: 0;
  z-index: 5;
}

.overlay-show {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.4);
  z-index: 99;
  transition: all 0.3s;
}

.overlay-hide {
  display: flex;
  pointer-events: none;
  opacity: 0;
}

/* 移动端：侧边栏改为覆盖抽屉 */
@media (max-width: 1025px) {
  .el-aside, .el-aside.aside-show, .el-aside.el-aside-hide {
    position: fixed;
    top: 0;
    left: 0;
    height: 100%;
  }
  .el-aside.aside-show {
    width: min(284px, 84vw);
    transform: translateX(0);
    background: var(--glass-bg-strong);
    -webkit-backdrop-filter: blur(30px) saturate(170%);
    backdrop-filter: blur(30px) saturate(170%);
  }
  .el-aside.el-aside-hide {
    width: min(284px, 84vw);
    transform: translateX(-104%);
  }
}
</style>
