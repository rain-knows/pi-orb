# 参考工具集完整替换

## 目标与约束更新

2026-10-04 用户明确要求全面转向 `mini-yifan/dsh-orb-cordis` 的工具集设计和设计思路，包含后台任务，并放弃现有工具集设计。本阶段不以修补 Playwright 网关为最终目标。

固定来源提交 `9cdc50302d202f4497569731be488a8afa500da7`。旧 Windows 后端来源 `72f1d738458a223696685a909e806b683eff5885` 已核对。现有按需观察、显式 observation_id、独立 orb_batch、DOM 网关优先、禁止后台会话/自动首帧/启动应用等产品限制均被本次目标替代。Pi/pi-web 的公开会话、模型和插件机制仍是宿主边界；不移植 Cordis/dsh 引擎，不重写 Pi 模型循环。

## 完成清单

- [x] 专用 Computer Use 前台，收敛工具与提示，普通 Pi Web 不受影响。
- [x] 参考的 13 个直接 GUI 工具、参数和语义；包括启动应用、打开 URL/路径、截图保存/剪贴板。
- [x] 自动首帧、动作后观察、独立可见动作顺序执行；删除旧模型可见 observe/batch/DOM 网关设计。
- [x] 参考 `code_agent`、`code_agent_status`、`code_agent_stop`：立即入队、可继续同会话、归属隔离、独立停止。
- [x] 后台结果在后台与调用前台空闲后通知一次；可从 Pi Web 打开/继续任务。
- [x] 参考前台结果裁剪与权限生命周期，已有 Pi 能力优先。
- [x] 当前文档、旧实现、测试及许可归属全部同步；无兼容层或静默回退。
- [x] 构建、打包内容及打包产物运行；P2-05 已通过构建、30/30 产物审计和 22/22 打包 smoke。
- [x] 真实模型后台 `code_agent` 完成闭环：真实模型调用、独立 worker session、文件产物和 owner 完成通知均通过 `8/8`。
- [x] 真实模型后台停止闭环：真实模型调用、产品桥 `code_agent_stop`、worker 注册表归零和无完成通知均通过 `10/10`。
- [x] 真实后台 provider 失败回读：隔离 worker 请求实际触发 provider 503，最终助手错误、持久注册表与 owner 单次失败通知一致，`12/12`。
- [x] 当前参考工具合同的真实点击 20/20、滚动 21/21、输入 22/22、可见浏览器 22/22；均包含目标自身事件和动作后新图。
- [x] `open_app` 冷启动修复后的真实模型闭环，22/22；独立应用启动、模型依据截图点击、应用自身事件与动作后新图均已验证。

## 来源与宿主适配

| 参考文件 | 复用 | Pi 替换边界 |
|---|---|---|
| `packages/computer-use/src/plugin.ts` | 13 GUI schema、动作后观察、pre-step 首帧 | Pi registerTool/context/before_agent_start 与 Electron 原生桥接 |
| `packages/computer-use/src/policy.ts`、`packages/computer-use/presets/computer-use/agent.cordis.yml` | 角色分工、工具策略、结果裁剪常量 | Pi 结构化提示与公共 context hook |
| `packages/computer-use/src/code-agent.ts` | 名称、task/session_id/cwd、后台角色、slug/目录规则、所有权 | Pi Web create/prompt followUp/get_state/abort/clear_queue API |
| `packages/computer-use/src/code-agent-completion.ts` | 双空闲通知、4000 字符摘要、停止撤销通知 | Pi Web SSE 与 OrbSessionController 的真实 idle |

阶段 1 先接入参考后台会话链路；最终完成仍须逐项验证上述清单，阶段测试不代表完整替换完成。

## 2026-10-05 implementation status

The model-facing contract is now hard-switched to the 13 reference names: `click`, `input_text`,
`scroll`, `hotkey`, `long_press`, `drag`, `wait`, `long_wait`, `screenshot`, `open_in_browser`,
`open_in_finder`, `list_apps`, and `open_app`. The old `orb_observe`, `orb_batch`, `orb_browser`,
explicit model-facing `observation_id`, Playwright browser broker, and Orb image-space projection
are removed from the runtime path. Pi keeps the freshness token only inside the Electron bridge
adapter. `before_agent_start` captures and attaches the initial frontmost-window frame, and each
action result recaptures the window. The Windows driver now exposes screenshot, browser, Finder,
and launched-app operations. Background `code_agent` remains the Pi-native asynchronous extension
and is intentionally outside the GUI tool schema.

