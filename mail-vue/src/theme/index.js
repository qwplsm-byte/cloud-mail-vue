import {useUiStore} from "@/store/ui.js";
import {useSettingStore} from "@/store/setting.js";
import {cvtR2Url} from "@/utils/convert.js";
import {
	DEFAULT_SEED,
	buildAndroidTokens,
	relativeLuminance,
	rgbToHex,
	rgbToHsl
} from "@/theme/material.js";

export const THEME_LIGHT = 'light'
export const THEME_DARK = 'dark'
export const THEME_AUTO = 'auto'
export const THEME_ANDROID = 'android'

export const THEME_VALUES = [THEME_LIGHT, THEME_DARK, THEME_AUTO, THEME_ANDROID]

// android 令牌注入用的 <style> 节点 id, 首屏由 index.html 复用同一 id
export const ANDROID_STYLE_ID = 'android-theme-tokens'

// 取色结果缓存: 记录 url/主色/明暗/生成的 css, 供刷新后首屏无闪烁还原
const CACHE_KEY = 'cm-android-theme'

// 采样边长: 足够小以保证取色速度, 足够大以避免取色偏差
const SAMPLE_SIZE = 48

// 判定为视频的扩展名, 视频无法直接读像素, 取色时回退默认种子
const VIDEO_RE = /\.(mp4|webm|ogv|ogg|mov|m4v|mkv)(\?|#|$)/i

const MOBILE_QUERY = '(pointer: fine) and (hover: hover)'

// 设备深色模式查询, auto 主题跟随它切换
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

function readUiStorage() {
	try {
		const raw = localStorage.getItem('ui')
		return raw ? JSON.parse(raw) : {}
	} catch (e) {
		return {}
	}
}

function writeUiStorage(data) {
	try {
		localStorage.setItem('ui', JSON.stringify(data))
	} catch (e) {
		// 隐私模式或超出配额时忽略
	}
}

function readCache() {
	try {
		const raw = localStorage.getItem(CACHE_KEY)
		return raw ? JSON.parse(raw) : null
	} catch (e) {
		return null
	}
}

function writeCache(data) {
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify(data))
	} catch (e) {
		// 隐私模式或超出配额时忽略, 不影响当前会话
	}
}

function isMobilePointer() {
	try {
		return !window.matchMedia(MOBILE_QUERY).matches
	} catch (e) {
		return false
	}
}

function prefersDark() {
	try {
		return window.matchMedia(SYSTEM_DARK_QUERY).matches
	} catch (e) {
		return false
	}
}

export function isImageUrl(url) {
	return !!url && !VIDEO_RE.test(url)
}

/** android 暗色需要同时叠加 dark 基线与 android 覆盖层 */
export function isDarkTheme(theme, androidDark, systemDark) {
	return theme === THEME_DARK
		|| (theme === THEME_ANDROID && androidDark === true)
		|| (theme === THEME_AUTO && systemDark === true)
}

/**
 * 读取持久化的主题状态。旧版本只有 dark 布尔值, 这里做一次兼容映射。
 */
export function resolveThemeState() {
	const ui = readUiStorage()
	let theme = ui.theme
	if (THEME_VALUES.indexOf(theme) === -1) {
		theme = ui.dark === true ? THEME_DARK : THEME_LIGHT
	}
	return {theme, androidDark: ui.androidDark === true}
}

export function readCachedAndroid() {
	const cache = readCache()
	if (!cache || !cache.seed) {
		return null
	}
	return {seed: cache.seed, dark: cache.dark === true}
}

/**
 * 把 android 令牌拼成一段样式文本。用 html.android 提升优先级以覆盖
 * Element Plus 的 :root 变量; --el-border-color 在 dark 基线里带 !important,
 * 这里必须同样提权才能覆盖。
 */
export function buildAndroidStyleText(tokens) {
	const lines = []
	for (const key in tokens) {
		const important = key === '--el-border-color' ? ' !important' : ''
		lines.push(`  ${key}: ${tokens[key]}${important};`)
	}
	return `html.android {\n${lines.join('\n')}\n}`
}

