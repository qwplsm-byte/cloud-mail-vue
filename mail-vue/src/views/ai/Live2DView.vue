<template>
  <div ref="hostRef" class="live2d-host">
    <!-- 画布由 pixi 挂到 host 上, 这里只叠一层加载/错误提示 -->
    <div v-if="status !== 'ready'" class="live2d-state">
      <template v-if="status === 'loading'">
        <span class="state-spinner"></span>
        <span class="state-text">{{ $t('aiLive2dLoading') }}</span>
      </template>
      <template v-else>
        <Icon icon="mdi:alert-circle-outline" :width="20" :height="20"/>
        <span class="state-text">{{ errorText }}</span>
      </template>
    </div>
  </div>
</template>

<script setup>
import {defineOptions, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {Icon} from "@iconify/vue";
import i18n from "@/i18n/index.js";

defineOptions({
  name: 'Live2DView'
})

const props = defineProps({
  url: {type: String, required: true},
  name: {type: String, default: ''},
})

const emit = defineEmits(['ready', 'error'])

const {t} = i18n.global

const hostRef = ref(null)
const status = ref('loading')
const errorText = ref('')

//pixi 体积较大, 只在真正展示 Live2D 时才异步加载
let pixiModule = null
let Live2DModel = null
let app = null
let model = null
let observer = null
let baseWidth = 1
let baseHeight = 1
let destroyed = false
let loadSeq = 0

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => reject(new Error('script load failed'))
    document.head.appendChild(el)
  })
}

//Cubism4 SDK 核心必须先于插件模块执行, 否则模块初始化会直接抛错
async function ensureRuntime() {
  if (!window.Live2DCubismCore) {
    await loadScript(import.meta.env.BASE_URL + 'live2d/live2dcubismcore.min.js')
  }
  if (!window.Live2DCubismCore) {
    throw new Error('Cubism4 runtime missing')
  }
  if (!pixiModule) {
    const pixi = await import('pixi.js')
    //插件内部部分能力(如 autoInteract)会从 window.PIXI 取 Ticker/InteractionManager
    window.PIXI = pixi
    const cubism4 = await import('pixi-live2d-display/cubism4')
    pixiModule = pixi
    Live2DModel = cubism4.Live2DModel
  }
}

function sizeOfHost() {
  const host = hostRef.value
  if (!host) return {w: 0, h: 0}
  return {w: host.clientWidth, h: host.clientHeight}
}

//半身视图: 顶对齐 + 按宽度铺满并向上放大, 超出面板的下半身自然裁掉
function fit() {
  if (!app || !model) return
  const {w, h} = sizeOfHost()
  if (!w || !h) return
  app.renderer.resize(w, h)
  const scale = Math.max((w / baseWidth) * 1.55, h / baseHeight)
  model.scale.set(scale)
  model.anchor.set(0.5, 0)
  model.x = w / 2
  model.y = 0
}

function cleanup() {
  if (observer) {
    observer.disconnect()
    observer = null
  }
  if (model && app) {
    try {
      app.stage.removeChild(model)
    } catch (e) {
    }
    try {
      model.destroy()
    } catch (e) {
    }
  }
  model = null
  if (app) {
    try {
      app.destroy(true)
    } catch (e) {
    }
    app = null
  }
}

async function mount() {
  const seq = ++loadSeq
  cleanup()
  status.value = 'loading'
  errorText.value = ''

  try {
    await ensureRuntime()
    if (destroyed || seq !== loadSeq) return

    const host = hostRef.value
    if (!host) return
    const {w, h} = sizeOfHost()
    if (!w || !h) throw new Error('empty container')

    const appInstance = new pixiModule.Application({
      width: w,
      height: h,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    })
    const view = appInstance.view
    view.style.display = 'block'
    view.style.width = '100%'
    view.style.height = '100%'
    host.appendChild(view)
    app = appInstance

    const live2d = await Live2DModel.from(props.url, {autoInteract: true})
    if (destroyed || seq !== loadSeq) {
      try {
        live2d.destroy()
      } catch (e) {
      }
      try {
        appInstance.destroy(true)
      } catch (e) {
      }
      if (app === appInstance) app = null
      return
    }

    app.stage.addChild(live2d)
    live2d.scale.set(1)
    baseWidth = Math.max(live2d.width, 1)
    baseHeight = Math.max(live2d.height, 1)
    model = live2d
    fit()

    if (hostRef.value && !observer) {
      observer = new ResizeObserver(() => fit())
      observer.observe(hostRef.value)
    }

    status.value = 'ready'
    emit('ready')
  } catch (e) {
    if (destroyed || seq !== loadSeq) return
    cleanup()
    status.value = 'error'
    errorText.value = t('aiLive2dLoadFail')
    emit('error', t('aiLive2dLoadFail'))
    console.warn('[live2d] load failed', props.url, e && (e.stack || e.message || String(e)))
  }
}

watch(() => props.url, () => {
  if (!destroyed) mount()
})

onMounted(() => {
  mount()
})

onBeforeUnmount(() => {
  destroyed = true
  loadSeq++
  cleanup()
})
</script>

<style scoped lang="scss">
.live2d-host {
  position: absolute;
  inset: 0;
  overflow: hidden;

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
}

.live2d-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
  text-align: center;
  color: var(--el-text-color-secondary);
  pointer-events: none;

  .state-text {
    font-size: 12px;
    line-height: 1.6;
    max-width: 88%;
    overflow-wrap: anywhere;
  }
}

.state-spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--el-color-primary-light-7);
  border-top-color: var(--el-color-primary);
  animation: live2d-spin .8s linear infinite;
}

@keyframes live2d-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