## 2026-10-05 逐项审计修正

审计发现此前完成清单中的“提示复用、结果裁剪”证据不足：实际扩展使用了自行缩写的提示，
且没有实现 README 宣称的最新截图预算。现已直接移植参考 `policy.ts` 的完整默认
millifraction 文本至 `src/shared/computer-use-policy.ts`，删除两套缩写提示，统一由
`describeOrbModeSection()` 组装；Pi/Electron 授权和不可信屏幕内容规则只作为宿主补充。

参考 preset 的裁剪预算为 8192/4096/1024 Unicode 字符。`computer-use-context.ts` 移植旧
参考 `packages/compaction/compaction-tool-result-pruner/src/index.ts` 的跨 block 裁剪算法，
以 Pi 公共 `context` 钩子替换 Cordis service 和会话 surface 写入。最新 Orb 图片投影是 Pi
宿主适配：同时计入自动首帧及 GUI toolResult，只裁掉更早的 Orb 图片，保留用户上传图、
其他工具图片、调用关联和完整持久历史；普通会话与后台 worker 不运行该投影。

同时修正四个宿主遗漏：按参考 `observe.ts:82-111` 保留前台应用/窗口/文件夹/焦点标签；
`list_apps` 返回应用名单；窗口变化拒绝仍返回新截图并推进内部 token；非零 screen index
在发送输入前拒绝。按参考 `selection-turn.ts` 与 `plugin.ts:1077-1113`，选区问答和不支持
图像的模型不自动捕获首帧。

已删除无调用者的 `pixel-coordinates.ts` 与 `observation-raster.ts`，并清理其当前许可条目、
参考坐标注释及手册入口，不保留 pixel 分支作为兼容实现。验证见
`tests/computer-use-context.test.ts` 和 `tests/orb-reference-extension.test.ts`；这些测试验证
实际扩展回调及模型输入投影，不代替锁屏环境下缺失的真实模型 GUI 验收。

本轮验证：48 个测试文件、483 个测试通过；类型检查、Lint 通过；P2-05 构建、产物审计
30/30、打包 renderer smoke 22/22 通过。真实 Pi loader 从独立打包插件验证 15/15，包括
普通会话无提示/投影副作用、Orb 完整提示和图片投影不改写历史。探针补齐 Pi API 必需的
`prompt` 与模型信息；阶段 runner 现会在中途失败时写入本次失败结果，避免遗留旧成功记录。

## 2026-10-05 后台失败回读修正

真实 provider 探针发现：worker 的最终助手消息可以是 `stopReason: error`，但宿主仍只发出
`agent_settled`，未必发出 `prompt_error`。此前管理器把这条链路当作成功并通知“没有最终回复”。
修正保留参考 `code-agent-completion.ts` 的结束后回读与双空闲通知，只适配 Pi Web 的结果格式：
使用已有 `GET /api/sessions/{id}?tail=1&tree=summary&deferThinking=1&deferMedia=1`，读取最终
助手的 `stopReason/errorMessage`；错误/中止进入 error 状态，其余结果进入 idle 状态。
Pi Web 当前不开放 SDK 声明的 `get_messages`，故不能仅凭 SDK 类型判断 HTTP 接口能力。
不修改 Pi Web、不读取其内部引擎、不增加兼容命令回退。

`run-real-code-agent.mjs failure` 只在隔离 worker 的公开 provider-request 钩子改模型 ID，
请求与 503 响应均来自真实 provider；重试关闭于临时设置。验收要求最终助手、注册表和单次
失败通知中的错误全文一致，不能把“任意失败通知”当成 provider 失败回读通过。
修复前证据保留为 `real-model-code-agent-failure-before-fix-session.json`；修复后为
`real-model-code-agent-failure-session.json`（12/12）。正常完成与停止另行复测，不用失败
测试替代它们。

## 2026-10-05 可交互桌面验证与最后缺项

