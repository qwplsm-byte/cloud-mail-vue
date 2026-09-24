/**
 * 从一张壁纸的主色推导出一整套 Material 风格配色令牌。
 *
 * 这里不引入第三方色彩库: Material 的 tonal palette 本质是"同一色相下按明度分层,
 * 中性色带一点主色染色"。用 HSL 明度分层 + 中性色低饱和染色即可还原这个观感,
 * 同时对前景/背景显式做对比度择优, 保证文字一定可读。
 */

// Material 3 的基准种子色(官方默认紫), 取不到色时回退使用
export const DEFAULT_SEED = '#6750A4'

// 壁纸饱和度低于该值时视为灰度图, 直接用默认种子, 避免凭空造出一个颜色
const GRAY_THRESHOLD = 0.08

// 主色饱和度夹取的上下限, 保证取出的颜色既不太灰也不太刺眼
const CHROMA_MIN = 0.26
const CHROMA_MAX = 0.85

function clamp(value, min, max) {
	return Math.min(Math.max(value, min), max)
}

export function normalizeHex(hex) {

	const value = String(hex || '').trim().replace('#', '')

	if (/^[0-9a-fA-F]{3}$/.test(value)) {
		return '#' + value.split('').map(c => c + c).join('').toLowerCase()
	}

	if (/^[0-9a-fA-F]{6}$/.test(value)) {
		return '#' + value.toLowerCase()
	}

	return null
}

export function hexToRgb(hex) {

	const normalized = normalizeHex(hex)

	if (!normalized) {
		return null
	}

	const value = normalized.slice(1)

	return {
		r: parseInt(value.slice(0, 2), 16),
		g: parseInt(value.slice(2, 4), 16),
		b: parseInt(value.slice(4, 6), 16)
	}
}

export function rgbToHex(r, g, b) {
	const to = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')
	return '#' + to(r) + to(g) + to(b)
}

/** h: 0-360, s: 0-1, l: 0-1 */
export function rgbToHsl(r, g, b) {

	r /= 255
	g /= 255
	b /= 255

	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const l = (max + min) / 2
	const delta = max - min

	if (delta === 0) {
		return {h: 0, s: 0, l}
	}

	const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)

	let h
	if (max === r) {
		h = (g - b) / delta + (g < b ? 6 : 0)
	} else if (max === g) {
		h = (b - r) / delta + 2
	} else {
		h = (r - g) / delta + 4
	}

	return {h: h * 60, s, l}
}

export function hslToHex(h, s, l) {

	h = ((h % 360) + 360) % 360
	s = clamp(s, 0, 1)
	l = clamp(l, 0, 1)

	const c = (1 - Math.abs(2 * l - 1)) * s
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
	const m = l - c / 2

	let rgb
	if (h < 60) {
		rgb = [c, x, 0]
	} else if (h < 120) {
		rgb = [x, c, 0]
	} else if (h < 180) {
		rgb = [0, c, x]
	} else if (h < 240) {
		rgb = [0, x, c]
	} else if (h < 300) {
		rgb = [x, 0, c]
	} else {
		rgb = [c, 0, x]
	}

	return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255)
}

export function hsla(h, s, l, a) {
	return `hsla(${Math.round(((h % 360) + 360) % 360)}, ${Math.round(clamp(s, 0, 1) * 100)}%, ${Math.round(clamp(l, 0, 1) * 100)}%, ${a})`
}

