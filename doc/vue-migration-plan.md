# 前端 Vue 3 迁移技术方案

> 目标读者：本项目长期维护者。本文档是「脱离上游、自主演进」决策后的前端重写方案。
> 现状基线（实测）：原生 HTML/CSS/JS，约 **4000 行 JS**（**618 处手写 DOM 操作**）、**6600 行 CSS**、单个 1160 行 `index.html`、**零构建**、17 个 `<script>` 标签靠隐式全局共享状态。后端已**完全 API 化**（40 个路由），鉴权为 session + `x-api-key`，日志走 SSE。

---

## 0. 总体目标

- Vue 3 SPA 接管整个前端；**后端业务逻辑零改动**，Express 退化为「纯 API + 静态托管打包产物」。
- 后端唯一改动：静态托管目录切换 + SPA history fallback（几行），鉴权/路由/服务层全部不动。
- 迁移采用**「骨架先行的整体重写」**：一次性立项全量 Vue 化，但先用最复杂的任务页打通全链路作为试金石，把构建/主题/鉴权风险前置暴露。

---

## 1. 技术栈与版本约束

| 项 | 选型 | 说明 |
|---|---|---|
| 框架 | **Vue 3.4+** | Composition API + `<script setup>` |
| 构建 | **Vite 5** | 选 5 而非 7，降低 Node 版本跨度 |
| 路由 | **Vue Router 4** | history 模式（备选 hash，见 §3） |
| 状态 | **Pinia 2** | 替代当前散落的全局函数 |
| 组件库 | **Element Plus** | 中文后台首选，覆盖表格/弹窗/表单/树/分页 |
| 语言 | **TypeScript**（建议，可渐进） | 与后端 `entities/*.ts`、SDK 对齐 |
| HTTP | **axios** | 统一拦截器处理鉴权/错误 |

### ⚠️ 必做前置：Node 升级（16 → 20 LTS）

Dockerfile 当前为 `node:16.19.0`，而 Vite 5 需要 Node 18+。建议直接上 **Node 20 LTS**。

后端兼容性已核查，均支持 Node 20：
- `sqlite3@^5.1.6`（原生模块，5.1.6 起提供 Node 20 预编译二进制）
- `express@4` / `express-session` / `session-file-store` / `typeorm@0.3` / `cloud189-sdk`

> **闸门验证结果（2026-06-19，已通过）**：
> - 本机当前为 **Node v24.14.1**——后端已运行在比目标 20 更新的版本上。
> - 隔离环境（nvm Node **20.20.2**）实测 `sqlite3@^5.1.6`（解析为 5.1.7）：npm 安装成功（**预编译二进制**，6s，无源码编译），真实建表/写入/读取通过，内置 SQLite 3.44.2。
> - 全依赖树扫描确认 **`sqlite3` 是唯一原生模块**；其余（express4/typeorm0.3/cloud189-sdk/node-cron/telegram 等）均为纯 JS，Node 20 安全。
> - 结论：**Node 20 闸门通过**，可放心将 Docker 基础镜像升至 Node 20。（Node 22 LTS 同样可行，且更贴近本机 24；二选一皆可。）

---

## 2. 目录结构

前端**独立为 `frontend/` 工作区**，自带 `package.json`，与后端 `src/` 解耦——避免 Vite 等构建依赖污染后端生产镜像。

```
frontend/
├── index.html                 # Vite 入口（取代 src/public/index.html）
├── vite.config.ts             # dev proxy + build 配置
├── package.json               # 前端独立依赖
├── tsconfig.json
└── src/
    ├── main.ts                # createApp + Pinia/Router/ElementPlus 挂载
    ├── App.vue
    ├── api/                   # —— API 层封装（§4）
    │   ├── client.ts          # axios 实例 + 拦截器（鉴权/401/错误 toast）
    │   ├── sse.ts             # EventSource / fetch-stream 封装（日志、AI 流）
    │   ├── accounts.ts
    │   ├── tasks.ts
    │   ├── folders.ts
    │   ├── settings.ts
    │   └── misc.ts            # version / share-parse / favorites / chat / strm ...
    ├── stores/                # —— Pinia（§5）
    │   ├── auth.ts
    │   ├── accounts.ts
    │   ├── tasks.ts
    │   ├── settings.ts
    │   └── logs.ts
    ├── router/index.ts        # —— Vue Router（§6）
    ├── views/                 # 页面 = 当前 4 个 tab + 登录
    │   ├── LoginView.vue
    │   ├── AccountsView.vue
    │   ├── TasksView.vue
    │   ├── MediaView.vue
    │   └── SettingsView.vue
    ├── components/            # 复用组件（从现有模块拆出）
    │   ├── AppLayout.vue      # 顶部 4 tab 框架
    │   ├── FolderSelector.vue # ← folderSelector.js (501 行)
    │   ├── EditTaskDialog.vue # ← edit-task.js (271 行)
    │   ├── CloudSaverPanel.vue# ← cloudsaver.js
    │   ├── ChatPanel.vue      # ← chat.js
    │   ├── LogViewer.vue      # ← logs.js (SSE)
    │   └── CustomPushTable.vue# ← customPush.js (357 行)
    ├── composables/
    │   ├── useTheme.ts        # ← theme.js，深色模式 data-theme
    │   └── useQrLogin.ts      # ← 天翼 TV/PC 扫码登录轮询
    ├── styles/                # 迁移现有 CSS（§8）
    └── assets/
```

