import {useSettingStore} from "@/store/setting.js";
export function cvtR2Url(key) {

    if (!key) {
        return ''
    }

    if (key.startsWith('https://')) {
        return key
    }

    const { settings } = useSettingStore();

    let domain = settings.r2Domain

    if (!domain) {
        return key;
    }

    if (!domain.startsWith('http')) {
        return 'https://' + domain + '/' + key
    }

    if (domain.endsWith("/")) {
        domain = domain.slice(0, -1);
    }
    return domain + '/' + key
}

export function toOssDomain(domain) {

    if (!domain) {
        return ''
    }

    if (!domain.startsWith('http')) {
        return 'https://' + domain
    }

    if (domain.endsWith("/")) {
        domain = domain.slice(0, -1);
    }

    return domain
}

//RFC 3492 Punycode 解码参数
const PUNY_BASE = 36
const PUNY_TMIN = 1
const PUNY_TMAX = 26
const PUNY_SKEW = 38
const PUNY_DAMP = 700
const PUNY_INITIAL_BIAS = 72
const PUNY_INITIAL_N = 128

function punyAdapt(delta, pointCount, firstTime) {
    let k = 0
    delta = firstTime ? Math.floor(delta / PUNY_DAMP) : delta >> 1
    delta += Math.floor(delta / pointCount)
    for (; delta > ((PUNY_BASE - PUNY_TMIN) * PUNY_TMAX) >> 1; k += PUNY_BASE) {
        delta = Math.floor(delta / (PUNY_BASE - PUNY_TMIN))
    }
    return k + Math.floor(((PUNY_BASE - PUNY_TMIN + 1) * delta) / (delta + PUNY_SKEW))
}

function punyDigitToChar(codePoint) {
    if (codePoint - 48 < 10) return codePoint - 22
    if (codePoint - 65 < 26) return codePoint - 65
    if (codePoint - 97 < 26) return codePoint - 97
    return PUNY_BASE
}

/** 解码单个 xn-- 标签, 非法输入返回 null */
function decodePunyLabel(input) {
    const output = []
    let n = PUNY_INITIAL_N
    let i = 0
    let bias = PUNY_INITIAL_BIAS

    let basic = input.lastIndexOf('-')
    if (basic < 0) basic = 0

    for (let j = 0; j < basic; j++) {
        const c = input.charCodeAt(j)
        if (c >= 0x80) return null
        output.push(c)
    }

    let index = basic > 0 ? basic + 1 : 0
    while (index < input.length) {
        const oldi = i
        let w = 1
        for (let k = PUNY_BASE; ; k += PUNY_BASE) {
            if (index >= input.length) return null
            const digit = punyDigitToChar(input.charCodeAt(index++))
            if (digit >= PUNY_BASE) return null
            i += digit * w
            if (digit < (k <= bias ? PUNY_TMIN : k >= bias + PUNY_TMAX ? PUNY_TMAX : k - bias)) break
            w *= PUNY_BASE - (k <= bias ? PUNY_TMIN : k >= bias + PUNY_TMAX ? PUNY_TMAX : k - bias)
        }
        const pointCount = output.length + 1
        bias = punyAdapt(i - oldi, pointCount, oldi === 0)
        n += Math.floor(i / pointCount)
        i %= pointCount
        output.splice(i, 0, n)
        i++
    }

    try {
        return String.fromCodePoint(...output)
    } catch (e) {
        return null
    }
}

/**
 * 把域名中的 xn-- 标签还原为可读的 Unicode 形式, 仅用于展示。
 * 例: xn--gay-888f.us.ci -> 是gay.us.ci
 * 传入带 @ 的邮箱后缀时保留 @ 前缀; 非 punycode 域名原样返回。
 */
export function domainToUnicode(domain) {
    if (!domain) return domain

    const at = domain.lastIndexOf('@')
    const prefix = at >= 0 ? domain.slice(0, at + 1) : ''
    const host = at >= 0 ? domain.slice(at + 1) : domain

    if (!/xn--/i.test(host)) return domain

    const decoded = host.split('.').map(label => {
        if (!/^xn--/i.test(label)) return label
        return decodePunyLabel(label.slice(4)) || label
    }).join('.')

    return prefix + decoded
}
