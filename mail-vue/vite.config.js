import {defineConfig, loadEnv} from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import {ElementPlusResolver} from 'unplugin-vue-components/resolvers'
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
    const env = loadEnv(mode, process.cwd(), 'VITE')
    return {
        server: {
            host: true,
            port: 3001,
            hmr: true,
        },
        base: env.VITE_STATIC_URL || '/',
        plugins: [vue(),
            VitePWA({
                injectRegister: 'script-defer',
                manifest: {
                    name: env.VITE_PWA_NAME,
                    short_name: env.VITE_PWA_NAME,
                    background_color: '#FFFFFF',
                    theme_color: '#FFFFFF',
                    icons: [
                        {
                            src: 'mail-pwa.png',
                            sizes: '192x192',
                            type: 'image/png',
                        }
                    ],
                },
                workbox: {
                    disableDevLogs: true,
                    globPatterns: [],
                    runtimeCaching: [],
                    navigateFallback: null,
                    cleanupOutdatedCaches: true,
                }
            }),
            AutoImport({
                resolvers: [ElementPlusResolver()],
            }),
            Components({
                resolvers: [ElementPlusResolver()],
            })
        ],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, 'src')
            }
        },
        build: {
            target: 'es2022',
            outDir: env.VITE_OUT_DIR || 'dist',
            emptyOutDir: true,
            assetsInclude: ['**/*.json'],
            rollupOptions: {
                output: {
                    // 把长期不变的大依赖拆成独立 chunk，缩小入口体积并提升跨版本缓存复用。
                    // 注意：element-plus 走 unplugin 按需引入，保持其 el-* 细粒度分包，不在此合并。
                    manualChunks(id) {
                        if (!id.includes('node_modules')) return
                        if (id.includes('echarts') || id.includes('zrender')) return 'vendor-echarts'
                        if (id.includes('element-plus') || id.includes('@element-plus')) return
                        if (id.includes('@iconify')) return 'vendor-iconify'
                        if (id.includes('vue-i18n') || id.includes('@intlify')) return 'vendor-i18n'
                        if (id.includes('vue-router') || id.includes('pinia') || id.includes('@vue/') || id.includes('vue/dist')) return 'vendor-vue'
                        if (id.includes('dayjs')) return 'vendor-dayjs'
                        if (id.includes('axios')) return 'vendor-axios'
                        if (id.includes('lodash')) return 'vendor-lodash'
                        if (id.includes('@vueuse')) return 'vendor-vueuse'
                        if (id.includes('nprogress')) return 'vendor-nprogress'
                    }
                }
            }
        }
    }
})
