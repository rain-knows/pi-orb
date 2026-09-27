# Cua 驱动接入事实（P1-05 实测）

- 状态：**运行时实测记录**，驱动版本 `@trycua/cua-driver@0.30.1`（Windows x64）。
- 依据：[`../evidence/p1-05/README.md`](../evidence/p1-05/README.md)、`../evidence/p1-05/cua-runtime-probe.json`、`../evidence/p1-05/input-verification.json`。
- 用途：P1-06（Orb 模式与工具闭环）与 P1-07（发布门禁）的输入约束来源。**本文的结论不得在未重新实测的情况下外推到其它驱动版本或其它机器。**

## 1. 必须遵守的硬约束

| 约束 | 实测依据 | 影响 |
|---|---|---|
| 窗口 bounds 是**物理像素**，而动作坐标是**屏幕 DIP** | 同一窗口：驱动报 735×684@(189,135)，Electron 报 502×462@(120,90)，缩放 150% | 不能把 `listWindows` 的 bounds 直接当动作坐标；两者也不是统一缩放关系（比值 1.464/1.481 ≠ 1.5） |
| `getScreenSize` 报 **DIP**（1707×1067），不是物理分辨率 | 驱动实报 `{width:1707,height:1067,scale_factor:1.0}` | 不能用它推断物理像素尺寸 |
| 窗口 id 是 `bigint` | 7/7 窗口均为 bigint | 不可转 number；序列化需转换 |
| 窗口身份用 `windowId`，**不要**与错误信息里的 HWND 混用 | 驱动错误信息打印 `HWND 0x209ca`（十进制 133578），与 `listWindows` 的 `windowId` 属不同空间 | 混用会指向错误窗口。P1-06 必须先验证二者对应关系，**不得假定** |
| `background` 投递对 Chromium/Electron 内容**仅支持坐标点击** | `type_text`/`scroll` 返回 `Background delivery is not available for target window class 'Chrome_WidgetWin_1'` | 输入与滚动必须走 `foreground`，而 `foreground` 需要真实前台窗口 |
| `foreground` 需要能激活目标 HWND | 无前台窗口时报 `foreground_unavailable: ... (actual foreground HWND 0x0); no mouse input was sent` | 无前台窗口的环境下前台路径完全不可用；且它会移动真实指针并短暂切换前台 |
| 驱动的"成功"摘要**不等于**动作生效 | `type_text` 摘要自称 "not verified — could not read the focused field back"，而文本确实落到了目标 | 判定必须由目标侧证实（P1-06 的"一动作一观察"正好需要这一点） |

## 2. 可用能力面（运行时 57 个工具，节选）

| 类别 | 工具 |
|---|---|
| 观察 | `list_windows`、`list_apps`、`get_window_state`（含 `elements` 与 `treeMarkdown`）、`get_desktop_state`、`get_screen_size`、`get_cursor_position`、`verify_state`、`get_accessibility_tree` |
| 动作 | `click`、`double_click`、`right_click`、`drag`、`type_text`、`press_key`、`hotkey`、`scroll`、`move_cursor`、`set_value`、`invoke_menu` |
| 会话/授权 | `start_session`、`end_session`、`escalate_session`、`get_session_state`、`list_sessions` |
| 其它 | `clipboard_read/write`、浏览器类工具、录屏类工具——**MVP 不启用** |

SDK 侧对应方法名（`CuaDriver.prototype`，39 个）：`listWindows`、`listApps`、`getWindowState`、`getDesktopState`、`getScreenSize`、`getCursorPosition`、`verifyState`、`click`、`typeText`、`pressKey`、`hotkey`、`scroll`、`drag`、`moveCursor`、`invokeMenu`、`startSession`、`endSession`、`escalateSession`、`getSessionState`、`listSessions`、`shutdown`、`callTool` 等。

`callTool({ name, arguments })` 是 MCP 工具名的直通入口，参数名用 snake_case（如 `element_token`、`delivery_mode`）。

## 3. 坐标使用建议（P1-06 实现约定）

实测可用的请求规则：**请求值 = 目标点的屏幕 DIP 坐标 − 驱动报告的窗口原点**，投递点会等于该屏幕 DIP 坐标（在 4 个分散格子上验证，落点均在格中心）。

但该规则中的"减去窗口原点"是**按观察拟合**的经验规则，不是可证明公式，因此：

1. 只选**一种**坐标约定并写进代码与测试（见开发目标 §4.3）。
2. 优先用**元素寻址**（`get_window_state` 的 `element_token`）而不是像素坐标——元素寻址不受 DPI 影响，但**Electron/Chromium 内容可能不暴露元素**（实测该窗口只暴露 4 个菜单按钮）。
3. 任何坐标换算都必须能解释清楚来源；禁止"看起来差不多"的缩放假设。
4. 动作后必须重新观察并核验（`verify_state` 或新快照），不能依赖动作返回的成功摘要。

## 4. 会话与授权

| 事实 | 说明 |
|---|---|
| `startSession`/`endSession` 可用且廉价 | 实测 1 ms 量级 |
| `getSessionState` 含 `desktopCaptureAuthorized`、`desktopUnlocked`、`captureScope`、`effectiveScope` | 实测均为 false/0（本阶段未升级权限） |
| `escalate_session` 存在但**未使用** | 产品侧授权不由驱动决定；pi-Orb 的任务授权与运行代次绑定自行负责（P1-07） |
| 会话结束后再查状态会明确报错 | "this session has ended; call start_session explicitly to…" |

## 5. 许可义务（带入 P1-07）

- `@trycua/cua-driver` 为 `MIT`；**Windows 平台包为 `MIT AND MPL-2.0`**。
- 上游 `node-runtime-NOTICE.md` 只点名 `cua_driver_node_runtime.node` 为 MPL-2.0 派生构建，并说明对应源码位置；**26.8 MB 的 `cua_driver_sdk.dll` 未被该 NOTICE 点名**。
- **P1-07 必须核实 DLL 是否承担 MPL 义务**，不得自行假定任意一侧；分发需附 NOTICE 并告知源码获取路径。
- 不得引入 `cua-agent[omni]`（含 ultralytics，AGPL-3.0）。