function injectAndroidTokens(tokens) {
	let styleEl = document.getElementById(ANDROID_STYLE_ID)
	if (!styleEl) {
		styleEl = document.createElement('style')
		styleEl.id = ANDROID_STYLE_ID
		document.head.appendChild(styleEl)
	}
	const text = buildAndroidStyleText(tokens)
	styleEl.textContent = text
	return text
}

function removeAndroidTokens() {
	const styleEl = document.getElementById(ANDROID_STYLE_ID)
	if (styleEl) {
		styleEl.remove()
	}
}

function updateThemeColorMeta(color) {
	const metaTag = document.getElementById('theme-color-meta')
	if (metaTag) {
		metaTag.setAttribute('content', color)
	}
}

function resolveThemeColor(theme, dark, tokens) {
	if (theme === THEME_ANDROID && tokens) {
		return tokens['--el-bg-color-page']
	}
	const mobile = isMobilePointer()
	return dark ? (mobile ? '#141414' : '#000000') : (mobile ? '#191A23' : '#F1F1F1')
}

/**
 * 把主题同步到 DOM: 根节点 class、color-scheme、theme-color 与 android 令牌。
 *
 * @param {{theme: string, androidDark: boolean, systemDark?: boolean, seed?: string}} state
 * @returns {{tokens: (Record<string, string>|null), css: (string|null), themeColor: string}}
 */
export function applyTheme(state) {
	const theme = THEME_VALUES.indexOf(state.theme) === -1 ? THEME_LIGHT : state.theme
	const dark = isDarkTheme(theme, state.androidDark, state.systemDark)
	const root = document.documentElement

	const classes = []
	if (dark) {
		classes.push('dark')
	}
	if (theme === THEME_ANDROID) {
		classes.push('android')
	}
	root.setAttribute('class', classes.join(' '))
	root.setAttribute('data-theme', theme)
	root.style.colorScheme = dark ? 'dark' : 'light'

	let tokens = null
	let css = null

	if (theme === THEME_ANDROID) {
		tokens = buildAndroidTokens(state.seed, dark)
		css = injectAndroidTokens(tokens)
	} else {
		removeAndroidTokens()
	}

	const themeColor = resolveThemeColor(theme, dark, tokens)
	updateThemeColorMeta(themeColor)

	return {tokens, css, themeColor}
}

function loadImage(url) {
	return new Promise((resolve, reject) => {
		const img = new Image()
		// R2/外链需要 CORS 才能读取像素; 同源图片带此属性也无副作用
		img.crossOrigin = 'anonymous'
		img.referrerPolicy = 'no-referrer'
		img.onload = () => resolve(img)
		img.onerror = () => reject(new Error('image load failed'))
		img.src = url
	})
}

/**
 * 统计像素得到主色与整体明暗。按颜色分桶后加权: 出现次数高且饱和度高的桶胜出,
 * 避免选中大片灰白/纯黑背景。
 */
function analyzePixels(data) {
	const buckets = new Map()
	let lumSum = 0
	let count = 0

	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] < 125) {
			continue
		}
		const r = data[i]
		const g = data[i + 1]
		const b = data[i + 2]

		lumSum += relativeLuminance(r, g, b)
		count++

		// 每通道压到 4bit, 相近颜色归入同一个桶
		const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
		let bucket = buckets.get(key)
		if (!bucket) {
			bucket = {r: 0, g: 0, b: 0, n: 0}
			buckets.set(key, bucket)
		}
		bucket.r += r
		bucket.g += g
		bucket.b += b
		bucket.n++
	}

	if (!count) {
		return null
	}

	let best = null
	let bestScore = -1
	buckets.forEach(bucket => {
		const r = bucket.r / bucket.n
		const g = bucket.g / bucket.n
		const b = bucket.b / bucket.n
		const hsl = rgbToHsl(r, g, b)
		const score = bucket.n * (0.25 + hsl.s) * (1 - Math.abs(hsl.l - 0.5) * 0.6)
		if (score > bestScore) {
			bestScore = score
			best = {r, g, b}
		}
	})

	return {
		seed: rgbToHex(best.r, best.g, best.b),
		dark: lumSum / count < 0.45
	}
}

