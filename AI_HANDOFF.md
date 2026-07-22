# Susumusic AI Handoff

这个文件是给后续接管本工作区的 AI 看的。每次完成一个任务后，都要更新本文件的「工作日志」和「未完成事项」，让下一位接手者能快速知道用户偏好、当前状态和最近做过什么。

## 用户偏好

- 默认用中文沟通，语气直接、清楚、偏实干。
- 用户希望你主动完成任务，不要只给方案。能本地验证就本地验证。
- 除非用户明确要求“上传 GitHub / 推送 / push / 发布到 Release”，否则不要直接上传或推送到 GitHub；本地提交也要在最终说明里讲清楚。
- 用户很在意视觉质感，尤其讨厌“默认白框”“太素”“没设计感”。Susumusic 视觉方向偏黑色、玻璃、舞台、音乐可视化。
- 做网页、软件界面、安装器时，要优先考虑第一次打开的新用户是否知道软件是干什么的。
- 发布软件时，不能只上传源码。GitHub Release 通常要包含可运行安装包 exe；但 `v1.1.0` 安全发布例外，不上传 `latest.yml`，避免旧版软件内更新直接拉取。
- 安装器默认安装目录优先使用 `D:\Susumusic`，并创建桌面快捷方式。
- 更新逻辑优先轻量快速补丁；完整安装包作为兜底。
- 搜索结果要尽量优先原唱/官方版本，不希望翻唱排在原唱前面。
## 工作区地图

- `server.js`：本地 API、网易云代理、搜索、首页数据、更新检查、完整安装包下载、快速补丁应用。
- `public/index.html`：主界面和大部分前端逻辑，体量很大，修改前先用 `rg` 定位。
- `desktop/`：Electron 主进程、preload、窗口和系统集成。
- `build/`：应用图标、NSIS 安装器脚本、安装器视觉资源、after-pack 资源注入。
- `dist/`：本地构建产物，已被 git 忽略。根部只放当前发布资产。
- `updates/`：软件运行时更新区，已被 git 忽略。下载和补丁备份分开。
- `backups/`：人工归档/历史实验备份，已被 git 忽略。不要和 `updates/` 混用。
- `node_modules/`：依赖目录，通常不要手动整理。

## 本地分区约定

### dist 发布区

`dist` 根部只保留当前可发布资产。`v1.1.0` 安全发布只上传安装包、可选 blockmap 和 SHA256，不上传 `latest.yml`：

- `Susumusic-<version>-Setup.exe`
- `Susumusic-<version>-Setup.exe.blockmap`
- `Susumusic-<from>-to-<to>.patch.json`

其它内容放到：

- `dist/_archive/previous-releases/`：旧安装包和旧 blockmap。
- `dist/_archive/inconsistent-builds/`：和 `latest.yml` 不匹配的构建，保留但不用于发布。
- `dist/_previews/`：截图、安装器预览、图标预览。
- `dist/_logs/`：builder debug 等构建日志。

### updates 更新区

- `updates/downloads/`：运行时下载的完整安装包或更新资产。
- `updates/backups/patches/`：快速补丁覆盖文件前的备份。
- `updates/tmp/`：临时文件。

对应代码常量在 `server.js`：

- `UPDATE_WORK_DIR`
- `UPDATE_DOWNLOAD_DIR`
- `UPDATE_PATCH_BACKUP_DIR`

### backups 备份区

- `backups/public-html/`：历史前端实验 HTML。
- `backups/tool-cache/`：本地工具缓存或历史缓存文件。

这个目录是人工归档区，不参与软件更新流程。

## 每次任务完成后的固定动作

1. 更新本文件的「已完成工作日志」。
2. 如果发现新问题，更新「未完成/待确认事项」。
3. 如果整理了文件，更新「工作区地图」或「本地分区约定」。
4. 如果改了代码，至少运行相关语法检查或构建检查。
5. 如果改了安装包或更新逻辑，检查安装包、blockmap、校验文件和 GitHub Release 是否一致；安全发布时特别确认不要误上传 `latest.yml`。
6. 最后确认 `git status --short`，说明哪些已提交、哪些只是本地忽略产物。
