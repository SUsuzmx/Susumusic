# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Susumusic（对外曾用名 Susumusic）是一个基于 Electron 的沉浸式音乐播放器桌面应用：融合网易云 / QQ 音乐双音源、天气电台、歌词舞台、音频驱动的粒子视觉和 3D 歌单架。当前版本见 `package.json`（v1.1.1）。

注意：`AGENTS.md` / `AI_HANDOFF.md` 中的部分路径引用（如 `Susumusic/resources/app/`、`docs/`、外层 `E:\桌面\播放器软件\Susumusic\` 运行目录、`CHANGELOG.md`、`updates/`、`backups/`）描述的是另一套部署工作区，**本仓库 `E:\music\susumusic` 不一定都存在**。以本仓库实际文件结构为准，遇到不存在的目录不要假设其内容。

## 常用命令

```bash
npm start            # Electron 启动（入口 desktop/main.js，会拉起 server.js）
npm run web          # 纯 Node 跑 server.js，不启动 Electron，用于调试后端 API
npm run build:win    # 构建 Windows NSIS 安装包到 dist/
npm run build:win:dir # 仅打包目录产物（不生成安装器），调试构建用
node --check server.js   # 语法检查（无独立测试套件）
node --check dj-analyzer.js
```

没有 `npm test`。改完代码至少跑 `node --check` 对应文件；改前端视觉后在 Electron 里重启肉眼验证。

发布相关命令（仅在用户明确要求上传/发布时执行，默认只本地构建）：

```bash
# GitHub Release 上传走代理时优先用本机 127.0.0.1:10808，不要用旧的 127.0.0.1:26001（连接拒绝）
gh release create <tag> dist/Susumusic-<ver>-Setup.exe ... --latest=false
```

## 架构总览

三层结构，全部用 CommonJS，前端为传统多 `<script>` 引入（无打包器、无框架）。

### 1. Electron 主进程 `desktop/main.js`（~50KB）
- 创建主窗口、桌面歌词窗口（`public/desktop-lyrics.html`）、壁纸窗口（`public/wallpaper.html`）。
- **进程内加载 `server.js`**（`localServer = require(...)`，不是子进程 spawn）：先 `findOpenPort(3000)` 选端口，写入 `process.env.PORT` 并强制 `HOST=127.0.0.1`，再 require，渲染进程通过 `http://127.0.0.1:<port>` 同源访问。前端所有 API 走相对路径 `/api/...`（经 `apiJson` 封装），不要写绝对地址。
- 运行时把 cookie / 更新目录重定向到 `app.getPath('userData')`：`COOKIE_FILE` / `QQ_COOKIE_FILE`（带旧仓库根 `.qq-cookie` 一次性迁移）、`SUSUMUSIC_UPDATE_DIR`。只有 `npm run web` 才回落到仓库根 `./.cookie`、`./.qq-cookie`、`updates/`。
- 全局快捷键、网易云/QQ 登录窗口（独立 `persist:` session 分区，用于 cookie 隔离）、窗口状态管理。
- `desktop/preload.js` 通过 `contextBridge` 暴露 `window.desktopWindow` API；`desktop/overlay-preload.js` 给桌面歌词/壁纸窗口用。
- IPC 通道集中在 `desktop/main.js` 的 `ipcMain.handle('susumusic-*' | 'desktop-window-*' | 'netease-music-*' | 'qq-music-*')`。

### 2. 本地后端 `server.js`（~170KB，4200+ 行）
纯 Node `http` 服务器，单文件路由（用 `if (pn === '/api/...')` 顺序匹配，非框架）。核心职责：
- **音源代理**：网易云（`NeteaseCloudMusicApi` 包）+ QQ 音乐，搜索/取 URL/歌词/封面/评论/歌单/喜欢/电台播客等。
- **登录**：网易云扫码登录（`login_qr_*`）+ cookie 持久化到 `./.cookie`；QQ cookie 到 `./.qq-cookie`。受保护 API 自动带登录用户 cookie。
- **更新系统**：检查 GitHub Release → 下载安装包 → 校验 SHA512 → 轻量补丁（`.patch.json`，限制只能覆盖 `public/desktop/build` 目录或白名单根文件）。相关常量：`UPDATE_WORK_DIR` / `UPDATE_DOWNLOAD_DIR` / `UPDATE_PATCH_BACKUP_DIR`，默认落在 `updates/` 下（被 git 忽略）。
- **节拍缓存**：`BEATMAP_CACHE_DIR` 默认 `D:\SusumusicCache\beatmaps`（Windows），缓存 `dj-analyzer` 的分析结果。
- **天气电台**：Open-Meteo + ip-api 定位。
- 静态文件服务：`serveStatic` 直接吐 `public/`。

