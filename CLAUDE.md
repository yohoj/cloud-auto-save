# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`cloud-auto-save` (云盘自动转存系统) — an Express + TypeORM/SQLite web app that auto-transfers ("转存") files from Tianyi Cloud (天翼云盘) and Quark (夸克网盘) share links into a user's own cloud drive on a schedule, then runs media post-processing (STRM generation, TMDB scraping, AI rename, Emby/飞牛 refresh, notifications). Forked from [1307super/cloud189-auto-save](https://github.com/1307super/cloud189-auto-save). UI and logs are in Chinese.

## Commands

```bash
yarn install          # installs deps; note the git submodule below
yarn dev              # ts-node src/index.js — run from source (dev)
yarn build            # tsc → compiles src/ to dist/ (entities/*.ts + allowJs .js)
yarn start            # node dist/index.js — run the build
yarn test             # alias for `tsc --noEmit` (so are `lint` and `typecheck`)
```

- **There is no test suite.** `test`, `lint`, and `typecheck` all just run `tsc --noEmit`. Use it as the build/type gate after changes; there is no per-test runner.
- **Git submodule:** `vender/cloud189-sdk` (the Tianyi SDK) is a submodule *and* an npm dependency (`cloud189-sdk`). After cloning, `git submodule update --init` if `vender/` is needed.
- Runtime data lives in `data/` (sqlite db, `config.json`, sessions, login tokens) and STRM output in `strm/`. Both are gitignored; in Docker they map to `/home/data` and `/home/strm`.
- Logs are written to `/tmp/cloud-auto-save.log` and streamed to the UI over SSE — `tail -f /tmp/cloud-auto-save.log` to watch a running instance.

## Language & module conventions

- **Mostly CommonJS JavaScript** (`require`/`module.exports`). Only `src/entities/index.ts` and `src/sdk/cloudsaver/*.ts` are TypeScript; `tsconfig.json` has `allowJs: true` and compiles everything to `dist/`.
- New backend code should follow the existing `.js` + CommonJS style unless you are touching the entities/SDK TS files.
- **Frontend is now Vue 3** (see `doc/vue-migration-plan.md`). The SPA lives in **`frontend/`** (Vite 5 + Vue 3 + TypeScript + Pinia + Vue Router history mode + Element Plus). Build with `cd frontend && yarn build` → `frontend/dist`; dev with `cd frontend && yarn dev` (Vite :5173, proxies `/api` and `/emby` to Express :3000). Type-gate: `yarn --cwd frontend typecheck` (vue-tsc).
  - In production, `src/index.js` serves the Vue build (`dist/public`, copied from `frontend/dist` by the Dockerfile) at `/`, with a SPA history fallback (`app.get('*')`). Docker base image is **Node 20**.
  - Frontend structure: `api/` (axios + per-domain modules + SSE), `stores/` (Pinia: auth/accounts/tasks/settings/logs), `views/` (Login/Tasks/Accounts/Media/Settings), `components/` (dialogs + folder tree + log viewer), `composables/`, `utils/`.

## Architecture

### Entry point — everything is in `src/index.js`

There is **no router layer**. `src/index.js` bootstraps Express, then defines *every* API route inside the `AppDataSource.initialize().then(async () => { ... })` callback so the route handlers close over the TypeORM repositories and shared service instances (`taskService`, `embyService`, `messageUtil`, `folderCache`, `botManager`). When adding an endpoint, add it inside that callback. It also contains the Tianyi TV/PC QR-login flow (`requestCloud189Tv`, `getCloud189PcSession`, the `cloud189QrLogins` Map).

### Multi-cloud abstraction — `utils/CloudUtils.js`

`CloudUtils.getService(account)` is the single dispatch point: it returns a `QuarkService` or `Cloud189Service` instance based on the account's cloud type. **Never instantiate a cloud service directly** — always go through `CloudUtils`.

- Cloud type is resolved from `account.cloudType` (`'cloud189'` | `'quark'`), falling back to the **username prefix**: `q_` ⇒ quark.
- A `n_` username prefix marks a **placeholder/notification-only account** — skipped for capacity queries and login (see checks in `index.js`).
- Both services are **per-account singletons** (`getInstance(account)` / `removeInstance(username)`), keyed by username. After editing/deleting an account, call `CloudUtils.removeInstance(...)` to drop the cached client (the routes already do this).
- The two services are **duck-typed to a shared interface** consumed by `TaskService`: `listFiles`, `listShareDir`, `getShareInfo`, `getShareFiles`, `checkAccessCode`, `createFolder`, `getFolderNodes`, `renameFile`, `createBatchTask`, `checkTaskStatus`, `getConflictTaskInfo`, `manageBatchTask`, `getUserSizeInfo`, etc. If you add a method to one, mirror it in the other (or guard with `CloudUtils.isQuarkAccount`). Quark is implemented natively in `services/quark.js`; Tianyi wraps the `cloud189-sdk`.

### Task pipeline — `services/task.js` (`TaskService`)

