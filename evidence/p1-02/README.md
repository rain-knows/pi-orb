# P1-02 Electron 最小浮窗

> 运行方式：`node evidence/p1-02/run-p1-02.mjs`（需先有 P0-02 建立的固定 HEAD 快照）
>
> 原始结果：`result.json`（35/35 断言）
> 状态：**通过**。这是 M1 的第二个交付项。

## 1. 交付内容

| 能力 | 位置 |
|---|---|
| 主进程装配：窗口、托盘、任务锁、会话生命周期 | `src/main/index.ts` |
| 会话控制：创建、订阅、发送、停止、代次绑定 | `src/main/orb-session.ts` |
| pi-web 客户端适配（HTTP + SSE 解析） | `src/main/pi-web-client.ts` |
| contextBridge 桥（固定方法集、无通用 IPC） | `src/preload/index.ts` |
| 浮窗界面：流式输出、错误、显式停止、工作区选择 | `src/renderer/index.html`、`src/renderer/floating.js`、`src/renderer/orb-surface.css` |
| pi-web SSE 事件形状夹具（供单测复用） | `tests/fixtures/pi-web-events.ts` |

设计约束（来自 P0-03 实测）：renderer 以 opaque origin 直连 pi-web 一律 403，因此**全部** API/SSE 调用经主进程代理，凭据不下发 renderer。

## 2. 验收项实测（35/35，真实链路）

链路是真实的：真实 Electron → 主进程 → 真实 pi-web（固定 HEAD 快照）→ 本机假 provider（捕获真实请求体）。无真实模型、无真实凭据、无截图、无桌面输入。

### 2.1 窗口与安全姿态

| 断言 | 实测 |
|---|---|
| Electron 存活、窗口标题 `pi-orb` | 通过 |
| preload bridge 暴露到 renderer | 通过 |
| renderer **无** `require`/`process`/`module`/`Buffer` | 通过 |
| 桥只有固定 9 个方法，**无** `ipcRenderer`/`invoke`/`send`/`require` 直通 | 通过（实测导出：`abort, chooseWorkspace, ensureSession, getStatus, onSessionEvent, refreshConnection, sendPrompt, setWorkspace, validateWorkspace`） |
| renderer 直连 pi-web 被拒 | 通过（`TypeError`，与 P0-03 的 403 结论一致） |

### 2.2 聊天闭环

| 断言 | 实测 |
|---|---|
| 输入框可用、表单提交成功 | 通过 |
| 触发**真实** provider 调用且请求体含 `orb_mode` section | 通过 |
| 用户消息显示在界面 | 通过 |
| 助手回复（流式）显示在界面 | 通过 |
| 界面报告所用会话 | 通过 |

### 2.3 独立会话与 pi-web 可浏览（N5）

| 断言 | 实测 |
|---|---|
| 状态暴露 `sessionId` | `01a0e3cf-cf3c-775c-896c-72b127d5c0c4` |
| pi-web 的 `/api/sessions` 列出该会话 | 通过 |
| pi-web 能读取该会话历史且含对话内容 | 通过 |
| **第二个客户端浏览不产生额外模型调用** | 通过（`before=1 after=1`）——浏览与执行分离 |

### 2.4 显式停止

| 断言 | 实测 |
|---|---|
| 运行中 `busy=true` | 通过 |
| Stop 控件在运行中可用 | 通过 |
| 点击后 `busy=false` | 通过 |
| **停止后流式输出不再增长** | 通过（间隔 3 秒对比，界面文本逐字节相同） |
| **停止的那一轮没有走到最后 token** | 通过（未出现 `PART-5-END`） |
| **停止后新消息仍被接受**（任务锁已释放） | 通过 |

### 2.5 普通 pi-web 回归（N1）

| 断言 | 实测 |
|---|---|
| 非 Orb cwd 仍可创建会话 | 通过 |
| 非 Orb cwd 仍可发消息 | 通过 |
| 该请求**不含** `orb_mode` section | 通过（探针记录 `containsOrbModeSection=false`） |

普通会话全程未被 Orb 改变，界面与后端仍可用。

## 3. 停止语义的事实记录（不夸大）

`stopPropagation.providerStreamDisconnectedByPiWeb = false`。

