# 参考工具集与 Pi 接入

本页是当前模型工具契约的唯一说明。参数的可执行定义为 [orb-tools.ts](../src/shared/orb-tools.ts) 与 [Pi 扩展](../pi-package/extensions/orb.ts)，精确来源和当前参考提交由 [参考手册](./reference-playbook.md) 维护。后续窗口/后台更新见 [2026-10-09 同步来源](./reference-sync-2026-10-09.md)。支持结论只见 [支持矩阵](./support-matrix.md)。

## 观察与执行链路

Pi `before_agent_start` 经认证 bridge 自动采集当前前台窗口首帧。GUI 工具串行调用 Windows backend，按参考等待 600ms 后重拍，结果附新图供下一步使用。选区问答与不支持图像的模型按对应合同处理，不自动附 GUI 首帧。

位置是最新截图的 0–1000 millifraction。session/generation、窗口身份和观察 freshness token 只在 Pi/Electron 适配层用于拒绝过期输入，不暴露为模型参数。多个动作仅在同图可见且互不依赖时放在同一步；每次动作仍保留观察边界。

已删除的显式 observe/batch、DOM/Playwright 网关和 pixel 双模式不再有使用或兼容入口。浏览器使用 `open_in_browser` 打开后由可见截图操作；`open_app` 直接调用参考 backend 激活或启动应用，返回实际前台新图，慢启动不伪报已经前置。

## 后台与上下文

`code_agent` 入队立即返回，由 Pi Web 独立 session/SSE 执行，registry 保存 owner 与 worker 归属。状态/停止只访问所属任务；双方空闲后通知一次，停止撤销完成通知，失败保留最终助手错误全文。继续使用 session_id，不再建 dsh 会话引擎。

前台完整 policy 直接移植，结果文本预算沿用参考 preset 的 8192/4096/1024 Unicode 字符。Pi 公共 context 钩子同时对首帧和工具回图保留最新 Orb 图片，不裁用户图片或其他工具图片，不改写完整持久历史。普通会话与 worker 不使用前台图片投影。

## 来源与宿主适配

首次工具集替换来源为 `mini-yifan/dsh-orb-cordis@9cdc50302d202f4497569731be488a8afa500da7`（MIT），旧 Windows backend 为 `deepseek-harness-orb@72f1d738458a223696685a909e806b683eff5885`。后续 GUI 互斥和后台书签/报告改动由当前同步记录承接，不复制 Cordis/dsh 引擎或配置体系。

| 参考文件 | 复用 | Pi 替换边界 |
|---|---|---|
| `packages/computer-use/src/plugin.ts` | 13 GUI schema、动作后观察、pre-step 首帧 | Pi registerTool/context/before_agent_start 与 Electron 原生桥接 |
| `packages/computer-use/src/policy.ts`、`packages/computer-use/presets/computer-use/agent.cordis.yml` | 角色分工、工具策略、结果裁剪常量 | Pi 结构化提示与公共 context hook |
| `packages/computer-use/src/code-agent.ts` | 名称、task/session_id/cwd、后台角色、slug/目录规则、所有权 | Pi Web create/prompt followUp/get_state/abort/clear_queue API |
| `packages/computer-use/src/code-agent-completion.ts` | 双空闲通知、4000 字符摘要、停止撤销通知 | Pi Web SSE 与 OrbSessionController 的真实 idle |

上下文裁剪算法来自旧单体 `packages/compaction/compaction-tool-result-pruner/src/index.ts`，以 Pi context 钩子替代 Cordis surface 写入；最新 Orb 图像预算属于 Pi 宿主适配。`observe.ts:82-111` 的前台应用/窗口/文件夹/焦点标签直接复用；`selection-turn.ts` 与 `plugin.ts:1077-1113` 用于首帧例外。后台失败通过 Pi Web 公开会话历史接口读取最终助手的 stopReason/errorMessage，不依赖 prompt_error 一定出现。

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

当前 GUI 工具共有 13 个，后台工具另有 3 个。普通工作区不注册这 16 个工具。

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


迁移前性能统计只见 [原始会话汇总](../evidence/toolset-audit/session-summary.json) 与 `summarize-sessions.mjs`，不另维护比较报告。

## 验证入口

- [P1-06](../evidence/p1-06/README.md)：provider 实收工具、真实首帧/动作后新图、目标自身读回和后台完成/停止/失败。
- [插件加载](../evidence/personal-startup/README.md)：实际 Pi loader 的普通/Orb/worker 装配边界。
- [打包](../evidence/p2-05/README.md)：运行时无废弃网关、包内容与实际产物运行。
- [当前参考同步](../evidence/reference-sync/README.md)：新窗口/后台 UI 的来源覆盖与夹具验证。

计数直接读对应 JSON，有限样本不代表任意任务的稳定成功率；人工步骤只维护在 [验收清单](./manual-acceptance.md)。
