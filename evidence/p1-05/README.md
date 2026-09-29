# P1-05 人工授权真机驱动验收（决策 a：Cua 0.30.1）

> 运行方式：
> - `node evidence/p1-05/probe-cua-driver.mjs`（只读运行时探测：安装物、工具目录、窗口/应用发现、坐标、会话）
> - `node evidence/p1-05/run-p1-05.mjs`（真机输入验证：点击、输入、滚动、释放、拒绝）
> - `node evidence/p1-05/probe-reference-cancel.mjs`（当前参考 backend 的 disposable target 长按取消；需要解锁的交互式桌面）
>
> 原始结果：`cua-runtime-probe.json`（只读 20/20）、`input-verification.json`（输入 **27/27**）
> 状态：本文件记录的是已删除的历史 Cua 探针。后台点击、前台点击与原生文本输入曾实测；前台滚动在 2026-09-28 最新复跑未能复现（驱动称成功、目标记录 0 个 `wheel`），因此不属于当前生产能力。当前参考 backend 的点击、滚动、输入和真实取消释放证据分别见 `evidence/p1-06/`、`tests/reference-windows.test.ts` 与 `reference-cancel.json`；Chromium 文本输入、高权限窗口仍未验证。

## 1. 决策 (a) 的落地：已安装、已锁定、已验证哈希

| 项 | 实测 |
|---|---|
| `@trycua/cua-driver` | `0.30.1`，许可 `MIT` |
| `@trycua/cua-driver-win32-x64-msvc` | `0.30.1`，许可 **`MIT AND MPL-2.0`** |
| `cua_driver_sdk.dll` SHA-256 | 与 `evidence/p0-04/cua-artifact-manifest.json` **完全一致** |
| `cua_driver_node_runtime.node` SHA-256 | 与清单**完全一致** |

安装物与 P0-04 的制品取证逐一比对通过，因此"锁定的版本被真正安装"是可核验的事实，而不是声明。

## 2. 只读运行时探测（20/20）——P0-04 无法获得的运行时真相

P0-04 只能枚举 tarball 里的类型声明；本次驱动**实际运行**，得到：

| 事实 | 值 |
|---|---|
| 模块导入 / 驱动创建 / 关闭耗时 | 50 ms / 61 ms / 1 ms |
| `listWindows` 耗时 | 145–318 ms |
| `getDesktopState` 耗时 | 85 ms |
| 运行时工具目录 | **57 个工具**（`list_apps`、`list_windows`、`get_window_state`、`click`、`type_text`、`scroll`、`verify_state`、`start_session` …） |
| 窗口记录的 id 类型 | `bigint`（7/7）——与文档一致，不能当 number 用 |
| 窗口前序 | 有 `zIndex`（数值越大越靠前）——P1-06 绑定窗口身份需要 |
| 应用发现 | 309 个应用；`AppInfo.active` 表示**活动应用**，不是活动窗口 |
| 会话 | `startSession` / `getSessionState` / `endSession` 均可用；状态含 `desktopCaptureAuthorized`、`desktopUnlocked` |

### 2.1 坐标空间：P0-04 预言的 1.5 倍差异被实测确认

| 来源 | 值 |
|---|---|
| `getScreenSize`（驱动） | **1707×1067** @ `scale_factor 1.0` |
| 物理屏幕 | **2560×1600** |
| `listWindows` 的窗口 bounds（驱动） | 物理像素（示例 735×684，原点 189,135） |
| 同一窗口的 Electron DIP bounds | 502×462，原点 120,90 |
| 显示缩放 | `scaleFactor = 1.5` |

探测脚本把这条差异记为**结论数据**（`CONFIRMED MISMATCH`），而不是断言成功。

## 3. 真机输入验证

方法：**丢弃式自报目标**（`evidence/p1-05/target-app/`，一个 4×3 网格的 Electron 窗口）。每个格子记录"哪个格子收到了按下"以及"按下点在格子内的偏移"，并记录每一次 key down/up 与 mouse down/up。因此判定来自**应用实际收到的事件**，而不是驱动自己的"成功"摘要。

### 3.1 点击：4/4 命中，且落点在格子中心

| 瞄准格子 | 请求坐标 | 驱动投递点 | 实际落点 | 格内偏移 | down/up |
|---|---|---|---|---|---|
| `0,0` | (-2, 56) | (188,192) | `0,0` | (60,46) | 1/1 |
| `1,2` | (238, 146) | (428,282) | `1,2` | (60,46) | 1/1 |
| `2,3` | (358, 236) | (548,372) | `2,3` | (60,46) | 1/1 |
| `2,0` | (-2, 236) | (188,372) | `2,0` | (60,46) | 1/1 |

格子尺寸为 120×90，中心即 (60,45)。四次落点偏移全部为 (60,46)，即**精确落在各自格子的中心**（1 像素取整差），不是"碰巧落在格子里"。四个格子分布在不同的行与列，因此这不是单次侥幸。