C7 点击 20/20、D6 滚动 21/21、D8 输入 22/22、可见浏览器网页 22/22 均通过有限样本验证。
原始记录见 `evidence/p1-06/real-model-*-session-access.json`。首帧必须在持久会话中先于
模型动作，结果须含动作后时间戳与新图；目标事件独立判定实际落点/滚动/输入，网页则由
本地 HTTP 完成请求判定。早期错误取点和探针提前结束的问题保留在比较报告中；不宣称
任意任务稳定成功。当前脚本在隔离 runRoot 保存 `result.json`，避免后续复跑丢失本轮结果。

独立 Pi loader 增加 worker 情形：已加载的 host web 工具可在后台继续使用，GUI 工具、
前台提示、前台图片投影不进入 worker；普通会话不变。该工具 inventory 是受控 fixture，
证明扩展装配边界，不代表真实搜索服务响应验证。

`open_app` 已根据插件参考 `9cdc503` 的 `plugin.ts:1013-1070` 与 `windows.ts.openApp`
改为直接用 backend，删除自写应用名单、`sameApp`、激活/启动和强制前台匹配代码。
成功后 600ms 返回当时的真实前台图；冷启动尚未前置不误报失败。实际 backend 错误也
返回能采集的新图。Pi adapter 只保留结果格式、取消与既有授权/新鲜度边界。
新增丢弃式 WinForms oracle，由本机已有 .NET Framework 编译器在隔离目录构建；其名称
仅进入测试壳进程 PATH，不改用户 PATH。此前修复后探针因锁屏中止；2026-10-05
11:46–11:47 UTC 解锁桌面复验通过 22/22，证据为
`evidence/p1-06/real-model-open-app-session-access.json`。初始应用未运行；模型自主调用
`open_app` 返回 `launched` 及原生应用截图，随后 `click([485,485])`，应用进程 108240
记录 `native-click`，点击结果再次返回该应用的新截图。启动与点击观察 ID 不同，时间均在
各自工具调用后。这个有限样本证明修复后的冷启动闭环，不代表所有应用启动时间或视觉准确率。

## 完成审计（2026-10-05）

上述本阶段完成清单已全部具备对应证据：

| 要求 | 当前证据与验证范围 |
|---|---|
| 参考直接工具、参数、提示和结果预算 | `tests/orb-tools.test.ts`、`tests/orb-reference-extension.test.ts`、`tests/computer-use-context.test.ts`；真实 Pi loader `evidence/personal-startup/plugin-load.json` 15/15 |
| 普通会话隔离、worker 不获得 GUI | loader 的普通/Orb/worker 分支与 `evidence/p1-06/tool-exposure.json` 的 provider 实收 schema；内置宿主工具按用户已加载 inventory 选择 |
| 自动首帧、动作后截图和真实目标读回 | `real-model-c7-session-access.json` 20/20、`real-model-d6-scroll-session-access.json` 21/21、`real-model-d8-type-session-access.json` 22/22、`real-model-browser-session-access.json` 22/22、`real-model-open-app-session-access.json` 22/22 |
| 后台入队、继续、归属、停止、双空闲单次通知 | `tests/code-agent-manager.test.ts`；真实模型 complete 8/8、产品桥 stop 10/10、真实 provider failure 12/12（同目录 `real-model-code-agent-*-session.json`） |
| 删除旧工具链路、不改写 Pi Web 引擎 | 迁移提交 `8991e0890e` 删除旧扩展/BrowserBroker/Playwright 依赖；当前 bridge 和 Pi Web client 使用公开 API；包内容审计验证无旧运行时入口 |
| 来源、许可、构建与打包运行 | 本记录、比较报告、`THIRD_PARTY_NOTICES.md`；483 项单测、类型/Lint/构建；`evidence/p2-05/stage-result.json`，内容审计 30/30、打包运行 22/22 |

完成的是本次参考工具集替换，不是完整 v0.1 平台验收。Pi 的会话、模型偏好与已安装搜索工具
由宿主管理；参考的独立后台模型设置没有另建一套配置。多屏、其他系统、高权限窗口、干净
机器安装及长期稳定成功率仍按支持矩阵保留边界；不得用本阶段有限样本对这些范围作支持声明。
