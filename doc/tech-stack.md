# pi-orb 技术栈

本页只记录选择理由；精确版本查 [package.json](../package.json) 和 lockfile，支持范围查 [支持矩阵](./support-matrix.md)。

## 1. 实现边界

pi-orb 使用 TypeScript、Electron 和 Pi 扩展接入现有 pi-web。模块分工见 [开发目标](./pi-orb-development-goals.md) §4；源码取材见 [参考手册](./reference-playbook.md)。

## 2. 已采用的依赖

| 依赖 | 用途与选择理由 |
|---|---|
| Electron | 主进程窗口、托盘、快捷键、截图及受限 preload |
| Pi SDK | 公开扩展 API 和类型；会话、模型循环、凭据与插件加载由宿主管理 |
| Koffi | 已移植参考 Windows backend 的 Win32 FFI；不再使用 Cua 生产路径 |
| uiohook-napi | 快捷键松开边沿和双 Alt 手势；复用现有 hook |
| electron-vite / Vite | 主进程、preload、renderer 及独立 Pi 插件构建 |
| electron-builder | 每用户 NSIS、原生模块解包与独立插件资源，见 [打包依据](./p2-05-distribution.md) |
| TypeScript / ESLint / Vitest / JSDOM | 类型、静态检查、协议与参考 renderer 行为验证 |

renderer 直接移植参考 HTML/CSS/JS，Pi 模块只替换宿主协议；不维护第二套 UI 框架。浏览器操作使用参考 GUI 工具，无 DOM/MCP 网关依赖。精确参数和裁剪配置以构建文件为准。

## 3. 接入与数据边界

### 3.1 Electron 与 preload

renderer 使用 context isolation、sandbox 和 `nodeIntegration: false`，只通过受限 contextBridge IPC 调用主进程。密码、命名管道 token 和原生驱动留在主进程。

### 3.2 Pi 与 pi-web

Pi 扩展通过认证的 Windows named pipe 调用 Electron。Pi Web 通过公开 HTTP/SSE 管理会话与后台 worker。session/generation、授权和观察新鲜度校验属于小型适配层，不进入模型工具协议。事件边界见 [Pi 1.0 升级记录](./pi-web-0.10-compatibility.md)。

### 3.3 桌面与配置

Windows backend 复用参考 Win32、GDI、SendInput 和剪贴板实现。坐标只使用截图相对 0–1000 millifraction，见参考手册 §6.3。配置和日志位于 Orb 自有 userData；模型与凭据沿用 Pi。个人启动、插件登记和共享服务归属见 [安装文档](./personal-user-installation.md)。

## 4. 验证

类型、Lint 和单测验证适配合同；包内容审计与启动探针验证实际产物；真实桌面效果由目标自身读回确认。命令见 [项目 README](../README.md)，无法由自动化覆盖的项目见 [人工验收](./manual-acceptance.md)。
