<template>
  <div class="layout">
    <div class="ambient"></div>
    <div class="layout-skin"></div>
    <el-aside
        class="aside"
        :class="uiStore.asideShow ? 'aside-show' : 'el-aside-hide'">
      <Aside />
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
import { ref, onMounted, onBeforeUnmount } from 'vue'
import {useUiStore} from "@/store/ui.js";
import writer from '@/layout/write/index.vue'

const uiStore = useUiStore();
const writerRef = ref({})
const isMobile = ref(window.innerWidth < 1025)
const handleResize = () => {
  isMobile.value = window.innerWidth < 1025
  uiStore.asideShow = window.innerWidth > 1024;
}

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
.el-aside-hide {
  position: fixed;
  left: 0;
  height: 100%;
  z-index: 100;
  transform: translateX(-100%);
  transition: all 100ms ease;
}

.aside-show {
  -webkit-box-shadow: var(--aside-right-border);
  box-shadow: var(--aside-right-border);
  transform: translateX(0);
  transition: all 100ms ease;
  z-index: 101;
  @media (max-width: 1025px) {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 101;
    height: 100%;
    background: var(--glass-bg-strong);
    -webkit-backdrop-filter: blur(30px) saturate(170%);
    backdrop-filter: blur(30px) saturate(170%);
  }
}

.el-aside {
  width: auto;
  transition: all 100ms ease;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.layout {
  height: 100%;
  position: fixed;
  width: 100%;
  top: 0;
  left: 0;
  overflow: hidden;
}

/* 玻璃背后的淡彩氛围光 */
.ambient {
  position: absolute;
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
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: linear-gradient(160deg, rgba(255, 255, 255, 0.12), transparent 40%, rgba(255, 255, 255, 0.04));
}

.main-container {
  position: absolute;
  inset: 0;
  z-index: 2;
  min-height: 100%;
  background: transparent;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.el-main {
  padding: 0;
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
</style>
