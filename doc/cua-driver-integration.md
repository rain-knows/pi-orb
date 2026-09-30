# 历史 Cua 驱动接入事实（P1-05 实测，非生产路径）

- 状态：**已移除生产路径的历史运行时实测记录**，驱动版本 `@trycua/cua-driver@0.30.1`（Windows x64）。
- 依据：[`../evidence/p1-05/README.md`](../evidence/p1-05/README.md)、`../evidence/p1-05/cua-runtime-probe.json`、`../evidence/p1-05/input-verification.json`。
- 用途：记录为何 Cua 原型未作为生产 backend。当前生产输入实现位于 `src/main/reference-windows/`，
  行为与验收合同见 [`desktop-tools-port.md`](./desktop-tools-port.md) 和 `tests/reference-windows-driver.test.ts`。
  **本文不是当前产品的动作契约。**

## 1. 必须遵守的硬约束

| 约束 | 实测依据 | 影响 |
|---|---|---|
| 窗口 bounds 是**物理像素**，而动作坐标是**屏幕 DIP** | 同一窗口：驱动报 735×684@(189,135)，Electron 报 502×462@(120,90)，缩放 150% | 不能把 `listWindows` 的 bounds 直接当动作坐标；两者也不是统一缩放关系（比值 1.464/1.481 ≠ 1.5） |
| `getScreenSize` 报 **DIP**（1707×1067），不是物理分辨率 | 驱动实报 `{width:1707,height:1067,scale_factor:1.0}` | 不能用它推断物理像素尺寸 |
| 窗口 id 是 `bigint` | 7/7 窗口均为 bigint | 不可转 number；序列化需转换 |
| `windowId` **与 Win32 HWND 同一 id 空间** | 实测：驱动报 `2884448` 的窗口，其 `desktopCapturer` 源 id 为 `window:2884448:0`（P1-04 已证中间段是存活 HWND） | 因此可用同一句柄做 Win32 调用（置前、`IsWindow`）。但驱动**错误信息**里的 HWND 文本仍不可直接当 `windowId` 用，需比对 |
| `background` 投递对 Chromium/Electron 内容**仅支持坐标点击** | `type_text`/`scroll` 返回 `Background delivery is not available for target window class 'Chrome_WidgetWin_1'`，`errorCode=background_unavailable` | 输入与滚动必须走 `foreground`；驱动要求**先试 background，被拒后才升级** |
| **typed `ScrollInput` 没有 `delivery_mode` 字段** | `ScrollInput.defaults()` 为空；只有 `ClickInput`/`VerifyStateInput` 带该字段。驱动的拒绝文案却要求“retry with delivery_mode:\"foreground\"” | 用 typed `scroll` + `deliveryMode` 会被**静默丢弃**（不报错也不升级）。升级必须走 `callTool("scroll", {... delivery_mode:"foreground"})` |
| 驱动的拒绝是**正常返回值**，不是抛出 | `click` → `effect: Refused`(4)；`scroll`/`typeText` → `isError:true` + `errorCode` | 忽略返回值的调用会把拒绝当成成功报给模型；两者都必须读取 |
| 驱动会在**前台切换被拒**时仍报滚动成功 | 实测：返回 `✅ Scrolled down via SendInput wheel (3 tick(s)) ... (delivery_mode:foreground)`、`isError=false`，但前台窗口仍是用户的 Chrome，目标窗口零个 `wheel` 事件 | 判定必须读目标侧事件日志；不得用驱动摘要当证据 |
| `foreground` 需要能激活目标 HWND | 无前台窗口时报 `foreground_unavailable: ... no mouse input was sent` | 该错误是精确且可诊断的；但成功报告并不能反推真的激活成功（见上一行） |
| 驱动的"成功"摘要**不等于**动作生效 | `type_text` 摘要自称 "not verified — could not read the focused field back"，而文本确实落到了目标 | 判定必须由目标侧证实（P1-06 的"一动作一观察"正好需要这一点） |

## 2. 可用能力面（运行时 57 个工具，节选）

| 类别 | 工具 |
|---|---|
| 观察 | `list_windows`、`list_apps`、`get_window_state`（含 `elements` 与 `treeMarkdown`）、`get_desktop_state`、`get_screen_size`、`get_cursor_position`、`verify_state`、`get_accessibility_tree` |
| 动作 | `click`、`double_click`、`right_click`、`drag`、`type_text`、`press_key`、`hotkey`、`scroll`、`move_cursor`、`set_value`、`invoke_menu` |
| 会话/授权 | `start_session`、`end_session`、`escalate_session`、`get_session_state`、`list_sessions` |
| 其它 | `clipboard_read/write`、浏览器类工具、录屏类工具——**MVP 不启用** |