pi-web 的 `abort` 是**协作式**：agent loop 在下一个检查点停止。本次实测中，in-flight 的 provider 请求**没有**被立即断开，而是被允许结束。因此本阶段断言的是**用户可观察**的保证（输出停止增长、未走到最后 token、任务锁释放），而不是声称"底层请求已被强制中断"。

该布尔值作为观察事实落盘，供 P1-06/P1-07 参考：桌面任务取消需要自己保证按键/释放语义，不能依赖 pi-web 的 abort 顺带完成底层清理。

## 4. 本阶段发现并修复的三个真实缺陷

三者都是"界面看起来正常、功能实际不工作"的静默失败。

### 缺陷 1：初始代次事件在窗口创建前发出，renderer 永远拿不到

`beginGeneration` 在 `createWindow` 之前调用，而 `emit` 在窗口不存在时直接丢弃事件。renderer 从不发送提示（ui 显示正常，但提示发送失败），导致**每一个**提示都被判为 `stale-generation`。

修复：把代次改为**拉取式状态**（`WorkspaceStatus.generation`），并把 `sessionId`、`busy` 一并纳入同一快照。这也是把"启动期产生的状态"从推送改为拉取的一般化做法——推送会丢，拉取不会。

类似地，`busy` 也放进快照，因为 `busy` 是**当前**状态而非事件。

### 缺陷 2：任务锁在 HTTP 调用返回时就被释放，而非本轮结束

原实现用 `finally` 在 `client.prompt()` 返回后释放锁。但该调用返回只表示 pi-web **受理**了消息，本轮仍在进行。结果是 `busy` 恒为 `false`，第二个 GUI 任务可以在同一轮运行时被启动（违反 §6.2 的单任务锁）。

修复：成功路径**不**释放锁，锁持续到 `idle`/`error` 事件；失败路径（提示未开始）才释放。并修正为按**会话控制器的代次**释放，避免上一轮的结束事件释放新一轮的锁。

### 缺陷 3：SSE 事件形状靠猜，导致流式文本永远收不到

原实现假设 `message_delta` 事件并读取 `record.delta.text`。真实形状是 pi-web 的 `toClientAgentEvent` 投影：

```
{ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex, delta } }
```

猜错的后果是**流式文本完全不显示，且没有任何报错**。修复为按实测契约解析，并把真实事件形状固化成 `tests/fixtures/pi-web-events.ts`，避免再次靠猜测编写解析器。

顺带修正：`message_end` 的文本回退用 `??` 无效（累加器初值为空串），当没有 delta 事件时会把回复渲染成空白；改为按长度回退到最终内容。

## 5. 测试探针自身的修正（避免无效通过）

慢流判定原先匹配**整段 transcript** 里的 `SLOW`。由于每轮都会重发历史，"停止后再发消息"那次请求也被误判为慢流——这与 P0-02 踩过的"检测器失效"是同一类错误。

修正：只按**最后一条用户消息**判定。并新增自我判别断言"慢流探针恰好命中一个请求"，使该检查自身可证伪。修正后实测：`#1 False`、`#2 True`（`SLOW please stream for a while`）、`#3 False`（`after the stop`）、`#4 False`（`normal prompt`）。

## 6. 非破坏性确认

- 普通非 Orb cwd 的会话创建与发消息均通过，且其请求不含 Orb section（N1/N3）。
- 双客户端浏览同一会话不产生额外模型调用（N5）。
- 全程只写本次运行目录与 `evidence/`；Electron 进程保留真实用户 profile（P0-03 实测：覆盖会令其静默退出），但 Electron 不运行 Pi 代码。
- 未截图、无鼠标键盘输入、无真实模型、无真实凭据。

## 7. 明确未验证

- **未验证窗口拖动、置顶、展开/收起、托盘交互的人工体验**：本次断言的是窗口存在、标题、桥与聊天闭环；窗口几何与托盘的逐个交互属人工确认（P1-03 会覆盖快捷键与托盘入口）。
- **未验证多显示器下的窗口位置**：本机仅 1 个显示器。
- **未验证真实模型**：全程使用本机假 provider。
- **未验证快捷键唤醒**（属 P1-03）。
- **未验证窗口位置持久化的跨启动恢复**：已实现防抖保存，但未做"移动窗口 → 退出 → 重启 → 位置恢复"的实测。
- **未验证真实 pi-web 版本的其它组合**：仅固定 HEAD 快照。