投递模式为 `Background`，四次摘要均为 `(background, no foreground swap)`，即**没有提权、没有抢前台**。

### 3.2 点击坐标空间的实测结论（含一处不确定性，如实记录）

- 驱动摘要报告的投递点**等于目标自己算出的屏幕 DIP 坐标**（`screen.dipToScreenPoint`）。
- 请求坐标需要**减去驱动报告的窗口原点**（该原点为物理像素）。例如 `1,2`：屏幕 DIP (427,281) − 原点 (189,135) = (238,146)，投递点 (428,282)。
- **未能完全归一化的部分**：屏幕 DIP (427,281) 与物理 (641,422) 的关系为 `(P − 189) × 1.5 = 642`、`(281 − 135) × 1.5 = 219 ≠ 422`，即两者不是统一的位移+缩放。因此上面"减去原点"的规则是**按观察拟合的经验规则**，只在这台机器的这一个窗口位置上验证过 4 点，不是可证明的公式。

  风险提示：驱动自己的错误信息把 `foreground HWND` 以 `0x209ca` 这样的十六进制小整数打印（对应 133578），而 `listWindows` 给的是 `windowId`（另一空间）。这两个 id 空间不同，混用会指向错误窗口。**P1-06 必须先验证二者的对应关系**，不得假定。

### 3.3 输入：已验证落到目标（靠读回，不靠驱动摘要）

用**本脚本自己创建的临时文件**打开记事本（绝不触碰用户已打开的文件），再通过辅助功能树把文档内容读回：

| 断言 | 实测 |
|---|---|
| 后台输入被投递 | 驱动摘要：`Sent 10 char(s) to pid 2756 via PostMessage … **not verified** — could not read the focused field back` |
| **文本确实落到了目标** | 输入前文档**不含** `P1ORBTYPED`，输入后**包含** |
| 不把驱动摘要当作成功证据 | 驱动自己说 "not verified"，判定改由读回文档得出 |

这一条正是本阶段方法论的要点：驱动对自己是否成功并不可靠，必须由目标侧证实。

### 3.4 释放状态与取消

| 断言 | 实测 |
|---|---|
| 无按键残留 | `key-down=0 key-up=0`（平衡） |
| 无鼠标按键残留 | `mouse-down=4 mouse-up=4`（平衡） |
| 会话可启动/结束 | `endSession` → `{"session":"p1-05-verify","active":false}` |
| 会话结束后再查状态 | 明确报错 "this session has ended; call start_session explicitly to…" |
| 目标进程在整段序列后仍存活 | 是 |

网格目标记录每一次 down 与 up；但**不能用它判定按键残留**——置前脚本的 ALT 解锁会被 Windows 半途吞掉抬起（实测 34 下 1 抬而实际无键按住），故残留判定改用 OS 全局键态差分，见 §4.4。

## 4. 输入投递能力的真实边界（实测记录）

驱动自己的工具文档已写明关键约束，本次全部实测复现：

> `background`（默认）永不切换前台……对于输入栈会静默丢弃投递事件的目标（**Chromium/Electron 内容**、GTK 按钮、VCL/LibreOffice 加速键），工具返回结构化的 `background_unavailable` 错误而**不会**改走前台。`foreground` 是显式升级：短暂 `SetForegroundWindow` + `SendInput`，之后恢复原前台。

| 组合 | 实测结果 |
|---|---|
| 坐标点击 → Electron/Chromium 内容（后台） | **可用**（4/4 命中，不提权） |
| 坐标点击 → 同一窗口（**前台**） | **可用**（目标记录到真实 `mouse-down`；驱动报 `delivery_mode:foreground`） |
| `type_text` → Chromium 窗口类 | 拒绝：`Background delivery is not available ... (text_input)`，`errorCode=background_unavailable` |
| `scroll` → Chromium 窗口类（后台） | 拒绝：同上，`errorCode=background_unavailable` |
| `scroll` → Chromium 窗口类（**前台升级**） | **不稳定，逐次核验**：历史一次运行中目标记录到真实 `wheel` 并滚动；2026-09-28 最新复跑中目标为 0 个 `wheel`、`scrollTop` 未变，尽管驱动摘要称成功。不得只按驱动摘要判通过（见 §4.2） |
| `scroll` → Notepad（前台升级） | 驱动未拒绝；但该目标**无可读回的滚动区**，因此轮盘是否到达它在本脚本中不可观测，不计入结论（见 §4.3） |
| `type_text` → 记事本（后台） | **可用**（已由读回文档验证） |
| `hotkey` → 记事本 | 拒绝：XAML/UWP 目标找不到 UIA `AcceleratorKey` 或 `(Ctrl+X)` 名称提示 |
| `pressKey` → 记事本 | 投递并提示 "not verified" |
| UIA `set_value`（元素寻址） | Chromium 内容**不暴露**可编辑元素，因此该路径不适用于 Electron 内容 |

