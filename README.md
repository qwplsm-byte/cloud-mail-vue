<p align="center">
    <img src="doc/demo/logo.png" width="80px" />
    <h1 align="center">Cloud Mail（二改版）</h1>
    <p align="center">基于 Cloudflare 的 Serverless 响应式邮箱服务 · 二改增强版</p>
</p>

## 项目简介

只需一个域名即可创建多个邮箱，可部署到 Cloudflare Workers，低成本搭建自己的邮箱服务。

本仓库是二次开发（二改）版本，基于上游开源项目 [maillab/cloud-mail](https://github.com/maillab/cloud-mail)
演进，在原版基础上重做了界面并扩展了 AI 能力，代码与原版差异较大，故独立维护。

## 与原版的主要差异

- **界面重做**：整套毛玻璃（液态玻璃）视觉，内置浅色 / 深色 / 跟随系统 / Android 壁纸取色主题；触屏与窄屏自动降低模糊。
- **AI 助手**：支持记忆与用户画像、主动发信、指定发件邮箱；对话记录服务端存储，账号跨端同步。
- **AI 邮件分类**：收件箱自动分类（账号 / 通知 / 账单 / 推广 / 其他）。
- **AI 网盘**：文件管理与 AI 打标签、智能归类。
- **通行密钥登录**：支持 WebAuthn / Passkey。
- **对象存储直传**：R2 预签名直传，图片 / 视频 / GIF 直传，支持 <5GB 大视频。
- **背景视频**：登录背景支持视频与 mkv 等格式，解码失败自动回退。
- **性能优化**：构建分包、语言包按需加载、路由 chunk 空闲预取、视图缓存、邮件列表虚拟滚动。

## 项目结构

```
cloud-mail-vue
├── mail-worker                # 后端项目（Hono + Cloudflare Workers）
│   ├── src
│   │   ├── api                # 接口层
│   │   ├── const              # 项目常量
│   │   ├── dao                # 数据访问层
│   │   ├── email              # 邮件处理
│   │   ├── entity             # 数据库实体
│   │   ├── error              # 自定义异常
│   │   ├── hono               # web 框架、拦截器、全局异常
│   │   ├── i18n               # 国际化
│   │   ├── init               # 初始化
│   │   ├── model              # 响应体封装
│   │   ├── security           # 身份权限认证
│   │   ├── service            # 业务服务层
│   │   ├── template           # 消息模板
│   │   ├── utils              # 工具类
│   │   └── index.js           # 入口文件
│   ├── package.json
│   └── wrangler.toml          # 项目配置
│
├── mail-vue                   # 前端项目（Vue 3 + Vite）
│   ├── src
│   │   ├── axios              # axios 实例与拦截器
│   │   ├── components         # 通用组件（邮件虚拟列表等）
│   │   ├── echarts            # ECharts 按需注册
│   │   ├── i18n               # 国际化（按需加载）
│   │   ├── icons              # Iconify 图标集
│   │   ├── init               # 应用初始化
│   │   ├── layout             # 主体布局
│   │   ├── perm               # 权限与权限路由
│   │   ├── request            # API 封装
│   │   ├── router             # 路由与守卫、chunk 预取
│   │   ├── store              # 全局状态管理（Pinia）
│   │   ├── theme              # 主题与配色
│   │   ├── utils              # 工具类
│   │   ├── views              # 页面组件
│   │   ├── App.vue
│   │   ├── main.js
│   │   └── style.css          # 全局样式与设计变量
│   ├── package.json
│   └── vite.config.js
│
└── .github/workflows/deploy-cloudflare.yml   # 推送即自动构建部署
```

## 技术栈

- **平台**：[Cloudflare Workers](https://developers.cloudflare.com/workers/)
- **后端框架**：[Hono](https://hono.dev/) + [Drizzle ORM](https://orm.drizzle.team/)
- **前端框架**：[Vue 3](https://vuejs.org/) + [Vite](https://vitejs.dev/)
- **UI 框架**：[Element Plus](https://element-plus.org/)
- **邮件发送**：[Resend](https://resend.com/)
- **缓存 / 数据库 / 存储**：[Cloudflare KV](https://developers.cloudflare.com/kv/) / [D1](https://developers.cloudflare.com/d1/) / [R2](https://developers.cloudflare.com/r2/)

## 本地开发

```bash
# 后端 mail-worker
cd mail-worker
pnpm install
pnpm dev            # 本地启动 Worker（wrangler-dev.toml）

# 前端 mail-vue
cd mail-vue
npm install
npm run dev         # 读取 .env.dev，默认请求 http://127.0.0.1:8787/api
```

前端环境变量（`mail-vue/.env.*`）：`VITE_APP_TITLE`、`VITE_BASE_URL`（后端 API 地址）、`VITE_PWA_NAME`、`VITE_OUT_DIR`。

## 部署

仓库已内置 GitHub Actions 工作流（[deploy-cloudflare.yml](.github/workflows/deploy-cloudflare.yml)）：
推送到 `main` 且改动命中 `mail-worker/**` 或 `mail-vue/**` 时，自动安装依赖、构建前端、执行
`wrangler deploy` 并初始化数据库。

需要在仓库 Secrets / Variables 中配置：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、
`JWT_SECRET`、`ADMIN`、`DOMAIN` 等（详见工作流）。

## 许可证

本项目采用 [MIT](LICENSE) 许可证。

## 致谢与反馈

- 上游项目：[maillab/cloud-mail](https://github.com/maillab/cloud-mail)，感谢原作者的开源工作。
- 本仓库：<https://github.com/qwplsm-byte/cloud-mail-vue>
- 问题反馈：<https://github.com/qwplsm-byte/cloud-mail-vue/issues>
