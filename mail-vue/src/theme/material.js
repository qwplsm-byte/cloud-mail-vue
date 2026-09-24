/**
 * 从一张壁纸的主色推导出一整套 Material 3 风格的配色令牌。
 *
 * 这里不引入第三方色彩库, 但也不再用 HSL 明度分层近似 —— HSL 的明度在各个色相下
 * 的视觉亮度并不一致(同一个 l 值, 黄色显得很亮、蓝色显得很暗), 直接分层会让
 * 整套配色发浊。Material 3 的 tonal palette 本质是 CIELAB 的 L*(tone) 分层:
 * 固定色相, 用感知亮度定层级, 用色度(chroma)区分"强调色"与"中性表面"。
 * 因此这里实现一对轻量的 Lab/LCh 转换, 用 L* 作为 tone, 并对超出 sRGB 色域的
 * 色度做衰减裁剪(保持色相, 只降饱和), 从而得到干净、不发灰的色阶。
 */

// Material 3 的基准种子色(官方默认紫), 取不到色时回退使用
export const DEFAULT_SEED = '#6750A4'

// 壁纸饱和度低于该值时视为灰度图, 直接用默认种子, 避免凭空造出一个颜色
const GRAY_THRESHOLD = 0.08

// 强调色色度的上下限(LCh 尺度): 低于下限会显得灰, 高于上限在 sRGB 里站不住
const ACCENT_CHROMA_MIN = 32
const ACCENT_CHROMA_MAX = 72

// 中性色的色度 —— Material 3 的中性表面只带极淡的染色, 这是"干净高级"的关键
const NEUTRAL_CHROMA = 4
const NEUTRAL_VARIANT_CHROMA = 8

// D65 白点
const WHITE_X = 0.95047
const WHITE_Y = 1.0
const WHITE_Z = 1.08883

const DELTA = 6 / 29

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

/* ===================== LCh(ab) <-> sRGB ===================== */

const srgbToLinear = (v) => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
const linearToSrgb = (v) => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055

/**
 * sRGB -> LCh(ab)。
 * @returns {{L: number, C: number, h: number}} L: 0-100, C: 色度, h: 色相角 0-360
 */
export function hexToLch(hex) {

	const rgb = hexToRgb(hex)

	if (!rgb) {
		return {L: 0, C: 0, h: 0}
	}

	const r = srgbToLinear(rgb.r / 255)
	const g = srgbToLinear(rgb.g / 255)
	const b = srgbToLinear(rgb.b / 255)

	const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / WHITE_X
	const y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / WHITE_Y
	const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / WHITE_Z

	const f = (t) => t > DELTA * DELTA * DELTA ? Math.cbrt(t) : t / (3 * DELTA * DELTA) + 4 / 29

	const fx = f(x)
	const fy = f(y)
	const fz = f(z)

	const L = 116 * fy - 16
	const a = 500 * (fx - fy)
	const bb = 200 * (fy - fz)

	return {
		L,
		C: Math.sqrt(a * a + bb * bb),
		h: ((Math.atan2(bb, a) * 180 / Math.PI) % 360 + 360) % 360
	}
}

/**
 * LCh(ab) -> sRGB。超出 sRGB 色域时返回 null, 由调用方衰减色度重试,
 * 这样色相保持不变、只降饱和, 不会像直接裁剪通道那样偏色。
 */
function lchToHexRaw(L, C, h) {

	const hRad = h * Math.PI / 180
	const a = C * Math.cos(hRad)
	const b = C * Math.sin(hRad)

	const fy = (L + 16) / 116
	const fx = fy + a / 500
	const fz = fy - b / 200

	const fInv = (t) => t > DELTA ? t * t * t : 3 * DELTA * DELTA * (t - 4 / 29)

	const x = WHITE_X * fInv(fx)
	const y = WHITE_Y * fInv(fy)
	const z = WHITE_Z * fInv(fz)

	const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z
	const g = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z
	const bl = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z

	// 任一线性通道越界即视为超出色域, 交给外层降 chroma
	if (r < -0.001 || r > 1.001 || g < -0.001 || g > 1.001 || bl < -0.001 || bl > 1.001) {
		return null
	}

	return rgbToHex(
		linearToSrgb(clamp(r, 0, 1)) * 255,
		linearToSrgb(clamp(g, 0, 1)) * 255,
		linearToSrgb(clamp(bl, 0, 1)) * 255
	)
}

/**
 * 按 L*(tone) 与色度取一个色相固定的颜色。
 *
 * @param {number} L 感知亮度 tone, 0-100
 * @param {number} C 色度, 0 为纯灰
 * @param {number} h 色相角 0-360
 */
export function toneToHex(L, C, h) {

	let chroma = Math.max(C, 0)

	for (let i = 0; i < 12; i++) {
		const hex = lchToHexRaw(L, chroma, h)
		if (hex) {
			return hex
		}
		chroma *= 0.88
		if (chroma < 0.4) {
			break
		}
	}

	return lchToHexRaw(L, 0, h) || rgbToHex(128, 128, 128)
}

