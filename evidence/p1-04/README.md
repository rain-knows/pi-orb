# P1-04 明确授权的截图上下文（M2）

> 运行方式：
> - `node evidence/p1-04/probe-desktop-capturer.mjs`（只读探测捕获源与窗口身份，不产生像素）
> - `node evidence/p1-04/run-p1-04.mjs`（授权流程端到端 + 本机验证；需先有 P0-02 的固定 HEAD 快照）
>
> 原始结果：`capturer-probe.json`、`result.json`（21/21）、`capturer-probe.json`
> 状态：**授权与拒绝路径通过**；**正向截图路径（真实窗口→预览→发送）在本机未验证**，原因见 §4。

## 1. 交付内容

| 能力 | 位置 |
|---|---|
| 大小/像素上限、授权判定、预览决策、图像块构造 | `src/shared/screenshot.ts` |
| 单张待确认截图的所有权 | `src/main/pending-capture.ts` |
| 授权流程编排（记录目标→截图→预览→决策→发送） | `src/main/screenshot-flow.ts` |
| 目标窗口记录（Win32，per-monitor-v2 DPI） | `src/main/native/foreground-window.ps1`、`src/main/target-window.ts` |
| 按原生句柄精确捕获 | `src/main/desktop-capture.ts` |
| 预览、删除、确认发送界面 | `src/renderer/App.tsx` |
| 单测 | `tests/screenshot.test.ts`、`tests/pending-capture.test.ts`、`tests/desktop-capture.test.ts`、`tests/screenshot-flow.test.ts` |

**唤醒路径不含任何截图**：`WakeController.wake()` 只调用 `restore()`/`show()`/`focus()`。截图只能由用户点击 `Screenshot` 触发。

## 2. 捕获源身份探测（只读，不产生像素）

用 `thumbnailSize: 0x0` 枚举捕获源，**不渲染任何帧**（实测 `hasThumbnail=false`），因此本探测不产生像素、不落盘。

| 事实 | 实测 |
|---|---|
| 窗口源 id 形状 | `window:<hwnd>:<index>`，如 `window:329270:0` |
| **中间段是真实 Win32 窗口句柄** | 用 `IsWindow` 验证 `329270` 与 `1181646` 均为存活窗口，且标题与源名一致（`pi-orb - Pi Web - Google Chrome`、`Backstop Window`） |
| 屏幕源形状 | `screen:0:0`（`screen:<monitor>:<index>`） |
| 显示器 | 1 个，`scaleFactor=1.5`（与 P0-04 的 150% 缩放一致） |

**设计后果**：按**原生句柄**匹配目标窗口，而不是按标题。标题匹配会有歧义（同名窗口）且窗口改名即失效；句柄是精确身份。`matchWindowSource` 要求前缀 `window:<handle>:` 完全匹配，因此 `window:32927:` 不会误匹配 `window:329270:0`，`screen:...` 也永远不会被当成窗口。

## 3. 授权与拒绝路径实测（21/21）

链路真实：真实 Electron 主进程 → 真实本地 helper → 真实 pi-web（固定 HEAD）→ 本机假 provider（记录每个请求体）。无真实模型、无真实凭据。

### 3.1 目标记录与 DPI（P0-04 的硬要求）

| 断言 | 实测 |
|---|---|
| helper 运行并返回 JSON | 通过 |
| **显式声明 per-monitor-v2 DPI 感知且实际生效** | `isPerMonitorV2=true`、`setCallSucceeded=true`、`isPerMonitorV1=false`、`isUnaware=false` |
| helper 耗时 | 约 746 ms（记录为成本事实） |

> 注意实现细节：`GetAwarenessFromDpiAwarenessContext` 会把 v1 与 v2 **都返回 2**，因此判断 v2 必须用 `AreDpiAwarenessContextsEqual`。仅看枚举值会漏判——这正是 P0-04 要求"必须显式声明"的那条。

### 3.2 无目标窗口 → 拒绝，且**不上传任何东西**

| 断言 | 实测 |
|---|---|
| 无目标窗口时拒绝截图 | `ok=false` |
| 拒绝理由说明"目标在获得焦点前记录" | 通过 |
| **拒绝理由不提供整屏兜底** | 通过（不含 whole/full/entire screen） |
| **被拒绝的截图没有产生任何模型调用** | `before=0 after=0` |
| 伪造的确认不发任何东西 | `sent=false` |
| 该伪造确认也没有产生模型调用 | `before=0 after=0` |
| 无待确认时丢弃是幂等的 | 通过 |
| 拒绝路径没有把草稿文本当普通消息发出去 | `busy=false` |

这是 P1-04 最关键的隐私性质，并且是在**真实主进程 + 真实 pi-web** 上验证的，不是文字声明。

### 3.3 text-only 模型拒绝图像任务（真实行为）

用一张**合成的真实 PNG**（8×8，180 字节）经文档化的 `prompt` 接口发送，模型在 `models.json` 中声明 `input: ["text"]`。