SDK 侧对应方法名（`CuaDriver.prototype`，39 个）：`listWindows`、`listApps`、`getWindowState`、`getDesktopState`、`getScreenSize`、`getCursorPosition`、`verifyState`、`click`、`typeText`、`pressKey`、`hotkey`、`scroll`、`drag`、`moveCursor`、`invokeMenu`、`startSession`、`endSession`、`escalateSession`、`getSessionState`、`listSessions`、`shutdown`、`callTool` 等。

`callTool(name, argumentsJson)` 是 MCP 工具名的直通入口：第一个参数是工具名，第二个是 **JSON 字符串**（不是对象），参数名用 snake_case（如 `element_token`、`delivery_mode`）。它是唯一能表达 typed 输入缺失字段（如 `ScrollInput` 的 `delivery_mode`）的途径。

## 3. 坐标使用建议（P1-06 实现约定）

实测可用的请求规则：**请求值 = 分数 × 驱动上报的窗口尺寸**（驱动把窗口原点加回去）。

> **这条规则是怎么定下来的（两次记录矛盾，以产品整链路实测为准）**
>
> P1-05 还记录过另一条规则：「请求 = 目标屏幕 DIP 点 − 驱动上报的窗口物理原点」，并称 4/4 命中格心；
> 两条规则在**同一窗口位置**（驱动报 189,135 735×786）下相差约 **1.2 格**，不可能同时命中同一格。
>
> 裁决过程：曾据一次直调探针改成「屏幕 DIP − 物理原点」，但**改后产品整链路实测落在 `0,1`（预期 `1,2`）**，
> 而改前的「分数 × 窗口尺寸」落在 `1,2`。把驱动的行为代入两份日志即可验证后者：
> 本次适配器发出 `(449,283)`，目标记录的客户端点为 `(298,133)` = `(449+189)/1.5 − 127`，正落在 `1,2` 格内。
> 因此**以为驱动接受 `dipScreen − origin` 是错的**（那次探针结论不可采信），当前实现保留「分数 × 窗口尺寸」。
>
> 残留的不确定性：为何探针会得出相反结果尚未查清（怀疑与探针首次点击丢失 / 落点归属有关）。
> 它不影响产品结论，但记录在此，以便日后一个更严格的探针去解释它。
>
> 也因此，本节不保证这两条规则中任何一条是**通用公式**：它们各自只是当次条件下的实测记录。

但该规则中的"减去窗口原点"是**按观察拟合**的经验规则，不是可证明公式，因此：

1. 只选**一种**坐标约定并写进代码与测试（见开发目标 §4.3）。
2. 优先用**元素寻址**（`get_window_state` 的 `element_token`）而不是像素坐标——元素寻址不受 DPI 影响，但**Electron/Chromium 内容可能不暴露元素**（实测该窗口只暴露 4 个菜单按钮）。
3. 任何坐标换算都必须能解释清楚来源；禁止"看起来差不多"的缩放假设。
4. 上述约束只适用于历史 Cua 原型。当前 pi-orb 的 Windows backend 在成功动作结果内返回 fresh screenshot 和
   `observation_id`，下一动作直接使用该 observation；目标侧日志仍是验证动作生效的依据。

## 4. 会话与授权

| 事实 | 说明 |
|---|---|
| `startSession`/`endSession` 可用且廉价 | 实测 1 ms 量级 |
| `getSessionState` 含 `desktopCaptureAuthorized`、`desktopUnlocked`、`captureScope`、`effectiveScope` | 实测均为 false/0（本阶段未升级权限） |
| `escalate_session` 存在但**未使用** | 当前产品授权不由历史 Cua 驱动决定；pi-orb 的 session Access grant 绑定 Orb session 与 generation |
| 会话结束后再查状态会明确报错 | "this session has ended; call start_session explicitly to…" |

## 5. 许可义务（带入 P1-07）

- `@trycua/cua-driver` 为 `MIT`；**Windows 平台包为 `MIT AND MPL-2.0`**。
- 上游 `node-runtime-NOTICE.md` 只点名 `cua_driver_node_runtime.node` 为 MPL-2.0 派生构建，并说明对应源码位置；**26.8 MB 的 `cua_driver_sdk.dll` 未被该 NOTICE 点名**。
- **P1-07 必须核实 DLL 是否承担 MPL 义务**，不得自行假定任意一侧；分发需附 NOTICE 并告知源码获取路径。
- 不得引入 `cua-agent[omni]`（含 ultralytics，AGPL-3.0）。