---

## 3. 构建与 Docker 改造

### 开发流程（前后端并行）
- 后端：`yarn dev`（不变，:3000）
- 前端：`cd frontend && yarn dev`（Vite :5173）
- `vite.config.ts` 配 proxy，把 `/api`、`/emby` 转发到 `http://localhost:3000`，`changeOrigin` + cookie 透传 → session 同源生效，热更新可用。

### 生产构建
- `cd frontend && yarn build` → 产物 `frontend/dist`。
- **Express 改动（仅两处）**：
  1. 静态托管目标从 `src/public` 改为 `frontend/dist`。
  2. 新增 SPA history fallback：对**非 `/api`、非 `/emby/notify`、非静态资源**的 GET 返回 `index.html`。**务必放在所有 API 路由注册之后**，且不破坏现有鉴权中间件对 `/`、`/login` 的豁免。
- **保守备选**：Vue Router 改用 **hash 模式**（`/#/tasks`），则无需 fallback，后端静态托管目录一改即可。风险最低，代价是 URL 带 `#`。

### Dockerfile（双构建阶段）
```dockerfile
# builder：升级 node:20-slim
FROM node:20-slim AS builder
WORKDIR /home
COPY . .
RUN yarn install && yarn build            # 后端编译
RUN cd frontend && yarn install && yarn build   # 前端构建 → frontend/dist

# production：node:20-alpine
FROM node:20-alpine AS production
...
COPY --from=builder /home/dist ./dist
COPY --from=builder /home/frontend/dist ./dist/public   # 取代原 src/public 拷贝
```
> 确保 production 阶段 `yarn install --production` 不拉入 Vite 等 devDependencies。

---

## 4. API 层封装（40 个路由 → 5 个模块）

`client.ts`：
- axios 实例，`baseURL: '/'`，`withCredentials: true`（带 session cookie）。
- 请求拦截器：若本地配置了 apiKey，注入 `x-api-key`（headless/API 场景）。
- 响应拦截器：`401` → 跳 `/login`；其余错误统一 `ElMessage` 提示。

| 模块 | 覆盖路由 |
|---|---|
| `accounts.ts` | `GET /api/accounts`、`POST /api/accounts`、扫码 `POST/GET /api/accounts/cloud189/qrcode[/:id]`、`DELETE /api/accounts/recycle`、`DELETE /api/accounts/:id`、`PUT .../strm-prefix\|alias\|default` |
| `tasks.ts` | `GET/POST /api/tasks`、`DELETE /api/tasks/batch\|files\|:id`、`PUT /api/tasks/:id`、`POST /api/tasks/:id/execute`、`POST /api/tasks/strm`、`POST /api/tasks/executeAll` |
| `folders.ts` | `GET/POST /api/folders/:accountId`、`GET /api/share/folders/:accountId`、`GET /api/folder/files`、`POST /api/files/rename`、`POST /api/files/ai-rename` |
| `settings.ts` | `GET/POST /api/settings`、`POST /api/settings/media`、`POST /api/fntv/test`、`POST /api/custom-push/test` |
| `misc.ts` | `GET /api/version`、`POST /api/share/parse`、`POST /api/saveFavorites`、`GET /api/favorites/:accountId`、`POST /api/strm/generate-all`、`GET /api/strm/list` |

`sse.ts`（**不能用 axios**）：
- 日志 `/api/logs/events`：原生 `EventSource` 封装为 composable（`onLog` 回调 + 自动重连）。
- AI 聊天 `/api/chat`（流式）：`fetch` + `ReadableStream` reader（`EventSource` 不支持 POST）。

> `/emby/notify` 是 webhook，前端不调用，仅需在 SPA fallback 中排除。

---

## 5. 状态管理（Pinia）

| store | 职责 | 注意点 |
|---|---|---|
| `auth` | 登录态、apiKey、`login()`/`logout()` | 401 拦截器联动 |
| `accounts` | 账号列表 + CRUD + 扫码登录态 | 编辑/删除后语义对齐后端 `CloudUtils.removeInstance` |
| `tasks` | 任务列表 + CRUD + `execute`/`executeAll`/`strm` | 列表最大、交互最复杂 |
| `settings` | 配置 get/set | **敏感字段 `********` 占位回填语义**不能破坏（见 ConfigService）|
| `logs` | SSE 日志缓冲 | 环形 buffer，限制条数防止无限增长 |

