<template>
  <el-config-provider :locale="settingStore.lang === 'zh' ? zhCn : null">
    <router-view />
  </el-config-provider>
</template>
<script setup>
import { watch } from "vue";
import {useSettingStore} from "@/store/setting.js";
const settingStore = useSettingStore()
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import('@/icons/index.js')
import { setLocale } from '@/i18n/index.js'
// 语言包按需加载（入口不再内置全量词条），切换语言时惰性加载另一种
setLocale(settingStore.lang)
watch(() => settingStore.lang, (lang) => setLocale(lang))
</script>
