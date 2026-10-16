import {createRouter, createWebHistory} from 'vue-router'
import NProgress from 'nprogress';
import {useUiStore} from "@/store/ui.js";
import {useSettingStore} from "@/store/setting.js";
import {cvtR2Url} from "@/utils/convert.js";

const routes = [
    {
        path: '/',
        name: 'layout',
        redirect: '/inbox',
        component: () => import('@/layout/index.vue'),
        children: [
            {
                path: '/inbox',
                name: 'email',
                component: () => import('@/views/email/index.vue'),
                meta: {
                    title: 'inbox',
                    name: 'email',
                    menu: true
                }
            },
            {
                path: '/mail',
                name: 'content',
                component: () => import('@/views/content/index.vue'),
                meta: {
                    title: 'message',
                    name: 'content',
                    menu: false
                }
            },
            {
                path: '/settings',
                name: 'setting',
                component: () => import('@/views/setting/index.vue'),
                meta: {
                    title: 'settings',
                    name: 'setting',
                    menu: true
                }
            },
            {
                path: '/starred',
                name: 'star',
                component: () => import('@/views/star/index.vue'),
                meta: {
                    title: 'starred',
                    name: 'star',
                    menu: true
                }
            },
            {
                path: '/drive',
                name: 'drive',
                component: () => import('@/views/drive/index.vue'),
                meta: {
                    title: 'drive',
                    name: 'drive',
                    menu: true
                }
            },
            {
                path: '/ai',
                name: 'ai',
                component: () => import('@/views/ai/index.vue'),
                meta: {
                    title: 'aiAssistant',
                    name: 'ai',
                    menu: true
                }
            },
        ]

    },
    {
        path: '/login',
        name: 'login',
        component: () => import('@/views/login/index.vue')
    },
    {
        path: '/test',
        name: 'test',
        component: () => import('@/views/test/index.vue')
    },
    {
        path: '/:pathMatch(.*)*',
        name: '404',
        component: () => import('@/views/404/index.vue')
    }
]


const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes
})

NProgress.configure({
    showSpinner: false,   // 不显示旋转图标
    trickleSpeed: 50,    // 自动递增速度
    minimum: 0.1          // 最小百分比
});

let timer
let first = true

router.beforeEach((to, from, next) => {

    if (timer) {
        clearTimeout(timer)
    }

    if (!first) {
        timer = setTimeout(() => {
            NProgress.start()
        }, 100)
    }

    const token = localStorage.getItem('token')

    if (!token && !to.path.startsWith('/login')) {
        return next({name: 'login'})
    }

    if (!token && to.path.startsWith('/login')) {
        loadBackground(next)
        return
    }

    if (token && to.path.startsWith('/login')) {
        return next(from.path)
    }

    next()

})

function loadBackground(next) {

    const settingStore = useSettingStore();

    if (settingStore.settings.background) {

        const src = cvtR2Url(settingStore.settings.background);

        const img = new Image();
        img.src = src;

        img.onload = () => {
            next()
        };

        img.onerror = () => {
            console.warn("背景图片加载失败:", img.src);
            next()
        };

        setTimeout(() => {
            console.warn("背景加载超时，已放行");
            next()
        }, 3000)

    } else {
        next()
    }

}

router.afterEach((to) => {

    clearTimeout(timer)
    if (first) {
        removeLoading()
    } else {
        NProgress.done();
    }

    const uiStore = useUiStore()
    if (to.meta.menu) {
        if (['content', 'email', 'send'].includes(to.meta.name)) {
            uiStore.accountShow = window.innerWidth > 767;
        } else {
            uiStore.accountShow = false
        }
    }

    if (window.innerWidth < 1025) {
        uiStore.asideShow = false
    }

    // 首次进入主界面(菜单页)后触发一次空闲预取;
    // 动态权限路由在登录后才注册, 因此放在这里可同时覆盖"已登录直进"与"登录后跳转"两种情况。
    if (!prefetchDone && to.meta.menu) {
        prefetchDone = true
        prefetchRoutes()
    }

    first = false
})

function removeLoading() {
    const doc = document.getElementById('loading-first');
    if (!doc) {
        return;
    }

    doc.remove()
}

// 是否已触发过路由 chunk 预取
let prefetchDone = false

/**
 * 空闲时预取所有已注册路由组件的 chunk。
 * 每个视图都是懒加载独立 chunk，点击菜单时若现场下载会叠加网络往返造成卡顿；
 * 提前在浏览器空闲时段把 chunk 拉进缓存，点击即可秒开。
 */
export function prefetchRoutes() {

    const loaders = new Set()

    router.getRoutes().forEach(record => {
        const comp = record.components && record.components.default
        // 已解析过的组件是对象, 未加载的才是 loader 函数
        if (typeof comp === 'function') {
            loaders.add(comp)
        }
    })

    const list = [...loaders]

    const run = () => {
        list.forEach((load, index) => {
            // 错峰预取, 避免同一时刻并发拉取大量 chunk 抢占带宽影响当前页面
            setTimeout(() => {
                Promise.resolve().then(load).catch(() => {
                })
            }, index * 150)
        })
    }

    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(run, {timeout: 4000})
    } else {
        setTimeout(run, 1500)
    }
}

export default router
