# pi-orb

基于 [pi-web](https://github.com/agegr/pi-web) 的开源 Electron 桌面悬浮助手。在浮球中聊天、查看历史、分享截图，并让支持图像与工具调用的模型操作桌面。

pi-orb 通过 Pi 插件和小型 Electron 适配模块扩展现有 pi-web，复用它的会话引擎、模型配置、凭据和插件加载机制。参考项目的 13 个 Computer Use 工具和后台 `code_agent` 只在选定的 Orb 工作区注册；普通 Pi/Pi Web 会话保持原有行为。

**当前源码：`0.1.0-preview.3`，Windows x64 未签名预览版，尚未发布。** 已发布的 `preview.1` 使用旧安装流程；下面的个人用户流程适用于本地构建的 `preview.3`。完整 v0.1 的人工验收仍未完成，未验证（unverified）项见[支持矩阵](./doc/support-matrix.md)。

P1/P2 的实现与分阶段证据保留；个人用户安装与启动改进见下方流程。

[下载预览版](https://github.com/rain-knows/pi-orb/releases/tag/v0.1.0-preview.1) · [更新记录](./CHANGELOG.md) · [验证证据](./evidence/README.md) · [文档目录](./doc/README.md)

## 能做什么

- **悬浮聊天**：参考 Orb 的展开、收起、拖动、停靠动画、固定面板和系统主题；支持流式回复、连续提问、模型选择、历史会话和问题卡片。
- **截图上下文**：选择当前非 Orb 窗口，预览并确认后发送给模型；双 Alt 截图手势与 Windows 选中文字 chip 已接入，真实键盘和 UI Automation 体验仍待人工验收。
- **桌面工具**：使用参考项目的 `click`、`input_text`、`scroll`、`hotkey`、`long_press`、`drag`、`wait`、`long_wait`、`screenshot`、`open_in_browser`、`open_in_finder`、`list_apps` 和 `open_app`（激活或启动应用）；首帧自动附加，动作后返回新截图。
- **截图取点**：模型按截图的 0–1000 fraction 坐标定位；过期截图 token 只在 Electron bridge 内部校验，不进入模型参数。
- **后台任务**：`code_agent`、`code_agent_status` 和 `code_agent_stop` 将持续文件调查或产物生成交给独立 Pi Web session，完成后通知 Orb 前台。

新 Orb 会话及明确重新打开隐藏的 Orb 默认 **Full Access（完全访问）**，可以产生真实鼠标与键盘输入。请在开始任务前检查 Access；Stop、隐藏、断连、锁屏及会话/工作区切换会撤销旧授权。聚焦已经可见的 Orb 保留手动权限；正常回复结束保留当前会话的授权；截图消息仍需另行预览确认。授权边界见 [SECURITY.md](./SECURITY.md)。

## 快速开始

### 前置条件

- Windows x64；当前验证环境为 Windows 11，其他平台未验证。
- 已安装 Pi CLI，且 pi-web 可运行。当前源码基线为 Pi Web 0.10 / Pi SDK 1.0；具体版本与验证范围见[支持矩阵](./doc/support-matrix.md)和[升级记录](./doc/pi-web-0.10-compatibility.md)。已发布预览安装器仍是原发布产物。
- 桌面任务需要支持图像与工具调用的模型，模型与凭据在 pi-web 中配置。
- 自动启动 Pi Web 需要 Node.js `>=24.19.0`；从源码开发另需 npm 和 Git。使用安装包无需克隆本项目。

### 安装与启动

1. 从 [preview.3 Release](https://github.com/rain-knows/pi-orb/releases/tag/v0.1.0-preview.3) 下载并安装 `pi-orb-0.1.0-preview.3-win-x64.exe`。按用户安装，不请求提权；包含独立 Pi 插件，不包含 Pi Web/Node。它未签名，SmartScreen 的实际体验仍待验收。
2. 从开始菜单打开 **pi-orb**，或按 **Win+R** 输入 **`pi-orb`**。首次启动通过已安装 Pi CLI 自动注册随包插件，并备份 Pi 的用户设置；旧的同名本地 Orb 插件登记由官方 CLI 移除，不修改模型、凭据与其他插件。
3. 已有 Pi Web 服务会直接复用。尚未运行时，从全局安装或首次选定的 `bin/pi-web.js` 定位 Pi Web 包，直接隐藏启动其 Next.js 正式生产入口，等待就绪，不打开浏览器或终端。源码版 Pi Web 需先完成生产构建。默认地址为 `http://127.0.0.1:30141`。
4. 选择专用工作区，检查模型和 Access，再开始聊天。新会话默认完全访问；右键悬浮球或托盘选择「切换工作区…」可更换文件夹。切换先停止旧任务并清理旧上下文，历史仍可在原目录查看。重复运行 `pi-orb` 会唤回已有窗口；退出 Orb 保留共享 Pi Web 服务。

首次插件安装/更新后，正在运行的 Pi Web 可能尚未加载它；请等网页任务结束后，通过原有方式重启 Pi Web。Orb 不会重启已有服务或终止占用端口的进程。

安装器会在卸载前调用 Pi CLI 移除随包插件声明，并清理 Win+R 登记；保留模型、凭据、历史和工作区。若 Node/Pi CLI 已被移除导致插件清理失败，会提示手动执行 `pi remove "<安装目录>\resources\pi-plugin"`。
App Paths 支持 Win+R/ShellExecute；PowerShell 直接输入 `pi-orb` 不属于这个入口。

完整实现与验证见[个人用户安装与启动](./doc/personal-user-installation.md)。历史 [preview.1 Release](https://github.com/rain-knows/pi-orb/releases/tag/v0.1.0-preview.1) 不包含以上改进。

浏览器任务使用 `open_in_browser` 打开用户默认浏览器，再通过可见窗口截图工具完成操作；这与参考项目的 Computer Use 语义一致。DOM/Playwright 网关和浏览器扩展认证已移除，历史说明见[工具集对比报告](./doc/toolset-comparison-2026-10-04.md)。

### 从源码运行

开发模式不会自动安装插件或启动 Pi Web。在仓库根目录执行：

```powershell
npm ci
pi install "$PWD\pi-package"
# 通过你原有的 piweb 入口启动/重启 Pi Web
npm run dev
```

`npm run dev` 启动 Electron 与 renderer 热更新。开发源码插件仍引用本仓库；个人用户安装包携带独立构建。

### 连接配置

| 环境变量 | 用途 |
|---|---|
| `PI_ORB_PI_WEB_URL` | pi-web 地址，默认 `http://127.0.0.1:30141` |
| `PI_ORB_PI_WEB_PASSWORD` | pi-web 密码，仅由 Electron 主进程使用 |
| `PI_ORB_CONFIG` | 覆盖 Orb 配置路径；Electron 与 Pi 插件读取同一变量 |

凭据留在主进程，renderer 经沙箱 preload 桥访问功能。插件安装和首次工作区配置的细节见[人工验收说明](./doc/manual-acceptance.md) §1.1。

## 本版改进与验证边界

本版收敛了浮窗交互：输入草稿、焦点和问题卡片阻止自动收起；工具执行期间保留面板，临时使用截图排除与点击穿透；产品控件尽量中文化，工具进度采用紧凑状态行，并修正停止按钮与输入光标重叠。

桌面取点采用新插件参考的截图相对 0–1000 millifraction → HID 换算。模型请求只保留最新一张 Orb 工具截图，完整持久历史不变；生产动作后等待仍为 600ms。Koffi 精确锁定 `2.16.3`，包内只保留 Windows x64 运行时所需文件。

| 验证 | 已记录结果 | 边界 |
|---|---|---|
| 质量与发布门禁 | 483 个单元测试，P2-05 产物审计 30/30、打包 smoke 22/22 | 类型、lint、构建、插件加载、产物内容和 renderer 启动 |
| 后台任务 | 真实模型完成 8/8、产品桥停止 10/10、真实 provider 失败回读 12/12 | Pi Web 独立 worker；错误全文与单次通知一致，不代替 GUI 实测 |
| 真实模型 GUI 闭环 | 点击 20/20、滚动 21/21、输入 22/22、可见浏览器 22/22、应用冷启动 22/22 | 当前参考工具合同的有限样本；有目标自身读回和动作后新图，未宣称任意任务稳定成功 |
| 工具往返（迁移前历史） | 旧实现三动作批量中位 11.03s，单步中位 18.99s | 仅用于解释本次迁移动机；不代表当前工具协议或性能承诺 |
| 原生依赖 | 实际 Electron 中 1000 次枚举 + 50 次截图通过 | 有限压力样本，未确认历史间歇退出的精确根因 |
| Windows 打包 | 包内容审计 30/30，实际打包产物启动 22/22 | 不等同于干净机器安装、卸载或升级验收 |

完整来源与原始记录见[像素取点实施记录](./doc/plugin-reference-and-pointing.md)、[浮窗体验记录](./doc/orb-experience-improvements.md)和[支持矩阵](./doc/support-matrix.md)。

以下仍未验证：多显示器与 DPI 变化、高权限窗口、不同 Chromium 页面输入的稳定性、广泛跨应用流程、真实键盘/锁屏/休眠恢复，以及干净机器安装、卸载、升级和 SmartScreen 体验。历史失败和原生退出记录保留。preview.3 采用 GitHub **prerelease**，不宣称完整 v0.1 已完成。

## 开发与构建

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build

# 发布门禁
node evidence/p1-07/run-release-gate.mjs

# Windows x64：构建、审计内容、启动实际打包产物
node evidence/p2-05/run-p2-05.mjs

# 构建每用户 NSIS 安装器
npm run package:win
```

产物位于 `release/<version>/`。安装器未签名，无自动更新源；Pi 插件随包并在首次启动时通过官方 CLI 注册。发布流程见 [`doc/release-process.md`](./doc/release-process.md)，自动流程见 [`release-preview.yml`](./.github/workflows/release-preview.yml)。

## 项目边界与参考来源

产品形态、窗口结构、交互和 Windows 后端优先直接复用 [deepseek-harness-orb](https://github.com/rain-knows/deepseek-harness-orb)，旧单体基线固定于 `72f1d738458a223696685a909e806b683eff5885`。像素取点与图片尺寸语义参考 `dsh-orb-cordis@9cdc50302d202f4497569731be488a8afa500da7`。这些是源码研究/移植基线，不是运行时依赖。

开发从[参考手册](./doc/reference-playbook.md)定位原实现，遵循 [AGENTS.md](./AGENTS.md) 的复用约束，保留来源、许可证和适配说明。pi-orb 不复制 pi-web 的模型循环、凭据管理或插件加载机制。

- 非 Orb 工作区不新增工具、命令或 Orb prompt section。
- Stop、隐藏、断连、切换及退出撤权，释放正在进行的输入操作。
- 关闭/卸载 Orb 不应删除工作区文件或 pi-web 历史；完整卸载流程仍待人工验收。
- Orb 工作区不是文件系统沙箱；屏幕内容属于不可信输入。
- Pi 会无条件加载用户级 `~/.agents/skills`，因此普通会话也可能包含这些既有 skills；pi-orb 只承诺不主动改动它们。

| 目录 | 职责 |
|---|---|
| `src/main/` | Electron 窗口、pi-web 客户端、会话与原生桌面适配 |
| `src/preload/` | 沙箱 `contextBridge` 桥 |
| `src/renderer/` | 参考浮球 HTML/CSS/JS 与 Pi 界面模块 |
| `src/shared/` | 配置、协议、工具与坐标契约 |
| `pi-package/` | Pi Orb 插件 |
| `tests/`、`evidence/` | 单元测试与分阶段可复跑证据 |
| `doc/`、`resources/` | 阶段文档、图标与打包资源 |

贡献指南：[中文](./CONTRIBUTING.zh.md) / [English](./CONTRIBUTING.md)。项目采用 [MIT](./LICENSE) 许可证，复用源码与随包依赖的义务见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