/** WCAG 相对亮度, 用于明暗判定与对比度 */
export function relativeLuminance(r, g, b) {
	const channel = (v) => {
		v /= 255
		return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
	}
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function hexLuminance(hex) {

	const rgb = hexToRgb(hex)

	if (!rgb) {
		return 0
	}

	return relativeLuminance(rgb.r, rgb.g, rgb.b)
}

export function contrastRatio(a, b) {

	const la = hexLuminance(a)
	const lb = hexLuminance(b)

	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** 在一组候选色里挑和背景对比度最高的那个, 保证前景可读 */
function pickReadable(bg, candidates) {

	return candidates.reduce((best, current) => {
		return contrastRatio(bg, current) > contrastRatio(bg, best) ? current : best
	}, candidates[0])
}

export function isGraySeed(hex) {

	const rgb = hexToRgb(hex)

	if (!rgb) {
		return true
	}

	return rgbToHsl(rgb.r, rgb.g, rgb.b).s < GRAY_THRESHOLD
}

/**
 * 生成 android 主题用的一整套 CSS 变量。
 *
 * @param {string} seedHex 壁纸主色, 灰度色或非法值会自动回退到默认种子
 * @param {boolean} isDark 是否走深色 Material
 * @returns {Record<string, string>} CSS 变量名 -> 值
 */
export function buildAndroidTokens(seedHex, isDark) {

	const normalized = normalizeHex(seedHex)
	const seed = (!normalized || isGraySeed(normalized)) ? DEFAULT_SEED : normalized

	const seedRgb = hexToRgb(seed)
	const seedHsl = rgbToHsl(seedRgb.r, seedRgb.g, seedRgb.b)
	const h = seedHsl.h
	const c = clamp(seedHsl.s, CHROMA_MIN, CHROMA_MAX)

	// 同一色相下按明度分层, 饱和度的用量决定它是"主色"还是"被染色的中性色"
	const tone = (l, chromaRatio = 1) => hslToHex(h, c * chromaRatio, l)

	let primary, onPrimary, primaryContainer, onPrimaryContainer
	let secondary, secondaryContainer, onSecondaryContainer
	let surface, surfacePage, surfaceContainer, onSurface
	let surfaceVariant, onSurfaceVariant, outline, outlineVariant

	if (isDark) {
		primary = tone(0.78, 0.85)
		primaryContainer = tone(0.30, 0.85)
		onPrimaryContainer = tone(0.90, 0.42)
		secondary = tone(0.78, 0.35)
		secondaryContainer = tone(0.28, 0.35)
		onSecondaryContainer = tone(0.90, 0.30)
		surface = tone(0.085, 0.06)
		surfacePage = tone(0.055, 0.06)
		surfaceContainer = tone(0.14, 0.07)
		onSurface = tone(0.90, 0.05)
		surfaceVariant = tone(0.18, 0.08)
		onSurfaceVariant = tone(0.78, 0.08)
		outline = tone(0.58, 0.06)
		outlineVariant = tone(0.28, 0.08)
	} else {
		primary = tone(0.40)
		primaryContainer = tone(0.90, 0.5)
		onPrimaryContainer = tone(0.16)
		secondary = tone(0.38, 0.45)
		secondaryContainer = tone(0.90, 0.32)
		onSecondaryContainer = tone(0.18, 0.6)
		surface = tone(0.985, 0.06)
		surfacePage = tone(0.945, 0.08)
		surfaceContainer = tone(0.965, 0.07)
		onSurface = tone(0.11, 0.08)
		surfaceVariant = tone(0.925, 0.10)
		onSurfaceVariant = tone(0.30, 0.12)
		outline = tone(0.50, 0.10)
		outlineVariant = tone(0.80, 0.12)
	}

	onPrimary = pickReadable(primary, isDark ? [tone(0.16, 0.9), '#FFFFFF'] : ['#FFFFFF', tone(0.14, 0.9)])
	onSurface = pickReadable(surface, [onSurface, '#FFFFFF', '#000000'])

	const error = isDark ? '#F2B8B5' : '#B3261E'

	// Element Plus 需要主色的多档浅色, 用同色相不同明度近似
	const primaryLight = (l, ratio) => tone(l, ratio)

	return {
		/* —— Element Plus 主色阶梯 —— */
		'--el-color-primary': primary,
		'--el-color-primary-dark-2': isDark ? tone(0.70, 0.85) : tone(0.30),
		'--el-color-primary-light-3': isDark ? primaryLight(0.66, 0.8) : primaryLight(0.52, 0.95),
		'--el-color-primary-light-5': isDark ? primaryLight(0.56, 0.7) : primaryLight(0.62, 0.8),
		'--el-color-primary-light-7': isDark ? primaryLight(0.40, 0.6) : primaryLight(0.75, 0.6),
		'--el-color-primary-light-8': primaryContainer,
		'--el-color-primary-light-9': isDark ? tone(0.17, 0.5) : tone(0.95, 0.4),

		/* —— 背景与浮层 —— */
		'--el-bg-color': surface,
		'--el-bg-color-page': surfacePage,
		'--el-bg-color-overlay': surfaceContainer,

		/* —— 文字 —— */
		'--el-text-color-primary': onSurface,
		'--el-text-color-regular': onSurfaceVariant,
		'--el-text-color-secondary': onSurfaceVariant,
		'--el-text-color-placeholder': outline,
		'--el-text-color-disabled': outlineVariant,

		/* —— 边框与填充 —— */
		'--el-border-color': outlineVariant,
		'--el-border-color-light': outlineVariant,
		'--el-border-color-lighter': outlineVariant,
		'--el-border-color-extra-light': outlineVariant,
		'--el-border-color-dark': outline,
		'--el-border-color-darker': outline,
		'--el-fill-color': surfaceVariant,
		'--el-fill-color-light': surfaceVariant,
		'--el-fill-color-lighter': surfaceVariant,
		'--el-fill-color-extra-light': surfaceVariant,
		'--el-fill-color-dark': surfaceContainer,
		'--el-fill-color-darker': surfaceContainer,
		'--el-fill-color-blank': surface,
		'--el-mask-color': isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.35)',
		'--el-mask-color-extra-light': isDark ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.15)',
		'--el-color-error': error,
		'--el-color-error-light-9': isDark ? '#3a1a17' : '#fdecea',

		/* —— 侧边栏 —— */
		'--aside-backgound': surfaceVariant,
		'--aside-text': onSurfaceVariant,
		'--aside-text-active': primary,
		'--aside-menu-active-background': primaryContainer,
		'--aside-right-border': `3px 0 5px ${isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.16)'}`,

		/* —— 应用自定义令牌 —— */
		'--extra-light-fill': surface,
		'--settings-page-background': surfacePage,
		'--light-ill': surfaceVariant,
		'--light-border': outlineVariant,
		'--light-border-color': outlineVariant,
		'--base-fill': surfaceVariant,
		'--base-border-color': outlineVariant,
		'--dark-border': outlineVariant,
		'--regular-text-color': onSurfaceVariant,
		'--secondary-text-color': onSurfaceVariant,
		'--form-desc-color': onSurfaceVariant,
		'--scrollbar-track-color': outlineVariant,
		'--email-scroll-content-color': outline,
		'--email-hover-background': surfaceVariant,
		'--email-right-click-background': primaryContainer,
		'--choose-account-background': primaryContainer,
		'--message-block-color': 'rgba(0, 0, 0, 0)',
		'--login-border': 'none',
		'--login-switch-color': primary,
		'--loadding-background': isDark ? hsla(h, c * 0.1, 0.06, 0.8) : hsla(h, c * 0.1, 0.99, 0.8),
		'--header-actions-border': `inset 0 -1px 0 0 ${outlineVariant}`,

		/* —— 玻璃层: Material 更扁平, 提高不透明度、减少模糊 —— */
		'--glass-blur': '14px',
		'--glass-saturate': '125%',
		'--glass-bg': hsla(h, c * 0.12, isDark ? 0.13 : 0.97, 0.82),
		'--glass-bg-strong': hsla(h, c * 0.12, isDark ? 0.15 : 0.98, 0.94),
		'--glass-bg-soft': hsla(h, c * 0.12, isDark ? 0.11 : 0.95, 0.7),
		'--glass-border': outlineVariant,
		'--glass-border-strong': outline,
		'--glass-highlight': 'inset 0 1px 0 rgba(255, 255, 255, 0)',
		'--glass-shadow': isDark
			? '0 8px 24px -12px rgba(0, 0, 0, 0.7)'
			: '0 8px 24px -14px rgba(0, 0, 0, 0.28)',
		'--glass-shadow-soft': isDark
			? '0 4px 14px -8px rgba(0, 0, 0, 0.6)'
			: '0 4px 14px -8px rgba(0, 0, 0, 0.2)',

		/* —— 氛围光跟随壁纸主色 —— */
		'--ambient-1': tone(isDark ? 0.30 : 0.78, 0.7),
		'--ambient-2': secondaryContainer,
		'--ambient-3': tone(isDark ? 0.26 : 0.82, 0.5),
		'--ambient-4': secondary
	}
}
