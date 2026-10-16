# Cloud Mail（二改版）· 前端

本仓库是二次开发（二改）项目 **Cloud Mail** 的前端部分，基于上游开源项目
[maillab/cloud-mail](https://github.com/maillab/cloud-mail) 演进而来，在其 Serverless 邮箱服务的基础上做了大量
界面重做与功能扩展，代码已与原版有较大差异，故独立维护。

> 本仓库仅包含前端（Vue 3 + Vite）。完整服务还需要配套的后端 Worker（本项目对应 `mail-worker`），
> 二者通过 `VITE_BASE_URL` 指向的 HTTP API 交互。

## 与原版的主要差异

- **界面重做**：整套毛玻璃（液态玻璃）视觉，内置浅色 / 深色 / 跟随系统 / Android 壁纸取色主题；触屏与窄屏自动降低模糊。
- **AI 助手**：支持记忆与用户画像、主动发信、指定发件邮箱；对话记录服务端存储，账号跨端同步。
- **AI 邮件分类**：收件箱自动分类（账号 / 通知 / 账单 / 推广 / 其他）。
- **AI 网盘**：文件管理与 AI 打标签、智能归类。
- **通行密钥登录**：支持 WebAuthn / Passkey。
- **对象存储直传**：R2 预签名直传，图片 / 视频 / GIF 直传，支持 <5GB 大视频。
- **背景视频**：登录背景支持视频与 mkv 等格式，解码失败自动回退。
- **性能优化**：构建分包、语言包按需加载、路由 chunk 空闲预取、视图缓存、邮件列表虚拟滚动。

## 技术栈

- **框架**：Vue 3（`<script setup>`）+ Vite 7
- **UI**：Element Plus（经 `unplugin-vue-components` 按需引入）+ Iconify 图标
- **状态管理**：Pinia（`pinia-plugin-persistedstate` 持久化）
- **路由**：Vue Router 4（懒加载 + 权限动态路由）
- **国际化**：vue-i18n（中 / 英，语言包按需加载）
- **图表**：ECharts
- **请求**：axios
- **其它**：dayjs、lodash-es、nprogress（顶栏进度）、CompressorJS、Dexie
- **部署形态**：构建为静态资源，可作为 Cloudflare 静态资源部署，并内置 PWA

## 目录结构

```
src/
├── axios/         # axios 实例与拦截器（鉴权、语言、统一错误提示）
├── components/    # 通用组件（邮件列表虚拟滚动、loading 等）
├── db/            # 本地 IndexedDB 封装（Dexie）
├── echarts/       # ECharts 按需注册
├── enums/         # 枚举常量
├── i18n/          # 多语言（zh.js / en.js / 按需加载入口 index.js）
├── icons/         # Iconify 图标集（按需引入）
├── init/          # 应用初始化（站点配置、用户信息、权限路由注入）
├── layout/        # 布局（侧边菜单、顶栏、账号栏）
├── perm/          # 权限指令与权限路由表
├── request/       # 各业务模块的 API 封装
├── router/        # 路由与守卫、路由 chunk 空闲预取
├── store/         # Pinia stores
├── theme/         # 主题与配色（含 Android 动态取色）
├── utils/         # 工具函数
├── views/         # 页面（email / content / star / send / draft / drive / ai /
│                  #       setting / user / role / sys-setting / reg-key /
│                  #       all-email / analysis / login ...）
├── App.vue
├── main.js
└── style.css      # 全局样式与设计变量（玻璃模糊、圆角、阴影等）
```

## 环境变量

按 `--mode` 读取对应 `.env.*` 文件，主要变量：

| 变量 | 说明 |
| --- | --- |
| `NODE_ENV` | 运行环境标识 |
| `VITE_APP_TITLE` | 应用标题 |
| `VITE_BASE_URL` | 后端 API 地址（指向 mail-worker，如 `http://127.0.0.1:8787/api`） |
| `VITE_PWA_NAME` | PWA 名称 |
| `VITE_OUT_DIR` | 构建输出目录（发布模式下默认输出到 `../mail-worker/dist`） |

仓库已内置：

- `.env.dev`：本地开发，指向 `http://127.0.0.1:8787/api`
- `.env.remote`：连接远程后端
- `.env.release`：发布构建

## 本地开发与构建

```bash
# 安装依赖
npm install

# 本地开发（读取 .env.dev）
npm run dev

# 连接远程后端调试
npm run remote

# 发布构建（读取 .env.release，产物输出到 VITE_OUT_DIR）
npm run build

# 预览构建产物
npm run preview
```

构建产物为纯静态资源，配合后端 Worker 一同部署即可。

## 致谢

- 上游项目：[maillab/cloud-mail](https://github.com/maillab/cloud-mail)，感谢原作者的开源工作。
- 本仓库为在此基础上的二改版本，主要改动集中在界面重做、AI 能力与性能优化，具体见上文"与原版的主要差异"。

## 反馈

- 仓库地址：<https://github.com/qwplsm-byte/cloud-mail-vue>
- 问题反馈：<https://github.com/qwplsm-byte/cloud-mail-vue/issues>
