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
import {loadLocalModelFiles} from "./live2dLocal.js";

defineOptions({
  name: 'Live2DView'
})

const props = defineProps({
  //远程模型地址(.model3.json / .model.json)
  url: {type: String, default: ''},
  //本地上传模型的 IndexedDB id, 与 url 二选一
  localId: {type: String, default: ''},
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
let idleTimer = null
let tapHandler = null

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
  if (!host) return {w: 0, h: 0}
  return {w: host.clientWidth, h: host.clientHeight}
}

//半身视图: 顶对齐 + 按宽度铺满并向上放大, 超出面板的下半身自然裁掉
function fit() {
  if (!app || !model) return
  const {w, h} = sizeOfHost()
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
function installModelHooks(live2d) {
  const core = live2d.internalModel && live2d.internalModel.coreModel
  if (import.meta.env.DEV) window.__modelCore = core
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
  const origin = core.update.bind(core)
  core.update = (...args) => {
    //表情开关要在生成网格之前写进参数
    applyStateValues()
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

//模型自带的表情大多是参数开关(值 0/1), 直接按参数读写最稳:
//记录每个状态影响哪些参数, 切换时先把状态用到的参数全部还原成默认值, 再写目标值,
//否则"默认体型/体型1/体型2"这类互斥档位会互相残留
let stateCore = null
let stateIds = []
let stateDefaults = {}
let stateMap = {}
let stateNames = []
let stateTimer = null
//当前生效的状态参数 [[参数id, 值], ...]; 每帧在生成网格前写进去
let activeState = []

async function loadStates(live2d) {
  const motionManager = live2d.internalModel && live2d.internalModel.motionManager
  const em = motionManager && motionManager.expressionManager
  const core = live2d.internalModel && live2d.internalModel.coreModel
  if (!em || !core) return
  stateCore = core
  const defs = em.definitions || []
  const ids = new Set()
  for (let i = 0; i < defs.length; i++) {
    try {
      const expression = await em.loadExpression(i)
      if (!expression || !expression._parameters) continue
      //服装/手势这类切换项不参与对话驱动, 免得聊两句衣服和体型就变了
      const params = expression._parameters.filter(item => !/^(Clothes|Movement|Lean)/i.test(String(item.parameterId || '')))
      if (!params.length) continue
      stateMap[defs[i].Name] = params.map(item => [item.parameterId, item.value, item.blendType])
      params.forEach(item => ids.add(item.parameterId))
    } catch (e) {
      //单个表情加载失败跳过
    }
  }
  stateNames = Object.keys(stateMap)
  stateIds = [...ids]
  stateIds.forEach(id => {
    try {
      stateDefaults[id] = core.getParameterValueById(id)
    } catch (e) {
      stateDefaults[id] = 0
    }
  })
}

//按名字模糊找状态: 精确匹配 > 包含匹配
function findState(name) {
  if (!name) return ''
  if (stateMap[name]) return name
  const hit = stateNames.find(key => key.includes(name) || name.includes(key))
  return hit || ''
}

function clearStates() {
  activeState = []
}

//把当前状态写进模型参数; 渲染器每帧末尾都会把参数恢复成存档值, 所以必须每帧重写
function applyStateValues() {
  if (!stateCore || !activeState.length) return
  for (const [id, value] of activeState) {
    try {
      stateCore.setParameterValueById(id, value)
    } catch (e) {
      //参数不存在时忽略
    }
  }
}

//切换状态: hold=true 时保持到下次切换, 否则过一会儿自动回到面无表情
function applyState(name, hold = false) {
  if (!stateCore) return false
  const key = findState(name)
  if (!key) return false
  activeState = stateMap[key].map(([id, value, blend]) => [
    id,
    //Add 混合在默认值上加, 其余按覆盖处理
    blend === 0 ? (stateDefaults[id] || 0) + value : value,
  ])
  if (stateTimer) {
    clearTimeout(stateTimer)
    stateTimer = null
  }
  if (!hold) {
    stateTimer = setTimeout(() => {
      stateTimer = null
      activeState = []
    }, 4200)
  }
  return true
}

//模型自带的全部状态都要用起来: 待机动作循环、点一下换动作和表情
function enableStates(live2d) {
  const motionManager = live2d.internalModel && live2d.internalModel.motionManager
  if (!motionManager) return
  const groups = Object.keys(motionManager.definitions || {})
  //待机组优先按名字找(IDLE/idle/待机), 找不到就退化成第一组
  const idleGroup = groups.find(group => /idle|待机|闲置/i.test(group)) || groups[0] || ''
  const actionGroups = groups.filter(group => group !== idleGroup)

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
    //点一下随机换个表情
    if (stateNames.length) {
      applyState(stateNames[Math.floor(Math.random() * stateNames.length)])
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
  if (stateTimer) {
    clearTimeout(stateTimer)
    stateTimer = null
  }
  stateCore = null
  stateIds = []
  stateDefaults = {}
  stateMap = {}
  stateNames = []
  activeState = []
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

    let source
    if (props.localId) {
      //本地上传: 还原成带相对路径的 File 列表, 插件会自动找设置文件并解析内部资源
      source = await loadLocalModelFiles(props.localId)
    } else if (props.url) {
      source = props.url
    } else {
      throw new Error('empty model source')
    }
    const live2d = await Live2DModel.from(source, {autoInteract: true})
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
    //状态按需加载, 不阻塞首帧
    loadStates(live2d).catch(() => {
    })

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
    const message = e && e.code === 'LOCAL_MISSING' ? t('aiLive2dLocalMissing') : t('aiLive2dLoadFail')
    errorText.value = message
    emit('error', message)
    console.warn('[live2d] load failed', props.localId || props.url, e && (e.stack || e.message || String(e)))
  }
}

watch(() => [props.url, props.localId], () => {
  if (!destroyed) mount()
})

//给页面用: react('加载') 保持到下次切换, react('爱心眼', false) 几秒后自动复原
defineExpose({
  react: (name) => applyState(name),
  hold: (name) => applyState(name, true),
  clear: () => clearStates(),
  hasState: (name) => !!findState(name),
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
