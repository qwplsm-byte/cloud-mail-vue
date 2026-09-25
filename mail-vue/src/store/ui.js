import { defineStore } from 'pinia'

export const useUiStore = defineStore('ui', {
    state: () => ({
        asideShow: window.innerWidth > 1024,
        accountShow: false,
        backgroundLoading: true,
        changeNotice: 0,
        writerRef: null,
        changePreview: 0,
        previewData: {},
        key: 0,
        theme: 'light',
        androidDark: false,
        //跟随系统时的系统明暗, 由 matchMedia 实时刷新; 这是设备状态而非用户偏好, 不持久化
        systemDark: false,
        asideCount: {
            email: 0,
            send: 0,
            sysEmail: 0
        }
    }),
    getters: {
        // 保留旧的布尔语义, 编辑器/图表/登录页等消费方无需改动
        dark: (state) => state.theme === 'dark'
            || (state.theme === 'android' && state.androidDark)
            || (state.theme === 'auto' && state.systemDark),
    },
    actions: {
        showNotice() {
            this.changeNotice ++
        },
        previewNotice(data) {
            this.previewData = data
            this.changePreview ++
        }
    },
    persist: {
        pick: ['accountShow','theme','androidDark'],
    },
})