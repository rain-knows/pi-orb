# Windows 个人用户安装与启动

2026-10-04，`0.1.0-preview.2` 本地构建，尚未发布。目标是让已有 Pi/Pi Web 的用户无需
本项目源码即可安装，通过 Win+R 启动助手。支持范围仍以 `support-matrix.md` 为准。

## 使用流程

1. 先有 Node.js >=24.19.0、全局 Pi CLI 与已安装/构建的 Pi Web；模型和凭据沿用 Pi Web。
2. 运行每用户 NSIS 安装包，无管理员权限；Win+R 输入 `pi-orb`。
3. 首次启动自动通过 Pi CLI 注册随包插件，修改前备份用户设置。
4. 已有后端直接连接；未运行则使用全局官方入口。源码版首次选择 `bin/pi-web.js`，以后隐藏启动、等待就绪、不打开浏览器。
5. 选择专用工作区并检查模型与 Access。再次执行短命令唤回同一浮窗；退出 Orb 保留共享后端。

已有 Pi Web 未加载新插件时，提示网页任务结束后按原有方式重启。Orb 不会重启已有服务，
也不终止占用端口的其他进程。本机原 `piweb.cmd → piweb-launch-hidden.vbs → piweb.ps1`
保持原状；它会打开浏览器，Orb 使用官方入口的 `--no-open`。用户路径仅进入本机配置。

## 实现与职责

| 文件 | 职责 |
|---|---|
| `resources/installer.nsh` | 公开 NSIS hooks：用户级 App Paths 登记、归属检查后卸载清理、卸载前移除插件 |
| `scripts/build-pi-plugin.mjs` | 现有 Vite 构建独立 CJS 插件，复制已锁定浏览器依赖与许可 |
| `electron-builder.config.mjs` | 插件/依赖作为真实 resources/pi-plugin，排除 ASAR 中重复副本 |
| `src/main/personal-startup.ts` | 官方入口解析、插件登记、后端复用、端口拒绝、隐藏启动与日志 |
| `src/main/index.ts` | 初始化前取得单实例锁；再次运行复用 showOrb/presentOrb |

`%APPDATA%/pi-orb/startup-runtime.json` 保存明确的 Node/Pi/Pi Web 入口与插件摘要，不保存密码。
日志为同目录 `pi-web-startup.log`；Pi 设置备份为 `pi-settings-before-plugin-*.json`。
错误时保留配置并报告原因。App Paths 使用 HKCU 的
`Software/Microsoft/Windows/CurrentVersion/App Paths/pi-orb.exe`，默认值指向安装 EXE。
它用于 Win+R/ShellExecute，不修改系统 PATH，不保证 PowerShell 直接执行短命令。

第二实例在桥接、快捷键与退出清理前退出，不覆盖/删除主实例握手。初始化期间的唤回等窗口就绪。
随包插件无需源码检出，不含 Electron/原生驱动，不打入第二套 Pi SDK 或 typebox。
MCP/Playwright 有独立 node_modules 并保留许可；electron-builder 过滤映射根的 node_modules，
故用单独公开映射携带依赖。必须用真实 Pi 加载整个包验证，不能只检查 Electron 启动。

首次调用官方 `pi install <安装目录>/resources/pi-plugin`；Pi 可将路径保存为相对 settings 文件
的路径，按官方语义解析。旧同名本地 Orb 包经 CLI 移除；其他包、模型与凭据不修改。
原生工具继续限定专用工作区和会话授权，普通 Pi Web 保留公用浏览器工具。
开发模式及显式 PI_ORB_CONFIG 的证据进程不执行个人安装准备。

卸载前用 `--remove-bundled-plugin` 专用短进程调用 Pi CLI，随后清理本安装 App Paths。
不创建窗口/bridge。Node/Pi 已被移除则提示手动 pi remove；保留模型、凭据、历史和工作区。

## 验证

运行 typecheck、lint、单元测试及 `node evidence/p2-05/run-p2-05.mjs`。
该 runner 包含构建、内容审计、真实 Pi 加载独立插件、启动并驱动实际 Electron 产物。
`evidence/personal-startup/` 另记录：

- 独立中文/空格目录里的真实 Pi 加载；普通与 Orb 工作区断言完整工具清单。
- 隔离用户设置/工作区/随机端口，官方 CLI 注册、官方 Pi Web 隐藏启动、重复调用复用 PID、真实 API 创建 Orb 会话；测试模型不请求供应商。
- 实际 NSIS 安装、ShellExecute 短命令、再次唤回与卸载清理。开发机结果不外推到干净机器、人工 Win+R 或 SmartScreen。

最终记录为插件 4/4、后端 6/6、实际安装/卸载 8/8、包内容 30/30、打包启动 22/22。
当前账户另已完成默认用户目录安装，短命令、实际进程与后端、随包插件、工作区保留和模型/凭据
字节一致性共 7/7；见 `current-user-installation.json`。本机既有 Pi Web 入口已写入本机 runtime 配置，
个人路径不进入产品运行时默认值。

初次探针发现依赖遗漏，修复文件映射；工具数量断言与测试 API 遗漏 ensure_session 也已纠正。
失败记录保留，当前结论来自 JSON，不放宽权限断言。原有多显示器等未验证项仍保留。

## 参考来源与差异

已核对旧参考 HEAD 为 `72f1d738458a223696685a909e806b683eff5885`。
完整临时检出已不存在，打包源码经本地 git show 读取，没有修改参考检出。

| 来源 | 复用/适配 | 未直接移植原因 |
|---|---|---|
| 旧参考 apps/desktop/scripts/electron-builder-config.mjs:235,245-253 | electron-builder、NSIS、每用户无提权、未签名无更新源 | dsh Node/host 发布管道不适用于 Pi Web |
| 旧参考 apps/desktop/src/main.ts、welcome-api.ts | 保持唤醒语义；首次必要入口用原生文件选择 | 没有 Pi 包登记流程，不增加完整设置页面 |
| 本项目 showOrb/presentOrb 与 Electron 单实例 API | 重复运行经既有出口唤回 | 参考 main.ts 未发现 Electron 单实例锁，Win+R 反复执行需最小适配 |
| Pi 1.0 docs/packages.md | 本地包登记、相对路径、宿主 peer | 不搬 dsh 加载器，不改上游/node_modules |
| Pi Web 0.10 bin/pi-web.js、bin/pi-web-options.js | 官方 hostname/port/no-open 参数 | 本机包装脚本不作为分发依赖 |

官方依据：[Microsoft App Paths](https://learn.microsoft.com/en-us/windows/win32/shell/app-registration)、
[Electron 单实例](https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata)、
[electron-builder NSIS hooks](https://www.electron.build/docs/nsis/)。

完整新用户环境安装、代码签名、自动更新和其他平台属于后续范围。