### 4.1 typed `ScrollInput` 无法表达 `delivery_mode`（本次找到的真实缺陷）

驱动拒绝后台滚动时明确要求：

> `Retry this action with delivery_mode:"foreground"; Cua Driver will activate the target for the action and restore the previous foreground afterward.`

但**锁定版本的 `ScrollInput` 并没有 `delivery_mode` 字段**（`ScrollInput.defaults()` 为空对象；只有 `ClickInput` 与 `VerifyStateInput` 带该字段）。也就是说：

- 用 `driver.scroll(ScrollInput.create({... deliveryMode}))` 传入该字段会被**静默丢弃**，并不会升级；
- 之前本阶段记录的“两种模式都被拒绝”因此**证明不了任何关于前台滚动的结论**——两次调用在字节上完全相同；
- 驱动官方要求的升级路径只能通过**通用工具接口**表达：`driver.callTool("scroll", {... delivery_mode: "foreground"})`（其参数与驱动的工具 schema 一致，schema 中 `scroll` 确实带 `delivery_mode: ["background","foreground"]`）。

**产品侧同样的缺陷已修复**（`src/main/cua-adapter.ts`）：适配器原先调用 typed `scroll` 且**忽略返回值**，因此永远无法升级；现已实现驱动规定的两步协议（先后台，仅在 `background_unavailable` 时用 `callTool` 升级），并保留 `pid`/`window_id`/坐标/方向/数量。

### 4.2 驱动的成功摘要不是证据（实测）

前台滚动会返回：

```
✅ Scrolled down via SendInput wheel (3 tick(s)) at screen (364,540) (delivery_mode:foreground).
isError=false
```

**本次复跑中目标窗口一个 wheel 事件都没收到。**更早的一次运行曾由目标日志确认 wheel 到达并滚动；把两次证据合并看，前台升级受 Windows 前台切换状态影响，不能稳定复现。结论：

- 驱动会在**前台切换被 OS 拒绝**时仍报成功；
- 因此判定必须读**目标自身的事件日志**（`wheel` 事件），不能读驱动摘要；
- 历史运行中滚动物理投递**成功过一次**（目标记录 22 个 `scroll` 事件）；本次最新复跑为 0 个 `wheel`。它取决于 Windows 是否愿意交出前台，属**逐次测量项**，不得写成稳定“已支持”。

**对产品的直接含义**：`background` 是唯一不抢用户前台的方式，但它在 Electron/Chromium 内容上**只支持坐标点击**；文本输入与滚动必须走 `foreground`（会切换前台）。产品可按驱动要求发起升级；其动作结果需看目标自身事件日志。本轮未收到事件，历史运行曾到达并生效，**不可将驱动摘要单独当作成功证据**。

### 4.3 本轮发现的三处「测试自己制造假阴性」（已修正，记录以免重蹈）

这三种错误都会让一个**可达的**动作看起来像「投递被拒」，因此很容易被误记成产品缺陷或 OS 限制：

| 缺陷 | 后果 | 修正 |
|---|---|---|
| Notepad 的滚动点**硬编码**为屏幕 `(40,120)` | 该点在 Notepad 窗口之外（其原点为 `(436,429)`），因此从未向 Notepad 瞄准过任何东西；看起来像「前台滚动失败」 | 改为由目标**自报的 bounds** 推导窗口内屏幕点，并标注该目标无可读回通道、不计入结论 |
| 计数器读 `scroll` 事件，而目标把滚轮记为 `wheel` | 一次运行中目标确实记录了 `wheel deltaY=300`，却被计为「未到达」（把「到达但滚动条未动」与「根本没到」混为一谈） | 改为计 `wheel`，并单独记录 `stripScrolled` 以区分「到达」与「到达且生效」 |
| 目标窗口高度不足，滚动条被裁到可视区之外（其中心 y≈393 而内容高 399） | 轮盘到达了瞄准点，但该点 hit-test 不到任何元素（`elementUnderPoint:null`），无法滚到目标元素 | 加高窗口，并让目标**自报可达性**（`centreResolvesToScroller`、`isScrollable`），用断言钉住 |
| 非网格目标的探测把**网格的**轮盘计数当成自己的结果 | 一个不同目标上的探测会显得携带了网格的事件数，可能错误地翻转总体结论 | `attemptScroll` 增加 `creditedToDeliveryVerdict`，非网格尝试的 `delivered`/`wheelEvents` 明确置 `null` |

### 4.4 按键残留不能用目标窗口的日志判定（实测）