| 断言 | 实测 |
|---|---|
| text-only 模型**从未收到图像数据** | `providerReceivedImage=false`、`totalImagesInTranscript=0` |
| **被丢弃的图像在消息里被显式标注**，而不是静默消失 | provider 实际收到的用户消息为 `describe this synthetic image(image omitted: model does not support images)` |

第二条是**观测到的事实**，不是推测：Pi 保留了消息但在文本中标注图像被省略，因此会话记录里能看出"曾附了一张图但未被支持"，而不是假装什么都没附。

### 3.4 普通路径未受影响

| 断言 | 实测 |
|---|---|
| 纯文本消息仍能到达模型 | 通过（`imagePartsInLastUserMessage=0`） |
| 全程结束后壳仍存活 | 通过 |

### 3.5 单元测试（147 个测试中的 59 个属本阶段）

| 单测覆盖的性质 | 数量 |
|---|---|
| 上限、base64 长度、授权判定、预览决策、目标描述 | 22 |
| 待确认截图所有权（替换、拒绝、丢弃幂等） | 11 |
| 捕获源精确匹配（不匹配前缀相似句柄、不匹配屏幕源） | 6 |
| **授权流程**：预览字节与发送字节逐字节相同、取消零上传、陈旧确认不消费当前预览、发送失败零上传 | 20 |

其中"预览的字节 == 发送的字节"用 `Buffer.equals` 逐字节比对，而不是比对长度或字符串相等。

## 4. 本机未验证：正向截图路径（必须如实保留）

本会话**没有真实的前台窗口**：helper 实测 `GetForegroundWindow()` 返回空，且对记事本执行 `SetForegroundWindow` 返回 `false`、前台句柄仍为 `0`。因此：

| 项 | 状态 |
|---|---|
| 真实窗口被捕获、预览、确认发送的完整正值路径 | **未验证** |
| 截图点 ↔ 屏幕坐标一致性（P1-04 的坐标要求） | **未验证**（无真实截图可取） |
| 预览不夹带 Orb 自身遮罩 | **未验证**（无真实截图可看） |
| 多显示器、窗口被遮挡、DirectComposition 类窗口 | **未验证**（本机仅 1 显示器） |
| macOS 权限缺失提示 | **未验证**（Windows 上无对应授权弹窗） |

脚本把这条环境事实**记录为数据**（`foregroundWindowAvailable=false`）而不是断言成功，因此不会出现"正向路径其实没跑但报告通过"。

**人工验证步骤**（需要有真实桌面前台的会话）：

```powershell
npm run build
npm run start
```

1. 先把焦点切到想分享的窗口，再点悬浮窗的 `Screenshot` → 应出现该窗口的预览与窗口标题/尺寸。
2. 预览期间确认：**预览图里不应出现 Orb 悬浮窗本身**（Orb 不遮挡目标窗口时）。
3. 点 `Discard` → 不应发送任何消息；再次查看会话历史不应多出图像。
4. 重复一次并点 `Send with message` → 该图像应出现在 Orb 自己的会话中，且与原窗口内容一致。
5. 先点 `Screenshot` 再快速切换前台窗口 → 预览应提示"该窗口已不再是活动窗口"，且**不会**改截别的窗口。
6. 最小化或关闭目标窗口后再点 `Screenshot` → 应给出明确失败原因，**不得**静默截整屏。

记录结果时需包含：目标窗口类型（普通/高权限）、DPI 缩放、截图尺寸与窗口 bounds 的对应关系。

## 5. 已知设计取舍（记录以免后续误改）

| 取舍 | 原因 |
|---|---|
| 按原生句柄匹配，并要求标题仍一致 | 句柄在窗口销毁后可能被复用；标题一致不是身份证明，但能挡住"明显是另一个窗口"，而静默截取句柄的新主人更糟 |
| 超限时**拒绝**而不是缩放 | 预览必须与发送内容一致；缩放会让模型看到的像素与用户看过的不同 |
| helper 用 PowerShell（约 750 ms） | Win32 前台窗口无法从 Electron 直接读取。**P1-05 将用 Cua 契约里的 `active` 窗口标志替换此接缝**（`cua_driver_contract.d.ts` 已声明 `active: boolean`），届时只替换 `readTarget` 一处 |
| 陈旧确认**不消费**当前预览 | 早期实现把"不匹配"与"取消"合并，导致一次迟到的点击清掉了用户正在看的预览及其草稿消息——这是真实缺陷，已由 `screenshot-flow.test.ts` 固定 |
| 本阶段不接受自动截图 | 逐动作自动回图属 M3（P1-06），此时不能留下静默入口 |

## 6. 非破坏性确认

- 未修改 pi-web；运行脚本断言其工作树仍只有那 6 个既有改动。
- 只写本次运行目录与 `evidence/`；`HOME`/`USERPROFILE` 指向隔离目录；使用隔离测试密码。
- **未截图**（`screenshots: false`）、**无鼠标键盘输入**（`desktopInput: false`）、无真实模型、无真实凭据。
- 证据中无任何图片文件；合成 PNG 仅在内存中构造并作为 base64 传给本地 provider。