`processTask(task)` is the core incremental-transfer loop:
1. List the share directory (recursively collecting sub-folder files, since shares can be nested).
2. List existing files in the target folder; build dedup sets by **md5**, **filename / relative-path**, and **folder name**.
3. Filter candidates through `_evaluateTransferCandidate`: dedup + media-suffix + match-rule (`_handleMatchMode`: regex extract → `lt/gt/eq/contains/notContains`) + optional **AI filter** + **bloom-filter "和谐"/harmonized** check (`utils/BloomFilter.js`, blocks known-removed md5s).
4. Batch-transfer new files grouped by source sub-folder via `createBatchTask`, polling `checkTaskStatus` (handles conflict status 2 and harmonized-file detection on status 4).
5. On success, set status/episodes and **emit `taskComplete`** (via `process.nextTick`).
6. Failures go through `_handleTaskFailure` → retry with backoff (`task.retryCount`, `nextRetryTime`) up to `task.maxRetries`, else `status='failed'`.

Quark stoken expiry (`code 41016` / "stoken过期") is detected by `_isQuarkStokenExpired` and auto-refreshed+retried via `_refreshQuarkShareToken`.

### Event-driven post-processing — `services/eventService.js` + `services/taskEventHandler.js`

`EventService` is a **singleton EventEmitter**. `TaskService`'s constructor registers the single `taskComplete` listener (guarded by `hasListeners` so it's attached once). `TaskEventHandler.handle` runs an **ordered** post-transfer pipeline, each step independently try/caught so one failure doesn't abort the rest:

`autoRename` → `STRM generation` → `Alist/OpenList cache refresh` → `TMDB scraping` → `Emby notify` → task message (SmartStrm / 飞牛影视).

Each step is gated by its `ConfigService` flag (`strm.enable`, `tmdb.enableScraper`, `emby.enable`, …).

### Scheduling — `services/scheduler.js` (`SchedulerService`)

Static class holding `node-cron` jobs in a `Map`. Initialized once at startup (`initTaskJobs`). Two kinds of jobs:
- **Per-task** cron jobs (`saveTaskJob` / `removeTaskJob`) — created/updated whenever a task with `enableCron` is created or edited.
- **Default** system jobs (`saveDefaultTaskJob`): task check (default `0 19-23 * * *`, supports multiple expressions split by `|`), retry sweep (every 1 min), recycle-bin cleanup. `handleScheduleTasks` reconciles these when settings change.
- `runWithLock` prevents the same job from overlapping itself.

### Config — `services/ConfigService.js` (singleton)

Single source of truth, persisted to `data/config.json`, deep-merged over an in-code schema (the `this._config` default object — **add new settings keys there**). Key behaviors:
- `getConfigValue('a.b.c', default)` — dotted-path read. `setConfig(obj)` filters to schema-allowed keys and merges.
- **Sensitive keys** (`_sensitiveKeys`) are masked as `********` in `getPublicConfig()` (what the settings API returns) and are *preserved* (not overwritten) when an incoming save sends the placeholder or empty string. When adding a secret-bearing setting, add its dotted path to `_sensitiveKeys`.
- `SESSION_SECRET` is auto-generated into config on first run if not provided via env.

### Database — `database/index.js` + `entities/index.ts`

TypeORM + SQLite (`data/database.sqlite`, WAL mode). Three entities: **Account**, **Task**, **CommonFolder**. All datetime columns use `+08:00` transformers.

- `synchronize` is **ON by default** and only OFF when `NODE_ENV=production` (unless `TYPEORM_SYNC=true`). So in dev, entity changes auto-migrate; for production-safe schema changes, add a manual `PRAGMA table_info` + `ALTER TABLE` block in `index.js` after init (see the existing `cloudType` column migration as the pattern).
- `Task.enableSystemProxy` is a **removed legacy mode**: many code paths `throw new Error('系统代理模式已移除')`, and pending/retry queries filter `enableSystemProxy IS NULL`. Don't build on it.

### Messaging — `services/message.js` (`MessageUtil`) + `services/message/MessageManager.js`

`MessageUtil` wraps the singleton `MessageManager`. **Naming gotcha:** `ConfigService` stores `enable` (e.g. `telegram.enable`), but `MessageManager.initialize` reads `enabled` — `MessageUtil._init()` does the `enable`→`enabled` mapping. After settings change, the `/api/settings` route calls `messageUtil.updateConfig()` to re-init all channels. Channels: 企业微信/Wework, Telegram, WxPusher, Bark, PushPlus, SmartStrm, 飞牛影视(Fntv), plus always-on CustomPush.

### Auth

Dual-mode in the global middleware in `index.js`: either a valid `express-session` (file-store under `data/sessions`, login via `/api/auth/login` against `system.username`/`system.password`) **or** an `x-api-key` header matching `system.apiKey`. Exemptions: `/`, `/login`, login API, `/emby/notify` (webhook), and static asset extensions.

### STRM & logging

- `services/strm.js` writes `.strm` files under `./strm`, applying `PUID`/`PGID`/`STRM_DIR_MODE`/`STRM_FILE_MODE`. Path translation between cloud and local/Emby uses the per-account `localStrmPrefix` / `cloudStrmPrefix` / `embyPathReplace` columns.
- `utils/logUtils.js`: `logTaskEvent(msg)` appends to `/tmp/cloud-auto-save.log` and broadcasts to all SSE clients on `/api/logs/events`; `sendAIMessage` pushes streaming AI chat chunks. Use `logTaskEvent` (not bare `console.log`) for anything that should appear in the UI log/Telegram flows.

## Docs

- `Readme.md` — full feature list, deployment (Docker/compose), env vars, and per-feature setup (STRM, Emby, TMDB/AI, 飞牛, SmartStrm, proxy, Telegram bot).
- `doc/api.md` — API reference.
