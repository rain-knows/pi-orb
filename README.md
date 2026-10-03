# pi-orb

基于 [pi-web](https://github.com/agegr/pi-web) 的开源 Electron 桌面悬浮助手。在浮球中聊天、查看历史、分享截图，并让支持图像与工具调用的模型操作桌面。

pi-orb 通过 Pi 插件和小型 Electron 适配模块扩展现有 pi-web，复用它的会话引擎、模型配置、凭据和插件加载机制。原生桌面工具只在选定的 Orb 工作区注册；Playwright 浏览器工具按用户要求开放给普通 Pi/Pi Web 会话。

**当前版本：`0.1.0-preview.1`，Windows x64 未签名预览版。** P1/P2 已有实现和分阶段证据，但尚未完成完整 v0.1 的人工验收。未验证（unverified）项见[支持矩阵](./doc/support-matrix.md)。

[下载预览版](https://github.com/rain-knows/pi-orb/releases/tag/v0.1.0-preview.1) · [更新记录](./CHANGELOG.md) · [验证证据](./evidence/README.md) · [文档目录](./doc/README.md)

## 能做什么

- **悬浮聊天**：参考 Orb 的展开、收起、拖动、停靠动画、固定面板和系统主题；支持流式回复、连续提问、模型选择、历史会话和问题卡片。
- **截图上下文**：选择当前非 Orb 窗口，预览并确认后发送给模型；双 Alt 截图手势与 Windows 选中文字 chip 已接入，真实键盘和 UI Automation 体验仍待人工验收。
- **桌面工具**：观察、点击、输入、滚动、热键、长按、同窗口拖拽、等待、查询应用和激活已运行应用；动作后返回新观察。文件操作与后台任务使用 Pi 原有工具。
- **像素取点**：模型按 Pi 实际附加截图的像素坐标定位；观察绑定会话、代次和编号，过期观察与越界坐标会被拒绝。
- **串行批量**：`orb_batch` 一次提交 2–8 个初始截图中已经可见、互相独立的动作。逐步执行、逐步观察，失败或取消时停止剩余动作。

新 Orb 会话及明确重新打开隐藏的 Orb 默认 **Full Access（完全访问）**，可以产生真实鼠标与键盘输入。请在开始任务前检查 Access；Stop、隐藏、断连、锁屏及会话/工作区切换会撤销旧授权。聚焦已经可见的 Orb 保留手动权限；正常回复结束保留当前会话的授权；截图消息仍需另行预览确认。授权边界见 [SECURITY.md](./SECURITY.md)。

## 快速开始

### 前置条件

- Windows x64；当前验证环境为 Windows 11，其他平台未验证。
- 已安装 Pi CLI，且 pi-web 可运行。当前源码基线为 Pi Web 0.10 / Pi SDK 1.0；具体版本与验证范围见[支持矩阵](./doc/support-matrix.md)和[升级记录](./doc/pi-web-0.10-compatibility.md)。已发布预览安装器仍是原发布产物。
- 桌面任务需要支持图像与工具调用的模型，模型与凭据在 pi-web 中配置。
- 从源码运行需要 Node.js `>=24.19.0`、npm 和 Git。

### 安装与启动

1. 从 [Release](https://github.com/rain-knows/pi-orb/releases/tag/v0.1.0-preview.1) 下载 `pi-orb-0.1.0-preview.1-win-x64.exe` 并安装。安装器按用户安装，不请求提权，也不包含 pi-web。它未签名，Windows 可能提示未知发布者；SmartScreen 的实际体验仍待验收。
2. 取得同版本源码并安装 Pi 插件。**安装器不包含 Pi 插件**；插件会引用仓库中的 `src/shared/`，请保留完整检出目录。

   ```powershell
   git clone --branch v0.1.0-preview.1 https://github.com/rain-knows/pi-orb.git
   cd pi-orb
   npm ci
   pi install "$PWD\pi-package"
   pi list
   ```

3. 启动现有 pi-web：

   ```powershell
   piweb
   ```

   如果安装插件时 pi-web 已经运行，请通过你原有的启动方式重启它，让 Pi 重新加载插件声明。

4. 从开始菜单打开 **pi-orb**，选择一个专用工作区，检查模型和 Access，再开始聊天或桌面任务。默认连接地址为 `http://127.0.0.1:30141`。

未安装插件时，浮窗聊天仍可连接 pi-web，但模型不会获得 `orb_*` 工具。安装插件仅声明本地包，不复制目录，也不会自动授予其他工作区桌面能力。移除声明可运行 `pi remove "$PWD\pi-package"`（在仓库根目录中执行），然后重启 pi-web。

浏览器任务使用公用 `orb_browser`（Playwright 浏览器）与 [Playwright Chrome 扩展](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm) 连接现有登录标签页。普通 Pi/Pi Web 无需启动 Orb；Orb 会话保留完全访问、Stop 撤权与光效。用户目录中配置扩展 token 后自动认证，无需改全局 MCP 配置或另装 CLI。[公用工具与认证配置](./doc/public-playwright.md)，[B 站验证记录](./doc/session-continuity.md)。

### 从源码运行

完成上面的插件安装并启动 pi-web 后，在仓库根目录运行：

```powershell
npm run dev
```

`npm run dev` 启动 Electron 与 renderer 热更新。pi-orb 不会替你启动、重启或关闭现有 pi-web。

### 连接配置

| 环境变量 | 用途 |
|---|---|
| `PI_ORB_PI_WEB_URL` | pi-web 地址，默认 `http://127.0.0.1:30141` |
| `PI_ORB_PI_WEB_PASSWORD` | pi-web 密码，仅由 Electron 主进程使用 |
| `PI_ORB_CONFIG` | 覆盖 Orb 配置路径；Electron 与 Pi 插件读取同一变量 |

凭据留在主进程，renderer 经沙箱 preload 桥访问功能。插件安装和首次工作区配置的细节见[人工验收说明](./doc/manual-acceptance.md) §1.1。

## 本版改进与验证边界

本版收敛了浮窗交互：输入草稿、焦点和问题卡片阻止自动收起；工具执行期间保留面板，临时使用截图排除与点击穿透；产品控件尽量中文化，工具进度采用紧凑状态行，并修正停止按钮与输入光标重叠。

桌面取点采用新插件参考的图片尺寸解析与 pixel → HID 换算。模型请求只保留最新一张 Orb 工具截图，完整持久历史不变；生产动作后等待仍为 600ms。Koffi 精确锁定 `2.16.3`，包内只保留 Windows x64 运行时所需文件。

| 验证 | 已记录结果 | 边界 |
|---|---|---|
| 质量与发布门禁 | 461 个单元测试，门禁 66/66 | 类型、lint、构建、许可、版本、证据及非破坏性检查 |
| 真实模型像素取点 | 紧凑及 28×24 DIP 控件，三个完整轮次共 21/21 任务 | 专用夹具与单一模型；不能外推到任意应用 |
| 工具往返 | 最新小控件轮次：三动作批量中位 11.03s，单步中位 18.99s | 每模式仅三个样本，不承诺普遍提速 |
| 原生依赖 | 实际 Electron 中 1000 次枚举 + 50 次截图通过 | 有限压力样本，未确认历史间歇退出的精确根因 |
| Windows 打包 | 包内容审计 27/27，实际打包产物启动 22/22 | 不等同于干净机器安装、卸载或升级验收 |

完整来源与原始记录见[像素取点实施记录](./doc/plugin-reference-and-pointing.md)、[浮窗体验记录](./doc/orb-experience-improvements.md)和[支持矩阵](./doc/support-matrix.md)。

以下仍未验证：多显示器与 DPI 变化、高权限窗口、Chromium/Electron 内容输入、跨应用真实模型流程、真实键盘/锁屏/休眠恢复，以及干净机器安装、卸载、升级和 SmartScreen 体验。历史失败和原生退出记录原样保留。本版按 GitHub **prerelease** 发布，不宣称完整 v0.1 已完成。

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

产物位于 `release/<version>/`。安装器未签名，无自动更新源；Pi 插件仍按上面的独立步骤安装。发布流程见 [`doc/release-process.md`](./doc/release-process.md)，自动流程见 [`release-preview.yml`](./.github/workflows/release-preview.yml)。

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