/** 从图片取主色, 跨域受限或加载失败时抛错, 由调用方回退 */
export async function extractSeedFromImage(url) {
	const img = await loadImage(url)
	const canvas = document.createElement('canvas')
	canvas.width = SAMPLE_SIZE
	canvas.height = SAMPLE_SIZE
	const ctx = canvas.getContext('2d', {willReadFrequently: true})
	ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
	// 跨域图片未返回 CORS 头时, 这一步会抛安全错误
	const {data} = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
	return analyzePixels(data)
}

export function resolveWallpaperUrl(layoutBackground) {
	if (!layoutBackground) {
		return ''
	}
	const url = cvtR2Url(layoutBackground)
	if (!url || url === 'https://') {
		return ''
	}
	return url.startsWith('http') ? url : '/' + url.replace(/^\/+/, '')
}

async function extractAndroidPalette(url, preferDark) {
	const cache = readCache()
	if (cache && cache.seed && cache.url === (url || '')) {
		return {seed: cache.seed, dark: cache.dark === true}
	}

	let result = null
	if (isImageUrl(url)) {
		try {
			result = await extractSeedFromImage(url)
		} catch (e) {
			// 外链图片没有 CORS 头时读不到像素, 走默认种子
			result = null
		}
	}

	if (!result) {
		result = {
			seed: DEFAULT_SEED,
			dark: preferDark === true || prefersDark()
		}
	}

	return result
}

/** 首屏同步应用持久化的主题, 数据未就绪时 android 复用上次缓存的主色 */
export function bootstrapTheme() {
	const raw = readUiStorage()

	// 旧版本只存了 dark 布尔值。这里先迁移为 theme 并移除旧字段,
	// 否则 pinia 会把它回填到同名的只读 getter 上。
	if (THEME_VALUES.indexOf(raw.theme) === -1 && typeof raw.dark === 'boolean') {
		raw.theme = raw.dark ? THEME_DARK : THEME_LIGHT
		delete raw.dark
		writeUiStorage(raw)
	}

	const ui = useUiStore()

	if (THEME_VALUES.indexOf(ui.theme) === -1) {
		ui.theme = THEME_LIGHT
	}

	let seed = null
	if (ui.theme === THEME_ANDROID) {
		const cached = readCachedAndroid()
		seed = cached ? cached.seed : DEFAULT_SEED
	}

	// auto 主题首屏就要按设备明暗上色, 这里补一次真实值, 避免沿用默认的浅色
	ui.systemDark = prefersDark()

	applyTheme({theme: ui.theme, androidDark: ui.androidDark, systemDark: ui.systemDark, seed})
}

/**
 * 监听设备深浅色变化。auto 主题据此实时切换, 其它主题只更新状态备用。
 * 需在 bootstrapTheme 之后调用一次。
 */
export function watchSystemTheme() {
	const ui = useUiStore()
	const query = window.matchMedia(SYSTEM_DARK_QUERY)

	const sync = () => {
		ui.systemDark = query.matches
		// android 的明暗由壁纸主色决定, 与设备设置无关, 无需重绘
		if (ui.theme === THEME_AUTO) {
			refreshTheme()
		}
	}

	query.addEventListener('change', sync)
	sync()
}

/**
 * 按当前主题与主界面壁纸刷新配色。android 主题会从壁纸取主色, 并据此自动
 * 决定走浅色还是深色 Material; 取色失败或壁纸为视频时回退默认种子。
 * auto 主题则跟随设备深浅色。
 */
export async function refreshTheme() {
	const ui = useUiStore()
	const setting = useSettingStore()
	const theme = ui.theme

	if (theme !== THEME_ANDROID) {
		applyTheme({theme, androidDark: false, systemDark: ui.systemDark, seed: null})
		return null
	}

	const url = resolveWallpaperUrl(setting.settings.layoutBackground)
	const result = await extractAndroidPalette(url, ui.androidDark)

	// 取色期间用户可能已切走主题, 丢弃这次结果
	if (ui.theme !== theme) {
		return result
	}

	const applied = applyTheme({theme, androidDark: result.dark, seed: result.seed})

	if (ui.androidDark !== result.dark) {
		ui.androidDark = result.dark
	}

	writeCache({
		url: url || '',
		seed: result.seed,
		dark: result.dark,
		css: applied.css,
		themeColor: applied.themeColor
	})

	return result
}