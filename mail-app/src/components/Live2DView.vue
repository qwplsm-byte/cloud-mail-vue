<template>
  <div ref="hostRef" class="live2d-host">
    <!-- 画布由 pixi 挂到 host 上, 这里只叠一层加载/错误提示 -->
    <div v-if="status !== 'ready'" class="live2d-state">
      <template v-if="status === 'loading'">
        <span class="state-spinner"></span>
        <span class="state-text">形象加载中…</span>
      </template>
      <template v-else>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"/>
          <path d="M12 8v5M12 16h.01"/>
        </svg>
        <span class="state-text">{{ errorText }}</span>
      </template>
    </div>
  </div>
</template>

<script setup>
import { defineOptions, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { loadLocalModelFiles } from '../utils/live2dLocal.js'

defineOptions({
  name: 'Live2DView'
})

const props = defineProps({
  //远程模型地址(.model3.json / .model.json)
  url: { type: String, default: '' },
  //本地上传模型的 IndexedDB id, 与 url 二选一
  localId: { type: String, default: '' }
})

const emit = defineEmits(['ready', 'error'])

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
let idleTimer = null
let expressionTimer = null
let tapHandler = null
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

//Cubism2.1 与 Cubism3/4 两套核心都要先于插件模块执行:
//插件总包在模块初始化阶段会同时检查 window.Live2D 与 window.Live2DCubismCore
async function ensureRuntime() {
  if (!window.Live2D) {
    await loadScript(import.meta.env.BASE_URL + 'live2d/live2d.min.js')
  }
  if (!window.Live2DCubismCore) {
    await loadScript(import.meta.env.BASE_URL + 'live2d/live2dcubismcore.min.js')
  }
  if (!window.Live2D || !window.Live2DCubismCore) {
    throw new Error('Live2D runtime missing')
  }
  if (!pixiModule) {
    const pixi = await import('pixi.js')
    //插件内部部分能力(如 autoInteract)会从 window.PIXI 取 Ticker/InteractionManager
    window.PIXI = pixi
    //总包同时支持 Cubism 2.1 与 Cubism 3/4, 具体版本由模型设置文件自动判断
    const live2dModule = await import('pixi-live2d-display')
    pixiModule = pixi
    Live2DModel = live2dModule.Live2DModel
  }
}

function sizeOfHost() {
  const host = hostRef.value
  if (!host) return { w: 0, h: 0 }
  return { w: host.clientWidth, h: host.clientHeight }
}

//半身视图: 顶对齐 + 按宽度铺满并向上放大, 超出面板的下半身自然裁掉
function fit() {
  if (!app || !model) return
  const { w, h } = sizeOfHost()
  if (!w || !h) return
  app.renderer.resize(w, h)
  //半身取景: 先保证铺满宽度, 再限制放大倍数, 避免窄栏里只剩头顶
  const scale = Math.max(w / baseWidth, Math.min((h / baseHeight) * 1.25, (w / baseWidth) * 2.2))
  model.scale.set(scale)
  model.anchor.set(0.5, 0)
  model.x = w / 2
  model.y = 0
}

//Cubism 5 给每个网格加了"乘色/屏色"(multiplyColor/screenColor), 这套渲染器还没有实现:
//这类网格原本靠贴图 alpha 叠一层白色高光, 直接按原贴图绘制就会露出一整块黑(或白)色块,
//最常见的就是鼻子上那个黑方块。定位到这类网格后, 把承载它们的部件整个隐藏。
//同时表情参数需要在这里补写一次(渲染器自身没有把表情应用到模型上)。
function installModelHooks(live2d) {
  const core = live2d.internalModel && live2d.internalModel.coreModel
  const raw = core && core._model && core._model.drawables
  const parts = new Set()
  if (raw && raw.multiplyColors && raw.screenColors && raw.parentPartIndices) {
    const count = core.getDrawableCount()
    for (let i = 0; i < count; i++) {
      const part = raw.parentPartIndices[i]
      if (part < 0) continue
      const mi = i * 4
      //黑乘色 + 接近白色的屏色, 说明这块贴图只是拿来当遮罩用的
      const dark = raw.multiplyColors[mi] < 0.05 && raw.multiplyColors[mi + 1] < 0.05 && raw.multiplyColors[mi + 2] < 0.05
      const bright = raw.screenColors[mi] > 0.9 && raw.screenColors[mi + 1] > 0.9 && raw.screenColors[mi + 2] > 0.9
      if (dark && bright) parts.add(part)
    }
  }
  const expressionManager = live2d.internalModel && live2d.internalModel.motionManager
    ? live2d.internalModel.motionManager.expressionManager
    : null
  const origin = core.update.bind(core)
  core.update = (...args) => {
    //表情要在生成网格之前写进参数, 否则切换表情不会生效
    if (expressionManager) {
      try {
        expressionManager.update(core, performance.now() / 1000)
      } catch (e) {
        //表情更新失败忽略
      }
    }
    origin(...args)
    for (const part of parts) {
      try {
        core.setPartOpacityByIndex(part, 0)
      } catch (e) {
        //忽略越界部件
      }
    }
  }
}

//模型自带的全部状态都要用起来: 待机动作循环、表情轮流切换、点一下换动作和表情
function enableStates(live2d) {
  const motionManager = live2d.internalModel && live2d.internalModel.motionManager
  if (!motionManager) return
  const groups = Object.keys(motionManager.definitions || {})
  //待机组优先按名字找(IDLE/idle/待机), 找不到就退化成第一组
  const idleGroup = groups.find(group => /idle|待机|闲置/i.test(group)) || groups[0] || ''
  const actionGroups = groups.filter(group => group !== idleGroup)
  const expressions = motionManager.expressionManager
  const hasExpression = expressions && expressions.definitions && expressions.definitions.length

  const loopIdle = async () => {
    if (destroyed || model !== live2d) return
    if (idleGroup) {
      try {
        await motionManager.startRandomMotion(idleGroup, 1)
      } catch (e) {
        //动作播放失败不影响展示
      }
    }
    if (destroyed || model !== live2d) return
    idleTimer = setTimeout(loopIdle, 1200)
  }
  loopIdle()

  //表情按间隔随机轮换, 让各种状态都出现
  const switchExpression = async () => {
    if (destroyed || model !== live2d) return
    if (hasExpression) {
      try {
        await expressions.setRandomExpression()
      } catch (e) {
        //表情切换失败忽略
      }
    }
    if (destroyed || model !== live2d) return
    expressionTimer = setTimeout(switchExpression, 8000 + Math.random() * 6000)
  }
  if (hasExpression) expressionTimer = setTimeout(switchExpression, 3000)

  const onTap = () => {
    if (destroyed || model !== live2d) return
    if (actionGroups.length) {
      const group = actionGroups[Math.floor(Math.random() * actionGroups.length)]
      try {
        motionManager.startRandomMotion(group, 2)
      } catch (e) {
        //忽略播放失败
      }
    }
    if (hasExpression) {
      try {
        expressions.setRandomExpression()
      } catch (e) {
        //忽略切换失败
      }
    }
  }
  if (app && app.view) {
    tapHandler = onTap
    app.view.addEventListener('pointerdown', tapHandler)
  }
}

function cleanup() {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (expressionTimer) {
    clearTimeout(expressionTimer)
    expressionTimer = null
  }
  if (app && app.view && tapHandler) {
    app.view.removeEventListener('pointerdown', tapHandler)
    tapHandler = null
  }
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
    const { w, h } = sizeOfHost()
    if (!w || !h) throw new Error('empty container')

    const appInstance = new pixiModule.Application({
      width: w,
      height: h,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2)
    })
    const view = appInstance.view
    view.style.display = 'block'
    view.style.width = '100%'
    view.style.height = '100%'
    host.appendChild(view)
    app = appInstance

    let source
    if (props.localId) {
      //本地上传: 还原成带相对路径的 File 列表, 插件会自动找设置文件并解析内部资源
      source = await loadLocalModelFiles(props.localId)
    } else if (props.url) {
      source = props.url
    } else {
      throw new Error('empty model source')
    }
    const live2d = await Live2DModel.from(source, { autoInteract: true })
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

    installModelHooks(live2d)
    enableStates(live2d)

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
    errorText.value = e && e.code === 'LOCAL_MISSING'
      ? '本地模型数据已丢失，请重新上传'
      : '形象加载失败，请检查模型文件或地址'
    emit('error', errorText.value)
    console.warn('[live2d] load failed', props.localId || props.url, e && (e.stack || e.message || String(e)))
  }
}

watch(() => [props.url, props.localId], () => {
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

<style scoped>
.live2d-host {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.live2d-host canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.live2d-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 12px;
  text-align: center;
  color: var(--sec);
  pointer-events: none;
}

.live2d-state svg {
  width: 20px;
  height: 20px;
}

.state-text {
  font-size: 11px;
  line-height: 1.6;
  max-width: 92%;
  overflow-wrap: anywhere;
}

.state-spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--line);
  border-top-color: var(--blue);
  animation: live2d-spin .8s linear infinite;
}

@keyframes live2d-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
