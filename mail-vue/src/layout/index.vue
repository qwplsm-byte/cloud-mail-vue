<template>
  <div class="layout">
    <div v-if="wallpaper" class="wallpaper">
      <video
          v-if="wallpaperIsVideo"
          :key="wallpaper"
          ref="wallpaperVideoRef"
          class="wallpaper-media"
          :src="wallpaper"
          preload="auto"
          loop
          playsinline
          @canplay="startWallpaperVideo"
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
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import {useUiStore} from "@/store/ui.js";
import {useSettingStore} from "@/store/setting.js";
import {cvtR2Url} from "@/utils/convert.js";
import {refreshTheme} from "@/theme/index.js";
import writer from '@/layout/write/index.vue'

const uiStore = useUiStore();
const settingStore = useSettingStore();

/* 主界面壁纸：图片/动图走背景图，视频用 video 标签循环播放 */
const wallpaperIsVideo = computed(() => /\.(mp4|webm|ogv|ogg|mov|m4v)$/i.test(settingStore.settings.layoutBackground || ''))

const wallpaper = computed(() => {
  const key = settingStore.settings.layoutBackground
  if (!key) return ''
  const url = cvtR2Url(key)
  if (!url || url === 'https://') return ''
  return url.startsWith('http') ? url : '/' + url.replace(/^\/+/, '')
})

/* 遮罩只用于必要时压暗壁纸提升文字可读性，默认 0 即按原样显示 */
const maskOpacity = computed(() => {
  const value = Number(settingStore.settings.layoutBackgroundMask)
  return (Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0) / 100
})

const wallpaperVideoRef = ref(null)
/* 已处理过的 video 元素，避免 canplay 多次触发时重复挂监听 */
let handledVideoEl = null
let detachUnmute = null

/*
 * 带声自动播放基本都会被浏览器拦截，所以先按有声启动；被拦下来再退回静音播放，
 * 等用户首次交互后补开声音。这样既不强制静音，也不会因为拦截而停在首帧。
 */
async function startWallpaperVideo() {
  const el = wallpaperVideoRef.value
  if (!el || el === handledVideoEl) return
  handledVideoEl = el

  if (detachUnmute) {
    detachUnmute()
  }

  el.muted = false
  try {
    await el.play()
    return
  } catch (e) {
    // 浏览器拒绝了带声自动播放，走静音回退
  }

  el.muted = true
  el.play().catch(() => {})

  const unmute = () => {
    el.muted = false
    detach()
  }
  const detach = () => {
    document.removeEventListener('pointerdown', unmute, true)
    document.removeEventListener('keydown', unmute, true)
    if (detachUnmute === detach) {
      detachUnmute = null
    }
  }
  document.addEventListener('pointerdown', unmute, true)
  document.addEventListener('keydown', unmute, true)
  detachUnmute = detach
}
const writerRef = ref({})
const isMobile = ref(window.innerWidth < 1025)
const handleResize = () => {
  isMobile.value = window.innerWidth < 1025
  uiStore.asideShow = window.innerWidth > 1024;
}

/* 桌面端：侧边栏折叠为图标栏（移动端为抽屉，不参与折叠） */
const collapse = computed(() => !isMobile.value && !uiStore.asideShow)

/* 主题或主界面壁纸变化时重新取色并应用(android 主题依赖壁纸主色) */
watch(
    () => [uiStore.theme, settingStore.settings.layoutBackground],
    () => { refreshTheme() },
    {immediate: true}
)

onMounted(() => {
  uiStore.writerRef = writerRef

  window.addEventListener('resize', handleResize)
  handleResize()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (detachUnmute) {
    detachUnmute()
  }
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
  background: var(--layout-skin, linear-gradient(160deg, rgba(255, 255, 255, 0.12), transparent 40%, rgba(255, 255, 255, 0.04)));
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
    background: var(--aside-bg, var(--glass-bg-strong));
    -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
    backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  }
  .el-aside.el-aside-hide {
    width: min(284px, 84vw);
    transform: translateX(-104%);
  }
}
</style>