/**
 * 生成 android(类原生/Material You) 主题用的一整套 CSS 变量。
 *
 * 色阶取自 Material 3 的标准 tone 值, 并额外产出 surfaceContainer 阶梯与
 * 一组 --android-* 结构令牌, 供 style.css 的纯色扁平结构层使用。
 *
 * @param {string} seedHex 壁纸主色, 灰度色或非法值会自动回退到默认种子
 * @param {boolean} isDark 是否走深色 Material
 * @returns {Record<string, string>} CSS 变量名 -> 值
 */
export function buildAndroidTokens(seedHex, isDark) {

	const normalized = normalizeHex(seedHex)
	const seed = (!normalized || isGraySeed(normalized)) ? DEFAULT_SEED : normalized

	const seedLch = hexToLch(seed)
	const hue = seedLch.h
	const accent = clamp(seedLch.C, ACCENT_CHROMA_MIN, ACCENT_CHROMA_MAX)

	// tone(L, C): 固定色相, 按感知亮度与色度取色
	const tone = (L, C) => toneToHex(L, C, hue)
	// 中性色: 只带极淡染色
	const neutral = (L) => tone(L, NEUTRAL_CHROMA)
	// 中性变体: 比中性色略多一点的染色, 用于描边/次级容器
	const variant = (L) => tone(L, NEUTRAL_VARIANT_CHROMA)

	let primary, primaryContainer, onPrimaryContainer
	let secondary, secondaryContainer, onSecondaryContainer
	let surface, surfaceLow, surfaceContainer, surfaceHigh, surfaceHighest, surfaceLowest
	let onSurface, onSurfaceVariant, outline, outlineVariant

	if (isDark) {
		primary = tone(80, accent)
		primaryContainer = tone(30, accent * 0.85)
		onPrimaryContainer = tone(90, accent * 0.45)
		secondary = tone(80, accent * 0.42)
		secondaryContainer = tone(30, accent * 0.42)
		onSecondaryContainer = tone(90, accent * 0.35)

		surfaceLowest = neutral(4)
		surface = neutral(6)
		surfaceLow = neutral(10)
		surfaceContainer = neutral(12)
		surfaceHigh = neutral(17)
		surfaceHighest = neutral(22)
		onSurface = tone(90, NEUTRAL_CHROMA)
		onSurfaceVariant = variant(80)
		outline = tone(60, NEUTRAL_CHROMA)
		outlineVariant = variant(30)
	} else {
		primary = tone(40, accent)
		primaryContainer = tone(90, accent * 0.42)
		onPrimaryContainer = tone(10, accent * 0.35)
		secondary = tone(40, accent * 0.42)
		secondaryContainer = tone(90, accent * 0.30)
		onSecondaryContainer = tone(10, accent * 0.35)

		surfaceLowest = neutral(100)
		surface = neutral(98)
		surfaceLow = neutral(96)
		surfaceContainer = neutral(94)
		surfaceHigh = neutral(92)
		surfaceHighest = neutral(90)
		onSurface = tone(10, NEUTRAL_CHROMA)
		onSurfaceVariant = variant(30)
		outline = tone(50, NEUTRAL_CHROMA)
		outlineVariant = variant(80)
	}

	const onPrimary = pickReadable(primary, isDark ? [tone(20, accent * 0.6), '#000000'] : ['#FFFFFF', tone(100, 0)])
	const onSecondary = pickReadable(secondary, isDark ? [tone(20, accent * 0.4), '#000000'] : ['#FFFFFF', tone(100, 0)])
	// 正文字色优先用 tonal 值(tone 10/90), 纯黑/纯白只在对比度不足时才兜底 ——
	// 直接上 #000 会显得生硬, 不够 Material。
	const onSurfaceSafe = contrastRatio(surface, onSurface) >= 4.5
		? onSurface
		: pickReadable(surface, [onSurface, '#FFFFFF', '#000000'])

	const error = isDark ? tone(80, 55) : tone(40, 55)

	// Element Plus 需要主色的多档变体, 这里直接给同色相的 L* 阶梯, 而不是混白
	const ramp = (L, ratio) => tone(L, accent * ratio)

	return {
		/* —— Element Plus 主色阶梯 —— */
		'--el-color-primary': primary,
		'--el-color-primary-dark-2': isDark ? ramp(70, 1) : ramp(30, 1),
		'--el-color-primary-light-3': isDark ? ramp(68, 0.95) : ramp(52, 1),
		'--el-color-primary-light-5': isDark ? ramp(56, 0.8) : ramp(62, 0.85),
		'--el-color-primary-light-7': isDark ? ramp(40, 0.6) : ramp(74, 0.6),
		'--el-color-primary-light-8': primaryContainer,
		'--el-color-primary-light-9': isDark ? ramp(20, 0.35) : ramp(94, 0.22),

		/* —— 背景与浮层 —— */
		'--el-bg-color': surface,
		'--el-bg-color-page': isDark ? surfaceLowest : surfaceLow,
		'--el-bg-color-overlay': surfaceHigh,

		/* —— 文字 —— */
		'--el-text-color-primary': onSurfaceSafe,
		'--el-text-color-regular': onSurfaceVariant,
		'--el-text-color-secondary': onSurfaceVariant,
		'--el-text-color-placeholder': outline,
		'--el-text-color-disabled': outlineVariant,

		/* —— 边框与填充: 类原生靠表面层级区分, 描边只做极淡的分隔 —— */
		'--el-border-color': outlineVariant,
		'--el-border-color-light': outlineVariant,
		'--el-border-color-lighter': outlineVariant,
		'--el-border-color-extra-light': outlineVariant,
		'--el-border-color-dark': outline,
		'--el-border-color-darker': outline,
		'--el-fill-color': surfaceHigh,
		'--el-fill-color-light': surfaceHigh,
		'--el-fill-color-lighter': surfaceContainer,
		'--el-fill-color-extra-light': surfaceContainer,
		'--el-fill-color-dark': surfaceHighest,
		'--el-fill-color-darker': surfaceHighest,
		'--el-fill-color-blank': surface,
		'--el-mask-color': isDark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.32)',
		'--el-mask-color-extra-light': isDark ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.12)',
		'--el-color-error': error,
		'--el-color-error-light-9': isDark ? tone(20, 40) : tone(94, 20),

		/* —— 侧边栏 —— */
		'--aside-backgound': surfaceLow,
		'--aside-text': onSurfaceVariant,
		'--aside-text-active': onSecondaryContainer,
		'--aside-menu-active-background': secondaryContainer,
		'--aside-right-border': 'none',

		/* —— 应用自定义令牌 —— */
		'--extra-light-fill': surfaceLow,
		'--settings-page-background': isDark ? surfaceLowest : surfaceLow,
		'--light-ill': surfaceContainer,
		'--light-border': outlineVariant,
		'--light-border-color': outlineVariant,
		'--base-fill': surfaceHigh,
		'--base-border-color': outlineVariant,
		'--dark-border': outline,
		'--regular-text-color': onSurfaceVariant,
		'--secondary-text-color': onSurfaceVariant,
		'--form-desc-color': onSurfaceVariant,
		'--scrollbar-track-color': outlineVariant,
		'--email-scroll-content-color': outline,
		'--email-hover-background': surfaceHigh,
		'--email-right-click-background': secondaryContainer,
		'--choose-account-background': secondaryContainer,
		'--message-block-color': 'rgba(0, 0, 0, 0)',
		'--login-border': 'none',
		'--login-switch-color': primary,
		'--loadding-background': surface,
		'--header-actions-border': `inset 0 -1px 0 0 ${outlineVariant}`,

		/* —— 玻璃层令牌: 在 android 下全部塌陷为不透明纯色, 彻底去掉模糊 —— */
		'--glass-blur': '0px',
		'--glass-saturate': '100%',
		'--glass-bg': surfaceLow,
		'--glass-bg-strong': surfaceContainer,
		'--glass-bg-soft': surfaceContainer,
		'--glass-border': outlineVariant,
		'--glass-border-strong': outline,
		'--glass-highlight': 'inset 0 0 0 0 rgba(0, 0, 0, 0)',
		'--glass-shadow': isDark
			? '0 1px 2px rgba(0, 0, 0, 0.5), 0 6px 20px -10px rgba(0, 0, 0, 0.6)'
			: '0 1px 2px rgba(0, 0, 0, 0.06), 0 6px 20px -12px rgba(0, 0, 0, 0.18)',
		'--glass-shadow-soft': isDark
			? '0 1px 2px rgba(0, 0, 0, 0.45)'
			: '0 1px 2px rgba(0, 0, 0, 0.05)',

		/* —— 氛围光: 类原生界面不需要, 直接熄灭 —— */
		'--ambient-1': 'transparent',
		'--ambient-2': 'transparent',
		'--ambient-3': 'transparent',
		'--ambient-4': 'transparent',

		/* —— 供结构层直接使用的表面阶梯与强调色 —— */
		'--android-surface': surface,
		'--android-surface-low': surfaceLow,
		'--android-surface-container': surfaceContainer,
		'--android-surface-high': surfaceHigh,
		'--android-surface-highest': surfaceHighest,
		'--android-surface-lowest': surfaceLowest,
		'--android-primary': primary,
		'--android-on-primary': onPrimary,
		'--android-primary-container': primaryContainer,
		'--android-on-primary-container': onPrimaryContainer,
		'--android-secondary': secondary,
		'--android-on-secondary': onSecondary,
		'--android-secondary-container': secondaryContainer,
		'--android-on-secondary-container': onSecondaryContainer,
		'--android-on-surface': onSurfaceSafe,
		'--android-on-surface-variant': onSurfaceVariant,
		'--android-outline': outline,
		'--android-outline-variant': outlineVariant
	}
}