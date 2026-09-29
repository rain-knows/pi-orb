# pi-orb 复用评估与 P1 解阻塞报告

更新时间：2026-09-29

参考仓库：[`rain-knows/deepseek-harness-orb`](https://github.com/rain-knows/deepseek-harness-orb)，提交
`72f1d738458a223696685a909e806b683eff5885`。

## 1. 结论

pi-orb 的复用默认值应是“先复用参考项目已经跑通的软件实现，再证明本项目确实需要不同设计”。
参考项目的 Computer Use 后端、坐标、窗口激活、SendInput、剪贴板输入、工具行为和相关测试应
作为 pi-orb Windows 桌面能力的首选实现来源；只有被 pi-web 集成、产品交互或平台差异明确要求的
边界，才保留本项目实现。不得以抽象的“风险较高”“架构不同”作为拒绝复用的理由。

已从上游固定提交 `72f1d738458a223696685a909e806b683eff5885` 验证 Win32 输入后端，并直接复用
其 `koffi + SendInput + per-monitor DPI + foreground activation + clipboard paste` 路径。
后续评估以同样原则检查整套工具与产品流程，并删除工程化不足、重复实现或只为旧路径兜底的代码。

## 2. 复用边界

| 参考项目内容 | 决定 | 原因与落点 |
|---|---|---|
| 0–1000 截图坐标、窗口矩形映射 | 优先采用上游实现和契约 | 对照 `coordinates.ts`，不再独立发明坐标定义；本项目测试只补产品集成验证 |
| 观察、动作结果、下一步流程 | 优先复用上游工具协议和编排行为 | 以参考实现的消息/工具返回语义为基线，删去不能带来 pi-web 集成价值的重复包装 |
| 工具面与工具实现 | 逐个复用参考项目成熟实现 | 先比较上游全部工具、schema、handler、backend、测试和生命周期，再决定需删改的最小集；不得只挑局部思路后重新实现同一能力 |
| Windows 桌面后端 | **生产实现直接复用** `windows.ts`、`windows-native.ts`、`windows-foreground.ts`、`coordinates.ts` 和其测试模式 | 已导入 `src/main/reference-windows/`，由 `reference-windows-driver.ts` 接入 broker；Cua action path、foreground escalation 和局部 native fallback 已删除 |
| 窗口识别、激活、overlay 排除 | 优先复用上游成熟筛选逻辑 | 和 Orb 窗口/目标授权结合时，只添加必要 predicate；不能重写一套竞争性的窗口枚举后端 |
| 剪贴板 typeText | 采用上游保留/恢复流程 | 文本输入目标侧读回验证；遇到取消或异常也必须恢复剪贴板与键态 |
| Orb 授权、generation、pi-web/bridge 接入 | 仅保留产品边界所需实现 | 评估并压缩 `desktop-task`、`desktop-broker`、bridge 的重复策略；上游已有的能力不应在这些层复制 |
| Cordis/DSH session、preset、plugin 架构 | 按产品集成确需保留的地方适配 | pi-orb 使用 pi-web/Pi 会话，因此不需要维护第二个模型循环；其余可复用的工具模块仍应直接复用 |
| macOS、多屏与其它平台能力 | 直接复用上游平台实现后再集成验证 | 不因当前 Windows 首发而先造替代抽象；发布范围由实测结果确定 |

## 2.1 当前代码处置清单

参考包 `@deepseek-ai/dsh-experimental-tool-computer-use@0.1.7-rc.1` 是私有 pnpm workspace 包，peer 依赖 DSH/Cordis 内部包，不能当作 pi-orb 可直接安装的独立库。正确的复用方式是保留 MIT 通知，移植它的独立 backend/算法/测试，再接 pi-orb 自己的 Pi session 与授权边界。

| pi-orb 当前模块 | 处置 | 上游依据 / 需要做的事 |
|---|---|---|
| `src/main/cua-adapter.ts` | **已删除** | Cua SDK、类型桥、foreground escalation 和 Chromium 专用旁路不再进入生产构建 |
| `src/main/windows-native-input.ts` | **已删除** | 局部滚轮/粘贴实现被参考 backend 的完整 SendInput、DPI、焦点、UIPI 和 clipboard 路径替代 |
| `src/main/desktop-capture.ts`、`src/main/target-window.ts` | **保留产品截图边界，复用目标身份契约** | 截图预览仍由 Electron `desktopCapturer` 提供，这是用户确认/上传流程的产品边界；桌面工具观察和输入使用参考 backend 的 GDI/物理像素路径。两条路径共享记录的 HWND/PID/title 校验，不把截图流程重复改造成另一套模型附件协议。 |
| `src/shared/orb-tools.ts`、`tests/coordinate-mapping.test.ts` | **保留 Pi 工具 schema；移植共用算法与测试** | 保留 `orb_observe/click/type/scroll` 的 Pi schema 和观察 ID；坐标验证、0–1000 映射及边界测试以 `coordinates.ts` / `coordinates.spec.ts` 为准，删除 Cua window-relative 坐标拟合。 |
| `src/main/desktop-task.ts`、`src/main/desktop-broker.ts` | **保留最小授权边界，删重复执行策略** | 上游 `plugin.ts`/`policy.ts` 的一次观察一次动作、动作后复看和失败停止模式可直接复用；本项目仍需 session/generation 绑定、显式用户批准和 named-pipe 校验。不得搬后台自动审批。合并重复的授权、限额与失败状态逻辑。 |
| `src/main/window-lifecycle.ts`、`src/main/window-toggle.ts`、`src/main/index.ts` | **保留产品生命周期，移植 overlay 行为** | 参考 `overlay-guard.ts`：capture 时排除 Orb、HID 时 click-through、完成/异常/取消时恢复；托盘、快捷键和 pi-web 会话管理不搬上游。 |
| `src/main/screenshot-flow.ts`、`src/main/pending-capture.ts` | **保留** | “预览→用户确认→发送给当前 Pi 会话”是 pi-orb 的产品授权流程，上游附件持久化和模型循环不适用。复用其 observation frame / overlay 排除原则，不能复制上游自动附图流程。 |
| `src/main/pi-web-client.ts`、`src/main/orb-session.ts`、`pi-package/extensions/*`、`src/main/bridge-server.ts` | **保留并独立维护** | 这是 pi-web/Pi 的集成与权限边界，参考项目的 Cordis、DSH session、preset、附件协议不能替换它。只复用上游工具结果、动作后观察及失败语义。 |
| `tests/cua-adapter.test.ts` | **已删除** | Cua 契约测试不再反映生产代码；保留参考 backend 行为测试和 `reference-windows-driver.test.ts` 合同测试 |
| `@trycua/cua-driver` 运行依赖 | **删除** | Cua 证据脚本和历史 JSON 可以留在 `evidence/`；产品构建不再加载 Cua，也不在 native backend 失败时退回 Cua。 |

当前实现已经完成上述收敛：桌面窗口观察、点击、输入和滚动统一使用参考项目 Windows backend；截图预览继续由 Electron `desktopCapturer` 负责，因为它属于 Orb 的用户确认与附件发送边界。Orb 只保留目标身份、授权、generation、bridge 与 Pi 会话边界。

## 3. P1 状态与最短路径

| 项 | 当前结论 | 最短下一步 |
|---|---|---|
| C7 真实模型观察→点击→再观察 | 当前参考 backend 已通过（24/24，目标日志命中 `0,0`） | 已写入 `real-model-c7-reference-backend.json` |
| A4 长按快捷键 | 代码和真实 Electron + native hook 集成探针通过；探针使用合成 F24 输入 | 用真实键盘长按一次；不能用 cooldown 代替 key-up |
| A5 托盘开/收 | 状态机已修复，单测通过 | 重启 Electron 后实际点击托盘两次 |
| B9 仅文本模型截图 | 隔离链路通过，旧进程未复测 | 重启当前 Orb，再用仅文本模型执行一次截图任务 |
| D6 真实模型滚动 | 当前参考 backend 已通过（25/25，目标日志有 `wheel` 且 `scrollTop` 改变） | 已写入 `real-model-d6-scroll-reference-backend.json` |
| D8 真实模型输入 | 当前参考 backend 已通过（25/25，目标日志读回 `P1ORBD8TEST`） | 已写入 `real-model-d8-type-reference-backend.json` |
| 多屏/高权限 | 未验证 | 各自使用独立目标和目标自身日志，不合并为一个“综合通过” |

## 4. 验收门槛

自动证据当前为：Vitest 384/384（含移植的参考规格测试 23 条与 open-app 收窄规则 7 条）、P1-03 OS 探针通过、P1-06 当前参考
backend 真实模型 C7/D6/D8 通过、P1-07 release gate 47/47、生命周期回归 10/10、P2-05 产物内容审计
25/25 与打包产物启动探测 10/10、TypeScript/ESLint/build 通过。A4/A5 仍需人工真实键盘/托盘复测；
P2-05 的干净机安装／卸载／升级与 SmartScreen、以及 `orb_open_app` 的真机效果属人工项。

P1-05/C6 审计发现 broker 原先没有把撤权传播给正在执行的 native action，因此只验证 backend 的
`AbortSignal` 释放不足以证明产品 Stop 可用。现已接通 broker → driver → 参考 backend 的取消信号；
Stop 在等待 pi-web 协作式 abort 前先撤权，撤权/换授权会立即 abort 当前 action，迟到的旧 action
结果不会污染新授权。取消释放单测已覆盖 click、drag、hotkey，以及撤权期间 action 的竞态。
同一撤权出口也在 Pi turn `idle/error` 时执行，确保一次模型回合结束或失败后不会保留桌面授权、目标
窗口记录或未确认截图。
真实 Win32 长按探针 `evidence/p1-05/probe-reference-cancel.mjs` 已通过：目标自身日志收到
`mouse-down=1` 与匹配的 `mouse-up=1`，取消错误也正确上报；结果见
`evidence/p1-05/reference-cancel.json`。测试夹具补上显式 `win.show()`，解决部分 Electron
桌面会话中 `show: true` 后 HWND 仍报告隐藏的显示时序问题。

本轮还修复了一个会把动作结果误判成 observation 的扩展渲染缺陷：动作结果同样带 `observationId`，旧判别因此读取不存在的 `coordinateSpace.windowRect`；现在只有同时具备 observation 结构的结果才走 observation 摘要，回归测试见 `tests/orb-extension.test.ts`。

文档策略：新功能首先查阅参考项目固定版本的 source、tests、package docs 和类型定义；能复用就
直接复用并记录 commit/path/license。仅在集成边界或实测证明不适合时改写，改写需写明具体阻碍与
证据。遇到旧方案失效，删除旧代码路径，不增加兼容层、双轨或迁移分支。优先完成一个能端到端运行
的软件版本，再扩展平台与功能。

当前代码债务的明确处理结果：参考项目原生 backend 已成为唯一生产 `DesktopBackend`，Cua 运行时依赖、adapter、foreground escalation 和局部 fallback 已删除；
`evidence/p0-04`、`evidence/p1-05` 的 Cua 探针作为历史证据保留，但不再由产品运行时加载。D6
只有目标日志出现 `wheel` 且 `scrollTop` 改变后才可标记通过。

完成完整 v0.1 前，必须把仍列在 [`support-matrix.md`](./support-matrix.md) §3 的每一项取得
明确结论；无法构造的环境项继续标记为“未验证”，不得通过删除记录来变绿。

