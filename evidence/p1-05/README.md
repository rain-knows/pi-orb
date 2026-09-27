# P1-05 人工授权真机驱动验收（决策 a：Cua 0.30.1）

> 运行方式：
> - `node evidence/p1-05/probe-cua-driver.mjs`（只读运行时探测：安装物、工具目录、窗口/应用发现、坐标、会话）
> - `node evidence/p1-05/run-p1-05.mjs`（真机输入验证：点击、输入、滚动、释放、拒绝）
>
> 原始结果：`cua-runtime-probe.json`（只读 20/20）、`input-verification.json`（输入 20/20）
> 状态：**点击与输入已验证**；**滚动、前台投递路径、截图点↔输入点一致性在本机未验证**，原因见 §6。

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

## 3. 真机输入验证（20/20）

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

网格目标记录每一次 down 与 up，因此"按键卡住"会表现为不配对的 down——本机未出现。

## 4. 输入投递能力的真实边界（实测记录）

驱动自己的工具文档已写明关键约束，本次全部实测复现：

> `background`（默认）永不切换前台……对于输入栈会静默丢弃投递事件的目标（**Chromium/Electron 内容**、GTK 按钮、VCL/LibreOffice 加速键），工具返回结构化的 `background_unavailable` 错误而**不会**改走前台。`foreground` 是显式升级：短暂 `SetForegroundWindow` + `SendInput`，之后恢复原前台。

| 组合 | 实测结果 |
|---|---|
| 坐标点击 → Electron/Chromium 内容（后台） | **可用**（4/4 命中，不提权） |
| `type_text` → Chromium 窗口类 | 拒绝：`Background delivery is not available for target window class 'Chrome_WidgetWin_1' on this event kind (text_input)` |
| `scroll` → Chromium 窗口类 | 拒绝（同上，`mouse_scroll`） |
| `scroll` → 记事本（两种模式） | 拒绝：`Background delivery is not available for target window class 'Notepad'` |
| `type_text` → 记事本（后台） | **可用**（已由读回文档验证） |
| `hotkey` → 记事本 | 拒绝：XAML/UWP 目标找不到 UIA `AcceleratorKey` 或 `(Ctrl+X)` 名称提示 |
| `pressKey` → 记事本 | 投递并提示 "not verified" |
| UIA `set_value`（元素寻址） | Chromium 内容**不暴露**可编辑元素（该窗口只暴露 4 个菜单按钮、无 `set_value` 动作），因此该路径不适用于 Electron 内容 |

**对产品的直接含义**：`background` 是唯一不抢用户前台的方式，但它在 Electron/Chromium 内容上**只支持坐标点击**；输入与滚动必须走 `foreground`（会切换前台），在无前台窗口的环境下完全不可用。P1-06 必须据此选择工具集，不能假定后台可完成一切。

## 5. 为什么脚本没有发送任何东西到用户桌面之外

- 输入只发往两个丢弃式窗口：脚本自己启动的网格应用，以及脚本自己创建临时文件的记事本。
- 每次动作前检查目标是否为最前窗口；不是则**跳过并记录**（`safety.skippedForSafety`）。
- 所有点击均为 `Background`，不提权、不抢前台。
- 未截图、未落盘像素、未触碰用户文档、未针对高权限窗口。
- 探查并复用了"测试脚本无法获得真实前台窗口"这一环境事实。

## 6. 明确未验证（不因 20/20 而升级为支持）

| 项 | 原因 |
|---|---|
| **前台投递路径** | 本会话**没有任何前台窗口**：OS 报 `foreground HWND 0x0`，且对记事本调用 `SetForegroundWindow` 返回 `false`。驱动给出的错误是精确的：`foreground_unavailable: Windows did not activate exact target HWND 0x209ca (actual foreground HWND 0xe0422); no mouse input was sent`。 |
| **截图点 ↔ 输入点一致性** | 依赖前台路径；且 P1-04 的正向截图路径因同一原因未验证。**这条是 P1-05 的核心验收项，本机无法完成。** |
| **滚动** | 两个目标的两种模式全部被拒绝（见 §4）。 |
| **向 Chromium/Electron 内容输入文本** | 后台投递对该窗口类不可用；该内容也不暴露可编辑的 UIA 元素。 |
| 普通 vs 高权限窗口对比 | 未针对高权限窗口测试（按目标要求不自动提权）。 |
| 焦点变化、按下后取消 | 本机无前台窗口，无法构造"按下后取消"的真实前台场景；仅验证了无残留与无未配对 down。 |
| 多显示器 | 本机仅 1 个显示器。 |
| 驱动内建"授权/权限"语义 | `getSessionState` 的 `desktopCaptureAuthorized=false`、`desktopUnlocked=false`；本阶段未使用 `escalate_session`，也未建立驱动自身的授权流。**产品侧的授权仍由 pi-Orb 自己的任务授权与代次绑定负责**（P1-07）。 |

### 人工验证步骤（需要有真实前台窗口的会话）

```powershell
npm run build
node evidence/p1-05/run-p1-05.mjs
```

1. 在同一台机器上让任意窗口成为前台（例如手动点一下记事本）。
2. 重跑脚本：`foregroundDelivery` 应从"拒绝"变为可投递，`scrollVerification` 应出现可观测的滚动。
3. 观察：前台投递是否在动作后**恢复原前台窗口**。
4. 记录前台投递时鼠标是否发生位移（`SendInput` 会移动真实指针）。
5. 若要在真实产品窗口上验证"截图点↔输入点"，需先完成 P1-04 的人工正向截图步骤。

## 7. 非破坏性确认

- 未修改 pi-web；未触碰其 `node_modules` 或 6 个既有改动文件。
- 未修改任何用户 Pi 配置或凭据。
- 只写 `D:\pi-orb-p1-runs\<本次运行>`（网格日志与几何）与 `evidence/p1-05/`。
- 无截图、无像素落盘、未对用户自己的文档或前台窗口发送输入。

## 8. 复现前置与清理

- 两个脚本都需要已安装的 `@trycua/cua-driver@0.30.1`（`npm install` 已包含）。
- `run-p1-05.mjs` 会自行创建临时文本文件与记事本实例，结束时 `taskkill` 关闭该实例；网格应用被 `kill`。
- 只读探测（`probe-cua-driver.mjs`）的桌面状态调用使用 `maxImageDimension: 1`，只记录图像元数据，不保存像素。
