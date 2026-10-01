# Orb 通用桌面交互改进（2026-09-30）

参考固定提交：`rain-knows/deepseek-harness-orb@72f1d738458a223696685a909e806b683eff5885`，MIT。原文件见 `packages/experimental/tool-computer-use/src/windows-foreground.ts`、`windows.ts`、`overlay-guard.ts`、`capture-exclude.ts`、`config.ts`，以及 `apps/desktop/src/orb-permission.ts`、`apps/desktop/renderer/floating.{html,css,js}`。来源和许可证见 `THIRD_PARTY_NOTICES.md`。

| 用户反馈 | 本轮实现 | 参考复用与 Pi 差异 |
|---|---|---|
| 快捷键锁定目标限制使用 | 截图按钮在点击时选择当前最上层的非 Orb 应用；桌面工具观察不依赖唤醒来源 | 直接调用参考的 `selectWindowsObservation`；截图仍走 Pi 的逐张预览确认 |
| 非前端应用无法操作 | 原生应用使用 Win32 顶层窗口、HWND、DPI 和 GDI/HID 后端；文件、命令及后台工作直接使用 Pi 已有 `read/write/edit/bash`，无需先有桌面 observation | 参考 `tool-computer-use/README.md:199-209` 的 GUI／命令分工；不搬 DSH `code_agent` 会话引擎，使用 Pi 原有工具和会话机制 |
| 工具调用慢 | 保留参考默认 600ms 动作后等待，避免抢拍菜单和弹窗；本轮未缩短 | 参考 `config.ts` 的 `postActionWaitMs=600`；后续应先测真实操作耗时和截图耗时再优化 |
| 工具调用显示生硬 | 工具过程改为参考面板色彩和圆角体系的紧凑状态行，区分执行中、完成、失败，并对 Orb 工具名显示中文 | 参考 `floating.css` 的令牌和历史／问题卡片；Pi 工具事件仍由 `OrbSessionController` 映射 |
| 输入时面板收起 | 焦点在输入框、未发送草稿或待回答问题存在时，阻止 hover 自动收起；失焦且无草稿后恢复原 180ms 收起 | 沿用参考 hover/pin 状态机，补 Pi 可连续输入的状态条件 |
| 桌面工具期间面板闪烁 | 删除整窗 `hide/showInactive`，直接移植参考的 `applyFloatingOverlayGuard`；操作期间保持 transcript 可见、临时点击穿透和 GDI 排除；嵌套调用计数恢复 | `apps/desktop/src/floating-window.ts:848-868,906-961` → `src/main/floating-overlay-guard.ts`；80ms 等待沿用参考，Pi 主进程直接配对 begin/end，无 DSH IPC |
| 通用操作 | 观察采用参考的前台或下一合格顶层窗口规则，排除 Orb 窗口和系统壳；动作前拒绝目标变化，动作后返回新窗口的 fresh observation | 保留 Pi 的 generation、授权和陈旧 observation 检查 |
| 默认 Full Access | 新 Orb session 自动绑定 `full-access` grant；手动改档有效；Stop/hide/断连立即撤权；2026-10-01 明确重开隐藏的 Orb 也选择完全访问，聚焦已显示窗口保留档位 | 参考 `orb-permission.ts` 默认 `danger-full-access`；Pi grant 不跨 session 持久化；新验证见 `doc/session-continuity.md` |
| 页面中文 | 主面板、权限、截图、模型、历史、工具状态和托盘／右键菜单文案改中文；模型名、应用名和用户内容保留原文 | UI 文案适配，不改参考 DOM 和三档语义 |
| 暂停按钮与光标重叠 | 执行中空输入框隐藏占位字和闪烁光标，缩小停止按钮并使用方形停止图标；输入新文本时光标正常出现 | 仅在参考几何上做 Pi queue 所需的覆盖样式 |

截图预览和桌面工具仍是两条权限路径：桌面工具要求 Orb session 的 Access grant；用户主动分享截图须预览确认。普通 Pi Web 会话不会自动获得 Orb 工具。`orb_open_app` 仍只激活已运行应用，不启动新程序。

验证：`tests/reference-windows-driver.test.ts` 覆盖 Orb 前台下的原生窗口、动作前窗口变化拒绝、动作后新窗口观察；`tests/floating-renderer.test.ts` 覆盖输入和提问时不收起、工具状态和中文权限；`tests/floating-overlay-guard.test.ts` 直接移植参考 5 项，覆盖嵌套恢复、输入期间不转发鼠标事件、不重复 blur。完整测试、lint、build、生命周期及打包探针的实测结果见下方记录。原生应用和真实模型跨应用长任务不能由 JSDOM 或伪造 Pi Web 事件代替。

## 实测记录

- `npm test`：42 文件、438 项通过；`npm run lint`、`npm run build` 通过。
- `node evidence/p1-07/run-lifecycle-regression.mjs`：当前 18/18 通过。实际隔离 Pi Web + 本地测试模型，验证默认完全访问、手动改档、连续三轮保权、Stop 不重授、隐藏撤权、明确重开默认值、工具之间光效持续与 idle 隐藏、换工作区／新会话绑定新 grant、断连撤权。
- 第一轮服务初始化曾出现 `fetch failed`，失败原件保存在 `evidence/p1-07/session-access-regression-startup-failure.json`。排查时补上 `OrbSessionController` 并发创建去重和过期创建拒绝，避免默认授权初始化与发消息创建出不同会话；失败后的再次创建、旧 generation 晚到和并发请求均有测试。当前通过记录不代表外部 Pi Web 永远可用。
- `node evidence/p2-05/run-p2-05.mjs`：内容审计 25/25、打包产物启动 22/22 通过。
- `node evidence/frontend-port/probe-interactions.mjs`：实际打包 Electron 的中文权限、草稿保持、工具卡片、问题、历史、停靠及 reduced-motion 通过。计算样式确认空运行输入的 caret 为透明、占位符为空、Stop 宽 36px；截图见 `after-tool-running.png`。
- 同一打包探针另经真实 bridge／broker／Win32 驱动选择一次性目标，Orb 前台下不使用快捷键锁定，按目标自己报告的几何点击 `0,0`，目标日志确认只收到一次 `0,0` 点击，并返回 fresh observation。记录在 `evidence/frontend-port/native-target-probe.json`，这是实际原生输入证据，**不是模型视觉决策或任意应用的后台点击证据**。
- 真实模型自主跨应用长任务、高权限窗口、多屏／DPI、任意原生软件仍未完成联合验收；本轮没有改写之前 C7/D6/D8 的失败记录。自动启动应用仍未开放，文件／命令任务依赖当前 Pi 会话实际已启用的工具。
