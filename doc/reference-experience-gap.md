# pi-orb 与参考浮球体验差距及实施状态

> 本页保留迁移前的参考差距和 `orb_*` 验收记录，不代表当前模型工具契约。当前状态见
> [`toolset-comparison-2026-10-04.md`](./toolset-comparison-2026-10-04.md)。
> 当前 `open_app` 已按参考语义支持激活或启动；下文旧表格只用于追溯迁移前差距。

基线：`rain-knows/deepseek-harness-orb`，MIT，提交
`72f1d738458a223696685a909e806b683eff5885`。源码索引和逐阶段复用边界见
[`reference-playbook.md`](./reference-playbook.md)。

## 体验证据

参考项目的体验核对运行了固定提交的 renderer 状态机、JSDOM 交互测试和 pi-orb 打包 Electron
探针，并对照同尺寸截图。Windows 原生窗口当时无法通过 CUA 直接操作，环境返回
`Codex auth token is unavailable`。因此，改前原生体验结论由参考源码、测试和打包探针交叉验证，
不是人工桌面验收。

参考的可复核任务序列：收起浮球 → hover 展开 → 点击固定 → 在同一会话 queue 多轮任务 →
激活已运行的另一应用 → 继续操作 → 从 History 恢复 Orb 会话。running、question、selection 和
pinned 状态阻止自动收起；Access 是三档能力选择，不要求先选窗口或填写 scope。

改前、参考基线与当前截图：

- 改前 pi-orb 面板：[before-panel.png](../evidence/frontend-port/before-panel.png)
- 改前 pi-orb 浮球：[before-ball.png](../evidence/frontend-port/before-ball.png)
- 参考面板：[reference-panel.png](../evidence/frontend-port/reference-panel.png)
- 参考浮球：[reference-ball.png](../evidence/frontend-port/reference-ball.png)
- 当前面板：[after-ready.png](../evidence/frontend-port/after-ready.png)
- 当前浮球：[after-ball.png](../evidence/frontend-port/after-ball.png)
- 当前授权面板：[after-access.png](../evidence/frontend-port/after-access.png)
- 当前历史面板：[after-history.png](../evidence/frontend-port/after-history.png)
- 当前暗色、输入、提问、停靠和工具过程对照：[visual-review.md](../evidence/frontend-port/visual-review.md)
- 当前打包交互探针：[interaction-probe.json](../evidence/frontend-port/interaction-probe.json)

`before-*` 固定记录迁移前的漂移；`reference-*` 是参考提交的同尺寸基线；`after-*` 是当前打包
Electron 窗口的截图。截图只证明 renderer 状态和壳层几何，不能替代真实模型跨应用验收。

## 差距与当前实现

| 维度 | 改前差距 | 当前实现 | 尚未证明的部分 |
|---|---|---|---|
| 主操作结构 | Access 菜单混入截图、模型、快捷键和窗口设置 | 顶部只有 `History / Access / New`；模型、截图、快捷键在右键菜单或原有全局手势 | 当前打包页面的逐状态人工截图对照 |
| 授权 | 每任务自由文本 scope 与单次 task grant | Access 直接选择 `Read Only / Workspace Write / Full Access`；grant 绑定 session 与 generation | 真实用户完成长任务时的授权可理解性 |
| 目标窗口 | 必须显式选窗并保存固定 target | 每次 observe 自动读取当前前台窗口，排除 Orb；action 绑定 observation 和窗口身份 | 两个真实应用间的模型自主切换与继续操作 |
| 连续任务 | turn 完成或错误后撤权 | Pi Web 同一 session 排队处理 prompt；正常 idle 保留 Access | 真实模型三轮连续任务及中途 stop 的完整人工体验 |
| 跨应用 | 只有特殊 target 切换路径 | `open_app` 按参考语义激活或启动应用；成功后立即返回新窗口截图 | 当前工具集真实模型复验 |
| 状态动效 | 静态头像与额外 thinking dots 争夺反馈 | 使用参考 GIF；expanded、running、question、selection 状态播放，idle 状态冻结；移除重复 dots | 打包窗口中所有状态的视觉对照与 reduced-motion 人工感受 |
| 面板层级 | workspace、权限、预览、模型面板挤压 transcript | 首屏保留参考的球、三控件、transcript 和输入；Pi 必需截图确认及工作区门槛作为独立状态 | 长 transcript、极端输入高度和多屏/DPI 下的真实桌面检查 |
| 动作反馈 | 工具成功后模型仍会额外猜测是否需要 observe | 每个成功 action 返回带截图的新 observation 与 id；下一 action 必须引用该 id | 真实模型是否稳定读取并使用动作结果 |
| 测试 | 仅覆盖部分移植状态，参考有 38 个 renderer 行为规格 | 本地 JSDOM 用真实页面 DOM 覆盖适用的 hover、pin、delay、queue、History、Access、question、selection、主题、输入、菜单和动效状态；broker 覆盖动作后 observation | 没有声称覆盖参考全部 38 项；仍需补足剩余适用规格与真机体验 |

## 验证口径

实现与测试分为三层，不能互相替代：

1. **自动化合同**：`npm test` 覆盖 renderer、session queue、Access、broker 新鲜度和生命周期纯逻辑。
2. **Electron 产物**：`node evidence/p2-05/run-p2-05.mjs` 验证构建、包内容和实际启动窗口。
3. **真实模型与交互桌面**：`node evidence/p1-06/run-real-model-c7.mjs c7`、`d6-scroll`、
   `d8-type` 以目标自身日志及模型 session 记录作判断；另需跨应用人工验收。

旧参考 backend 记录曾出现 C7 18/24、D6 24/25、D8 24/25 的失败结果，均未完整通过；这些 JSON
仍作为历史记录保留。当前 session Access 脚本输出 `real-model-*-session-access.json`，不会覆盖
历史记录：本轮 C7 在截图前失败，D6 因 `LockApp`/不可交互桌面中止，D8 未完成。后台
`code_agent` 真实模型完成闭环已由 `evidence/p1-06/real-model-code-agent-session.json` 通过 8/8；
取消/失败和 GUI 新合同仍未验证。新输出若缺失、失败
或环境中止，真实模型闭环仍标记为未验证。

## 适配边界

浮球 DOM、CSS、交互状态机、动效、停靠与输入行为直接复用固定参考提交；Pi Web session、受限
preload、session Access grant、Windows foreground API 和截图逐张确认是必要宿主适配。dsh RPC、iframe、
Cordis/DSH 会话引擎不移植；`code_agent`、打开 URL/本地路径、自动启动应用和截图导出已按 Pi/Electron 边界适配，macOS TCC 不在首发范围。
素材和代码来源及许可见 [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。