---

## 6. 路由（Vue Router）

```
/login              → LoginView
/                   → AppLayout（顶部 4 tab）
  ├── /tasks        → TasksView（默认，对应当前 active tab）
  ├── /accounts     → AccountsView
  ├── /media        → MediaView
  └── /settings     → SettingsView
```
全局前置守卫：未登录跳 `/login`。

---

## 7. 迁移顺序（骨架先行的整体重写）

| 阶段 | 内容 | 交付物 / 验收 |
|---|---|---|
| **Phase 0 脚手架（闸门）✅ 已完成** | ① Node 20 验证后端启动 + sqlite 读写 ② Vite/Vue/Router/Pinia/ElementPlus 初始化 ③ dev proxy ④ Docker 双阶段 ⑤ Express 静态切换 + fallback ⑥ axios 层 + `auth` store + 登录页 ⑦ `AppLayout` 四空 tab ⑧ 日志 SSE | typecheck ✓ + build ✓ + 后端改造就位；实时冒烟由用户 `yarn dev` 自验 |
| **Phase 1 任务页 ✅ 已完成** | 列表/筛选/执行/批量/STRM（1a）、新建任务+分享解析+文件夹树选择器（1b）、编辑任务+文件管理（重命名/AI重命名/删除文件）（1c） | typecheck ✓ + build ✓；实时由用户自验 |
| **Phase 2 账号页（71 DOM）✅ 已完成** | 列表、新增、**天翼 TV/PC 扫码登录轮询**、STRM 前缀/别名/默认、回收站 | typecheck ✓ + build ✓；含扫码登录状态机、NEED_CAPTCHA 验证码流；实时由用户自验 |
| **Phase 3 系统设置 ✅ 已完成** | 任务/系统/通知（企业微信/TG/WXPusher/Bark/PushPlus/SmartStrm）/代理；保存走 `/api/settings` | typecheck ✓ + build ✓；customPush 数组原样保留（编辑器待补） |
| **Phase 4 媒体设置 ✅ 已完成**（对应「媒体」tab，实为媒体相关设置而非媒体库浏览） | STRM/Emby/TMDB/OpenAI/Alist/飞牛/CloudSaver；保存走 `/api/settings/media`；飞牛连接测试 | typecheck ✓ + build ✓ |
| **Phase 5 收尾** | ✅ 已更新 CLAUDE.md/迁移方案/Dockerfile；✅ **删除 `src/public` 并下线 `/legacy`** | 当前前端已统一为 Vue SPA |

---

## 8. CSS 迁移策略（6600 行）

分三类处理，原则是**「先搬运可用，再逐步替换」**，避免一上来重做视觉导致大面积回归：

1. **全局基础**（`base.css` / `theme.css` / `macos.css` 1280 行）→ 原样搬到 `frontend/src/styles/` 全局引入。深色模式 `data-theme` 机制改成 `useTheme` composable，但 **CSS 变量原样复用**。
2. **组件级**（`modal` / `table` / `card-view` / `folder-tree`）→ 优先让 Element Plus 接管，能删则删；删不掉的搬进对应 SFC `<style scoped>`。
3. **页面级**（`dashboard` / `media-app` / `cloudsaver` / `chat`）→ 跟随页面迁移，进 SFC `scoped`。

---

## 9. 风险与核查（零测试套件）

- **无自动化测试** → 每页维护人工核查清单；迁移完成后以 Vue SPA 为唯一前端，回归时直接验证现网入口。
- **Node 20 升级** → Phase 0 前置验证后端（`sqlite3` 原生绑定为重点）。
- **三个「小心区」**：① dual auth（session + x-api-key）② SSE（日志 + AI 流）③ 天翼扫码登录轮询（qrcode + qrcode/:id 状态机）。
- **敏感配置回填**：`ConfigService` 的 `********` 占位/空串保留语义，前端表单提交时不能把占位符当真值写回。
- **Docker 生产依赖**：确认 Vite 等 devDeps 不进 production 镜像。

---

## 10. 决策记录

**已确认（2026-06-19）：**
1. ✅ **TypeScript**：上 TS（`allowJs` 渐进起步，与后端 entities/SDK 对齐）。
2. ✅ **路由模式**：history（后端加 SPA fallback，避开鉴权中间件对 `/`、`/login` 的豁免逻辑）。
3. ✅ **Node 20 闸门**：已实测通过（见 §1）。

**待确认（Phase 0 前）：**
4. **前端工程位置**：独立 `frontend/`（推荐）vs 并入根 `package.json` workspaces。
5. **旧 UI 过渡**：已完成，`/legacy` 对照入口已下线。