### 3. 前端 `public/`
- `index.html`（~67KB）：主 UI + 大量内联逻辑，含歌词、粒子、3D 歌单架、视觉控制台。**体量大，改前必须先用搜索定位已有函数/状态，不要整块重写视觉系统**。
- `public/js/`：模块化脚本，按 `index.html` 末尾的顺序加载：
  - `app.js` — 全局状态与主逻辑（`var audio/audioCtx/analyser`、播放队列、登录状态、网易云+QQ 双 provider）。
  - `audio-reactive.js` — 精细音频分析，向 `window.uniforms` 写 `uKick/uDrop/uSnare`，暴露 `AudioReactive.state`（含 section、bpm、beatPhase 等）。
  - `particle-behavior.js` / `particle-reactive-panel.js` / `spatial-ambient.js` / `liquid-deform.js` / `visual-enhancements.js` — 各类视觉子系统。
  - `cinematic-transition.js` — 电影镜头转场。
  - `lyric3.js` / `lyric-scene.js` — 歌词渲染与舞台。
  - `physics-progress.js` — 物理进度条。
  - `vinyl-disc-3d.js` — 3D 黑胶。**注意：当前 `index.html` 没有为它加 `<script>` 标签**，`app.js` 里所有 `window.VinylDisc3D` 调用都带 `if (window.VinylDisc3D)` 守卫，即该模块当前未启用；改它前先确认是否要手动补 script 标签。
- `public/vendor/`：本地打包的 `three.r128.min.js`、`gsap.min.js`、`music-tempo.min.js`。
- `public/default-user-fx-archive.json`：默认视觉参数存档。
- `public/css/main.css`：样式。

### 4. 节拍分析 `dj-analyzer.js`（~33KB）
独立模块，被 `server.js` 通过 `analyzePodcastDjStream / analyzePodcastDjIntro` 引入，用于播客/DJ 流的节奏分析，结果落盘到节拍缓存。

### 5. 构建 `build/`
- `after-pack.js`：打包后用 `rcedit` 注入图标（解决 electron-builder 图标问题，会从 `node_modules/rcedit` 或 electron-builder 缓存里找 `rcedit-x64.exe`）。
- `installer.nsh`：NSIS 安装器自定义脚本；`installer*.bmp`：安装器侧边栏/头部图。
- `icon.ico` / `icon.png`：应用图标。
- electron-builder 配置在 `package.json` 的 `build` 字段：`asar: false`，文件白名单显式列出 `desktop/public/build/server.js/dj-analyzer.js`，且排除 `public/index.*.html` 只保留 `public/index.html`。

## 关键约定

- **前端无打包器**：新增 JS 模块要在 `index.html` 里手动加 `<script>` 标签，且注意加载顺序（依赖前置）。全局变量挂在 `window`（`var` 声明），模块间靠全局通信。
- **音源 cookie 隔离**：网易云和 QQ 各自独立 cookie 文件和 Electron session 分区，互不污染；`loginProvider` / `activeAccountProvider` 在 `app.js` 控制当前活跃源。
- **更新系统安全边界**：补丁只能改 `public/desktop/build` 或白名单根文件，单补丁上限 `PATCH_MAX_BYTES`（12MB）；安装包必须 SHA512 校验通过才落地。改这块要同步看 `verifyUpdateBuffer` / `PATCH_ALLOWED_ROOTS`。
- **静态路由顺序敏感**：`server.js` 用一连串 `if (pn === ...)` 匹配路由，加新接口要在静态文件兜底（`serveStatic`）之前插入。
- **发布流程**：`v1.1.0+` 安全发布**不上传 `latest.yml`**，避免旧版客户端自动更新拉到新版；Release 用 `--latest=false`。详见 `AGENTS.md` 的 Release Workflow（路径引用以本仓库实际为准）。
- **用户偏好**（来自 AGENTS.md / AI_HANDOFF.md）：中文沟通；少废话直接做、做完验证；UI 偏暗色玻璃质感、拒绝廉价渐变/错位/闪烁；不要随意重写 `index.html` 视觉系统；不要恢复已废弃的旧侧边栏闪烁/3D 歌单架强制切回等问题；除非用户明确要求，不要主动 push 或上传 GitHub。
