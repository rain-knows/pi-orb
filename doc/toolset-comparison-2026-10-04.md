# pi-orb 与 dsh-orb-cordis 工具集解析与差别

核对日期：2026-10-05。参考仓库：[`mini-yifan/dsh-orb-cordis`](https://github.com/mini-yifan/dsh-orb-cordis)，固定提交 `9cdc50302d202f4497569731be488a8afa500da7`。本报告区分“迁移前慢在哪里”和“当前代码已经变成什么”，避免把历史实现当成现状。

## 结论

迁移前的低效主要来自浏览器扩展链路的三个叠加问题：

1. 模型先发现 `orb_browser` 的二级命令，再逐条调用；入口与 Code mode/浏览器工具重叠，增加了选择和错误发现成本。
2. 每个成功浏览器命令后都自动追加一次空参数的整页快照，快照文字没有历史预算。最近一次任务的浏览器返回文字累计 1,195,179 字符，其中自动快照 1,093,753 字符，占 91.5%；最后一轮 provider 输入与缓存读取合计 400,663 token。
3. 浏览器连接故障的单次上限是 90 秒；较早会话连续三次超时，约 270 秒都耗在重试上。这个时间不是正常命令的固定成本，而是故障策略把一次连接问题放大了。

因此，浏览器扩展变差的首要原因不是“用了 MCP”或“多了一条命名管道”，而是观察结果过大、重复发送和故障恢复边界过宽。迁移后的运行时已经移除浏览器 DOM 网关、Playwright/MCP 依赖、显式 `orb_observe`、`orb_batch` 和模型可见 `observation_id`；浏览器按参考项目的可见桌面方式通过 `open_in_browser` 打开，再用截图工具操作。内部仍保留 freshness token，用于 Electron bridge 的安全校验，不进入模型协议。

当前代码已对齐参考项目的 GUI 工具名、观察循环和后台任务入口。Pi 负责扩展注册、会话、SSE 和授权桥，Electron 负责 Windows 原生输入与截图；Cordis/dsh 会话引擎没有被复制。后台 `code_agent` 已接入 Pi Web 独立 session，但宿主工具范围与真实 GUI 验收仍存在差别，不能据同名工具宣称完整等价。

## 取证基线

| 项目 | 基线 |
|---|---|
| 参考插件 | `D:\pi-orb-ref\dsh-orb-cordis`，HEAD=`9cdc50302d202f4497569731be488a8afa500da7`，工作树干净 |
| 旧 Windows 后端 | `D:\pi-orb-ref\deepseek-harness-orb`，HEAD=`72f1d738458a223696685a909e806b683eff5885` |
| 迁移前慢任务 | 2026-10-04 的本地 Pi session，工具间隔累计约 42.3 秒，会话总耗时约 659.8 秒，27 条助手响应 |
| 迁移前故障任务 | 2026-10-01 的本地 Pi session，3 次浏览器超时，每次约 90 秒 |
| 可重算证据 | [`evidence/toolset-audit/summarize-sessions.mjs`](../evidence/toolset-audit/summarize-sessions.mjs) 与 [`session-summary.json`](../evidence/toolset-audit/session-summary.json) |

工具间隔只反映调用发出到结果返回，不能拆出模型推理、网络调度和流式生成时间；报告不据此声称参考项目快多少倍。没有在相同模型、页面、登录态和任务下重跑两个项目，所以这里给出可验证的架构差异，不给出未经测量的倍数结论。

## 工具集对应关系

参考项目的 `packages/computer-use/src/plugin.ts` 注册 13 个直接 GUI 工具。当前 pi-orb 的 [`src/shared/orb-tools.ts`](../src/shared/orb-tools.ts) 与 [`pi-package/extensions/orb.ts`](../pi-package/extensions/orb.ts) 使用相同的模型可见名称：

| 能力 | dsh-orb-cordis | 当前 pi-orb | 说明 |
|---|---|---|---|
| 鼠标与键盘 | `click`, `input_text`, `scroll`, `hotkey`, `long_press`, `drag` | 同名 | 坐标是截图的 0–1000 fraction；动作完成后返回新截图 |
| 等待 | `wait`, `long_wait` | 同名 | 参考的 1 秒、10/30/60/120 秒枚举保留 |
| 桌面入口 | `screenshot`, `open_in_browser`, `open_in_finder`, `list_apps`, `open_app` | 同名 | Windows 适配位于 `src/main/reference-windows/` |
| 观察 | 不是模型工具，首帧自动附加 | 同上 | `before_agent_start` 抓取当前前台窗口；内部观察对象只在 bridge 中流转 |
| 批量 | 同一 step 可顺序发多个相互独立动作 | 同上 | 不再有模型可见 `orb_batch`；Pi 的 sequential 工具结果继续保持动作边界 |
| 后台工作 | `code_agent`, `code_agent_status`, `code_agent_stop` | 同名 | 当前通过 Pi Web 独立 session、SSE、队列和完成通知适配 |

当前 GUI 工具共有 13 个，后台工具另有 3 个。普通工作区不注册这 16 个工具；打包插件加载证据验证了普通 workspace 为 0 个、Orb workspace 为 13 个 GUI 加 3 个后台工具。

参数层面仍有一处宿主适配：参考实现把 `screen_index: 0` 显式放在每个有坐标的调用中，当前 Pi schema 也保留该字段；Electron 内部把它映射到当前 Windows 前台窗口。模型不会看到窗口像素坐标、窗口句柄或 freshness token。

### 仍存在的差别与能力边界

| 方面 | 参考项目 | 当前 pi-orb | 对效率或能力的影响 |
|---|---|---|---|
| 前台宿主工具 | preset 装配平台 shell、web search/fetch、ask_user_question | 从 Pi 已加载工具中选择 read/write/edit/bash/powershell、搜索/抓取与问答工具；没有的不会凭空注册 | GUI+后台的 16 个工具之外，搜索和问答是否可用取决于用户的 Pi 扩展；不能称为固定完整参考 roster |
| 后台工具范围 | 创建 dsh 的 `standard` preset 会话 | Pi Web 创建时只接收内置工具名；文件工具按 Access 分档，扩展在 worker turn 再激活宿主已有 web_search/web_fetch 等搜索/抓取工具 | 文件生产已实测；宿主未加载的搜索服务不会自动出现，实际网络服务仍须按用户 Pi 配置验证 |
| 后台模型选择 | 可读取独立 Code agent 模型偏好 | 新 worker 沿用 owner 模型与 thinking level | 未移植独立后台模型选择；避免新增 Pi 模型配置体系 |
| 结果预算 | preset 的工具文本裁剪服务与 dsh compaction | 同预算文本裁剪，另由 Pi context 投影只保留最新 Orb 观察图，完整历史保留 | 规则已接入真实 Pi loader；尚无迁移后的同任务 token/耗时对照 |
| 桌面覆盖 | 参考具有跨平台 backend | 当前采用 Windows backend，并拒绝非零 screen index | 多屏、其他系统和跨应用真实模型闭环尚未验收 |

这些差别来自当前代码和参考源码的逐项核对。参考宿主工具的定义见
[`agent.cordis.yml`](https://github.com/mini-yifan/dsh-orb-cordis/blob/9cdc50302d202f4497569731be488a8afa500da7/packages/computer-use/presets/computer-use/agent.cordis.yml)，
后台 standard 会话及独立模型偏好见
[`code-agent.ts`](https://github.com/mini-yifan/dsh-orb-cordis/blob/9cdc50302d202f4497569731be488a8afa500da7/packages/computer-use/src/code-agent.ts)。

## 执行链路

参考项目：

```text
用户消息 -> pre-step 自动附前台截图 -> 模型规划
  -> GUI 工具 -> 原生后端 -> 600ms settle -> 动作后截图
  -> 结果附图 -> 下一步模型规划

长任务 -> code_agent 入队并立即返回 -> 独立 session
  -> 两边空闲时完成通知 -> 前台继续 GUI 或复用 session_id
```

当前 pi-orb：

```text
Pi before_agent_start -> named pipe -> Electron observe -> 前台截图进入当前 turn
  -> click/input_text/... -> Electron bridge -> Windows backend
  -> 600ms settle -> 新截图 -> Pi tool result

code_agent -> named pipe -> Pi Web 独立 session/SSE -> registry 持久化
  -> 完成/失败/停止通知 -> Orb 前台决定下一步
```

区别在边界而不是模型循环：参考项目由 Cordis 组装工具和事件，pi-orb 用 Pi 扩展 API 与 Electron bridge 做同一语义的薄适配。Pi 还需要内部 `generation` 和观察对象来防止过期截图驱动错误窗口；这是安全校验，不是给模型增加一次观察调用。

## 浏览器扩展为什么拖慢迁移前版本

迁移前的 `BrowserBroker` 使用 `orb_browser(name, arguments)` 做二级网关。命令完成后自动调用 `browser_snapshot({})`，没有使用 Playwright 已提供的 `target`/`depth` 限制。结果是：

- `browser_tabs`、`browser_wait_for` 等本来只需要状态确认的命令也带回整页正文；
- 小范围的显式 snapshot 会在下一次动作后被空参数整页 snapshot 覆盖；
- 浏览器快照是 text block，不受旧的“最近一张图片”预算限制；
- 发生连接故障时，下一次调用仍可能重新建立连接并再次消耗 90 秒预算；
- `orb_browser`、Code mode、搜索和子代理同时出现在前台角色里，历史记录已经出现工具成员发现错误。

这解释了“装扩展后更差”：扩展提高了网页可操作性，却把页面 DOM 变成了每一步都可能重复注入的大段上下文，且失败时没有快速熔断。旧实现中命名管道和 MCP InMemoryTransport 本身不是主要证据对象。

当前迁移直接移除了这条链路：`package.json` 不再包含 `@playwright/mcp` 或 MCP SDK，`src/main/browser-broker.ts` 和对应 extension 已删除，模型不能再调用浏览器二级网关。网页入口现在是参考项目的 `open_in_browser`，页面状态统一由可见窗口截图表达。代价是 DOM 级定位、标签页列表和网页专用快照不再属于 Orb 工具集；这是按用户要求回到参考项目语义的产品取舍。

## 当前状态与证据

截至 2026-10-05：

- `npm run typecheck` 通过。
- `npm run lint` 通过。
- `npm test` 通过：48 个测试文件，483 个测试。
- `node evidence/p2-05/run-p2-05.mjs` 通过：构建/打包、产物审计 30/30、打包插件加载、打包应用 renderer smoke 22/22。
- 普通 workspace 与 Orb workspace 的真实 Pi extension loader 隔离已写入 [`evidence/personal-startup/plugin-load.json`](../evidence/personal-startup/plugin-load.json)。
- 运行时模型工具面和打包审计不再包含 `orb_observe`、`orb_batch`、`orb_browser`、模型可见 `observation_id`、`BrowserBroker` 或 Playwright runtime；内部仍有 camelCase `observationId` freshness token。

逐项审计还修复了迁移中遗漏的效率与返回契约：实际扩展现在直接使用参考完整 `policy.ts`，
由 Pi `context` 钩子对工具文本按参考 8192/4096/1024 字符裁剪，并同时对自动首帧和 GUI
结果保留最新 Orb 图像。用户图片、其他工具图片和完整持久会话不被裁掉。最新图片预算属于
Pi 宿主适配，参考 preset 的工具文本预算及裁剪算法直接复用；此前只在 README 声明、未接入
实际回调的问题已修正。`list_apps` 名单、前台文件夹标签及窗口变化拒绝的新截图也已补回，
无调用者的旧 pixel/raster 适配已删除。来源与验证见迁移记录的“逐项审计修正”。

真实模型后台 `code_agent` 的完成闭环已通过：模型实际调用工具、Pi Web 创建独立 worker session、worker 产出文件，owner 在空闲后收到一次完成通知（8/8）。后台停止闭环也已通过：真实模型创建 worker 后，产品桥停止 worker，注册表进入 idle、没有产物且没有完成通知（10/10）；这是产品桥停止验收，不是模型自主调用 `code_agent_stop` 的证明。

真实 provider 失败回读已通过 `real-model-code-agent-failure-session.json`（12/12）：隔离 worker
请求实际触发 503，最终助手消息、注册表与 owner 单次失败通知保留同一错误全文。此前仅
依赖 `prompt_error` 会漏掉最终助手 `stopReason: error` 的 settled 路径；已改用 Pi Web
公开会话历史接口回读。第一次失败探针门禁过宽、未比对错误内容的问题也已修正。

本轮真实 GUI 有限样本通过：点击 20/20、滚动 21/21、输入 22/22、浏览器可见网页 22/22，
分别见 `real-model-c7-session-access.json`、`real-model-d6-scroll-session-access.json`、
`real-model-d8-type-session-access.json`、`real-model-browser-session-access.json`。
判据包含持久首帧先于工具调用、动作后观察时间/截图及目标自身落点、wheel/scrollTop、
精确文本或网页完成请求；没有通过 DOM 网关完成浏览器动作。

这些样本不构成稳定成功率证明：同轮曾出现模型把 C7 点写成 `[12,21]` 而未命中，D6 点
`[300,940]` 的 wheel 落在滚动区域外。故移除 DOM 膨胀并不保证视觉定位不出错。
验收脚本也曾检查旧 `Foreground:` 文本、只凭“模型调用了动作”推断首帧、收到任意 wheel
就提前结束；现已按参考标签、真实首帧顺序和模型整轮结束修正。

`open_app` 真机探针发现旧适配在 600ms 后强制校验应用前台，误把较慢冷启动当成失败并
停止任务。现已移除重复应用名单/activate/launch 逻辑，直接调用现有 reference backend，
按参考 `plugin.ts:1013-1070` 返回启动结果及实际前台新图。修复后运行因锁屏在发送模型
请求前中止；这一项仍未验收。支持矩阵保留其未验证状态。

## 后续测量口径

若要量化迁移后的收益，应固定模型、thinking level、页面 URL、登录态、窗口大小和任务目标，并同时记录：模型响应次数、工具调用次数、每步截图字节、每步文本字符、provider input/cacheRead、首个动作延迟、连接错误分类、取消结果和最终业务读回。只有这样才能区分模型生成时间、页面加载时间和工具执行时间，也才能与参考项目做有效对照。

参考来源和复用说明见 [`doc/reference-toolset-transition.md`](./reference-toolset-transition.md)；历史 Playwright 资料保留在各文档顶部并标注为已废弃，不应作为当前实现契约。
