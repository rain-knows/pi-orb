# Windows 个人用户安装与启动

本页统一说明个人启动与工作区行为；快速安装步骤见 [项目 README](../README.md)，支持结论见 [支持矩阵](./support-matrix.md)。

当前账户的 `piorb` 短命令与本机脚本另见 [Win+R 入口记录](./winr-piorb.md)；下文描述安装器的 `pi-orb` 入口。

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
| `scripts/build-pi-plugin.mjs` | 现有 Vite 构建独立 CJS 插件，复制插件资源与许可 |
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
必须用真实 Pi loader 加载随包插件并验证普通/Orb/worker 的工具边界，不能只检查 Electron 启动。

首次调用官方 `pi install <安装目录>/resources/pi-plugin`；Pi 可将路径保存为相对 settings 文件
的路径，按官方语义解析。旧同名本地 Orb 包经 CLI 移除；其他包、模型与凭据不修改。
原生工具继续限定专用工作区和会话授权，普通 Pi Web 不新增 Orb 工具或提示。
开发模式及显式 PI_ORB_CONFIG 的证据进程不执行个人安装准备。

卸载前用 `--remove-bundled-plugin` 专用短进程调用 Pi CLI，随后清理本安装 App Paths。
不创建窗口/bridge。Node/Pi 已被移除则提示手动 pi remove；保留模型、凭据、历史和工作区。

## 工作区与界面

右键浮球或托盘选择「切换工作区…」。取消或再次选中同一目录不改会话。切换先撤权、取消旧 provider 和排队消息；停止成功后保存目录、增加 generation、写握手并创建新会话。旧历史保留，界面清除旧 transcript、草稿、选区、截图和历史列表，新会话使用默认 Full Access。

授权/撤权状态实时发送 renderer。隐藏启动从已验证 Pi Web 包解析 Next.js 正式生产入口，保留原 cwd/hostname/日志；已有后端直接复用，退出 Orb 保留共享服务。图标底板来自参考，主体替换为 π，托盘和窗口共用产品 PNG。

## 验证入口

- [个人启动证据](../evidence/personal-startup/README.md)：插件加载、后端复用、安装/卸载与数据保留。
- [Windows 工作区证据](../evidence/windows-startup-and-workspaces/README.md)：工作区生命周期、实时授权与无控制台升级探针；包含该阶段参考来源。
- [打包证据](../evidence/p2-05/README.md)：包内容和实际产物启动。
- 干净机、SmartScreen、多屏与真实键盘的步骤见 [人工验收](./manual-acceptance.md)。这些范围不由本机探针外推。

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
