import { createI18n } from 'vue-i18n';

// 语言包按需加载：入口不再内置 zh/en 全量词条，首屏只拉取当前语言，
// 切换语言时再惰性加载另一种，减小入口体积、加快首屏。
const loaders = {
    zh: () => import('./zh.js'),
    en: () => import('./en.js'),
};

const loaded = new Set();

const i18n = createI18n({
    legacy: false,
    locale: 'zh',
    fallbackLocale: 'zh',
    messages: {},
});

/**
 * 加载并切换到目标语言（加载完成后才生效，避免词条缺失告警）。
 * @param {string} lang 'zh' | 'en'，其它值回退到 en
 * @returns {Promise<string>} 实际生效的语言
 */
export async function setLocale(lang) {
    const target = loaders[lang] ? lang : 'en';
    if (!loaded.has(target)) {
        const mod = await loaders[target]();
        i18n.global.setLocaleMessage(target, mod.default);
        loaded.add(target);
    }
    i18n.global.fallbackLocale.value = target;
    i18n.global.locale.value = target;
    return target;
}

export default i18n;