早先版本用目标窗口日志里 `key-down` 与 `key-up` 的**计数相等**来判断「没有按键被留下」。这次运行报了 `down=34, up=1` —— 但**没有任何键真的被按住**：那 34 次是置前辅助脚本为解除前台锁而故意发的 ALT，而 Windows 在菜单模式下会吞掉单独的 ALT 抬起，目标因此只看到按下。

现在改为直接采样 **OS 全局键态**（`GetAsyncKeyState`，见 `evidence/lib/key-state.ps1`），在输入前后各取一次并**取差集**：只有「输入后按下、输入前没按下」的键才算残留。这同时免疫了测试自身的合成按键和用户恰好按住的键。目标日志仍保留，但明确标注它**不是**残留判据。

## 5. 为什么脚本没有发送任何东西到用户桌面之外

- 输入只发往两个丢弃式窗口：脚本自己启动的网格应用，以及脚本自己创建临时文件的记事本。
- 每次动作前检查目标是否为最前窗口；不是则**重试把它置前**（只对脚本自己启动的句柄），仍不是则**跳过并记录**（`safety.skippedForSafety`），绝不对其它窗口发键。
- 置前用的 `evidence/lib/activate-window.ps1` 只接受脚本自己取得的窗口句柄，且只发送唤醒组合键或什么都不发；**不对目标输入任何字符**。
- 未截图、未落盘像素、未触碰用户文档、未针对高权限窗口。

## 6. 明确未验证（逐项如实保留）

| 项 | 状态 |
|---|---|
| **截图点 ↔ 输入点一致性（联合断言）** | **自动化部分已通过**：P1-06 当前参考 backend 闭环在同一次运行内、从截图分数取点→经产品链路点击→目标自身 JSONL 命中 `1,2` 格（39/39）。**真实模型部分已通过**：C7 由真实模型自主调用 `orb_observe`→`orb_click`→`orb_observe`，目标日志命中 `0,0`；见 [`evidence/p1-06/README.md`](../p1-06/README.md) §5.1。 |
| **向 Chromium/Electron 内容输入文本** | 后台投递对该窗口类不可用；前台升级路径已实现，但未在本阶段做到稳定投递。**未验证**。 |
| 普通 vs 高权限窗口对比 | 未针对高权限窗口测试（按目标要求不自动提权）。 |
| 按下后取消的释放 | **已验证**：`probe-reference-cancel.mjs` 真实 native 长按取消后，目标自身日志收到 `mouse-down=1`、匹配 `mouse-up=1`，且 backend 正确报告取消；结果见 `reference-cancel.json`。 |
| 多显示器 | 本机仅 1 个显示器。 |
| 驱动内建“授权/权限”语义 | `getSessionState` 的 `desktopCaptureAuthorized=false`、`desktopUnlocked=false`；本阶段未使用 `escalate_session`。**产品侧的授权仍由 pi-orb 自己的任务授权与代次绑定负责**（P1-07）。 |

> 前台**点击**已由目标日志确认产生真实 `mouse-down`。前台滚动有一次历史成功证据，但最新复跑未重现；滚动仍须按每次目标日志判定，不能作为稳定支持能力。


### 人工验证步骤（需要真实前台窗口的会话）

```powershell
npm run build
node evidence/p1-05/run-p1-05.mjs
```

1. 保持一个真实窗口为前台（脚本会把自己的丢弃式网格窗口置前，无需手动准备）。
2. 重跑脚本：`scrollVerification.deliveredAndObserved` 与 `stripActuallyScrolled` 为 `true` 时，本次滚动物理到达目标**且目标元素真的滚动**。
3. 观察：前台投递是否在动作后**恢复原前台窗口**。
4. 记录前台投递时鼠标是否发生位移（`SendInput` 会移动真实指针）。
5. 截图点↔输入点的**联合**验证见 [`doc/manual-acceptance.md`](../doc/manual-acceptance.md) C7。

> 若为 `false`，先看 `notepadReachabilityProbe` 与网格的可达性字段，再看驱动是否真的换成了前台。注意：驱动**失败时也会报成功**，因此只能读目标事件。

## 7. 非破坏性确认

- 未修改 pi-web；未触碰其 `node_modules` 或 6 个既有改动文件。
- 未修改任何用户 Pi 配置或凭据。
- 只写 `D:\pi-orb-p1-runs\<本次运行>`（网格日志与几何）与 `evidence/p1-05/`。
- 无截图、无像素落盘、未对用户自己的文档或前台窗口发送输入。

## 8. 复现前置与清理

- 两个脚本都需要已安装的 `@trycua/cua-driver@0.30.1`（`npm install` 已包含）。
- `run-p1-05.mjs` 会自行创建临时文本文件与记事本实例，结束时 `taskkill` 关闭该实例；网格应用被 `kill`。
- 只读探测（`probe-cua-driver.mjs`）的桌面状态调用使用 `maxImageDimension: 1`，只记录图像元数据，不保存像素。
