# 插件参考更新、小控件取点与调用耗时

> 本页的 pixel 坐标实验和旧扩展证据属于 2026-10-01 的历史记录。当前运行时已按
> `dsh-orb-cordis@9cdc50302d202f4497569731be488a8afa500da7` 的默认 millifraction 契约
> 固定为截图相对的 0–1000 坐标；请以 [`reference-toolset-transition.md`](./reference-toolset-transition.md)
> 和 [`toolset-comparison-2026-10-04.md`](./toolset-comparison-2026-10-04.md) 作为当前实现依据。

## 参考核对（2026-10-01）

- 新插件：`rain-knows/dsh-orb-cordis@9cdc50302d202f4497569731be488a8afa500da7`，完整只读检出
  `D:\pi-orb-ref\dsh-orb-cordis`；无安装依赖、无执行参考项目。MIT，mini-yifan / DeepSeek 归属分别保留。
- 旧单体远端：`51f09764d7ff99947be08ebbb2ca2388faab3df4`；与现基线 `72f1d738` 比较，
  Computer Use 文件无变化。Windows 升级安装身份调整不适用于本轮，保留生产原生基线。
- 历史问题证据：`evidence/tool-speed/real-model.json` 的紧凑 A/B/C，单步 2/3、批量 0/3；
  `real-model-large-controls.json` 大控件两种模式均 3/3。工具完成不是业务任务成功。

## 实施边界与来源

| 来源（新插件同一固定提交） | 复用方式 | 必要适配 / 不复用原因 |
|---|---|---|
| `packages/computer-use/src/coordinates.ts:166-215` | 直接复用 pixel 校验及 pixel → HID 公式 | 模型侧统一像素；原生 HID 继续现有 millifraction；不保留模型双模式/设置或 dsh 日志迁移 |
| `packages/computer-use/src/raster.ts` | 直接移植头部解析 | 从 Pi 已归一化的 PNG/JPEG 读尺寸，不能用 Win32 窗口大小假冒 attachment 大小 |
| `coordinate-mode.ts` 的 `rememberObservation` / `firstFrameNotice`、`observe.ts:132-143`、`policy.ts` | 复用 attachment 尺寸绑定和像素提示语义 | 用公开 Pi context 钩子替代 Cordis projection；缓存须绑定 session、generation 和 observation_id，尺寸缺失或旧编号拒绝 |
| `policy.ts` 的顺序批量与最后图像语义 | 复用最后截图做下一步判断 | 本次请求只保留最新 Orb 图片；用户附件、其他工具、持久历史不变，不重复解码/压缩 |

Pi 0.87.1 的 `agent-session.js` 在 `tool_result` 后执行 `normalizeToolResultImages`，随后公开
context 收到归一化消息；默认上限 2000×2000，模型还可声明尺寸限制。因此在原始 capture
处固定像素宽高会漂移。本项目只在 context 投影中添加实际 `attached_size`，工具执行在扩展边界
映射到既有 HID 单位；主进程的授权、观察新鲜度、窗口区域变化、取消和串行锁照常校验。
不改 Pi/pi-web，不访问其内部图片处理入口，不增加压缩依赖。

600ms 保留：此前菜单/弹窗等待实验已证伪 400/200ms。速度优化优先减少重复图像与模型往返，
不跳过动作后观察，也不自动重试误点。

## 验证

自动化：46 个测试文件 / 461 测试通过；typecheck、lint、构建通过。新增用例覆盖非正方形、
SDK 缩放后的真实尺寸、PNG/JPEG、拖拽双端点、越界/NaN、旧观察、session/generation 切换、
整批拒绝且不发送任何输入，以及一图预算不修改持久历史。源码/许可散列见
`evidence/tool-speed/plugin-reference.json`（`record-plugin-reference.mjs` 可重新生成）。

真实链路使用 `TZcode/deepseek-v4.1-flash`、thinking `off`，独立 Pi agent、session/workspace、
Electron userData 和端口。服务进程从本机已构建的 pi-web `95a58744532c7fccaa933aa7757a1419ace67ed2`
启动；检出仍含原有六项 UI 修改，不冒充干净源码构建。`verify-baseline.mjs` 确认 HEAD/六项修改
未变。没有改动用户服务、模型配置、认证文件或普通会话；结束后删除隔离 agent 的凭据链接。

夹具为 650×850 DIP 原生窗口，本机 DPI=1.5，附图为 957×1266 像素。脚本只发任务文本，
没有向模型提供坐标；成功以目标真实事件 a→b→c 或 menu-item 读回判定。

| 布局 / 模式 | 任务成功 | 每任务模型响应 | 总耗时中位数 / 最大值 |
|---|---|---|---|
| 原紧凑布局，单步三控件 | 3/3 | 5 | 18.42s / 20.01s |
| 原紧凑布局，一批三控件 | 3/3 | 3 | 12.38s / 13.06s |
| 28×24 DIP 按钮，单步三控件 | 3/3 | 5 | 18.41s / 20.52s |
| 28×24 DIP 按钮，一批三控件 | 3/3 | 3 | 11.68s / 12.90s |
| 菜单依赖任务（各布局一次） | 2/2 | 4 | 15.44s / 14.91s（各单样本） |

共 14/14 任务，见 `real-model-pixels.json`、`real-model-pixels-tiny.json` 和可重算的
`pixel-summary.json`。单步每任务累计发 4 图，批量累计发 2 图；每请求最多 1 图。
批量的三张动作截图仍在工具结果历史中（每任务含初始观察共 4 图），没有跳过逐步截图/等待。
菜单项出现后才另发第二个 click，没有错误合批。仅三样本/模式，所谓 p95 即样本最大值；
不能据此承诺所有应用的准确率或提速比例。

28×24 布局的原生阶段中位数 / p95：输入 154/165ms（20 次），动作后等待 606/614ms（20 次），
捕获与 PNG 38/49ms（27 次），窗口枚举 15/21ms（74 次）。模型响应与往返仍占主要耗时，
没有引入另一套图片压缩或降低生产等待。

### 失败与限制

- 两次初始启动未完成：P0 临时 pi-web 检出缺少 Next 入口/构建，已补预检与错误定位；
  保留 `real-model-pixels-startup-{failure,diagnostics}.json`。
- 独立源码构建曾占用过多内存，已终止本轮创建的构建树；第一轮像素实验在四项任务成功后
  原生退出，见 `real-model-pixels-shell-exit.json`。未将中断结果算入完整对照。
- 从 `7fbb5f90d0` 导出旧扩展后，两轮复跑出现相同 Electron 主进程退出码 `0x80000003`，
  见 `real-model-fraction-recheck{,-logged}.json`。它也发生在第一张观察期间，不能仅归因为
  旧三图预算或误点。原生日志未给出 FATAL；当前未确认根因，不宣称该退出已修复。
- 加入本地、禁止上传的 Electron crashReporter 后，旧扩展完成一轮：单步 3/3、批量 2/3、
  菜单 1/1，第三批事件为 a,c，确属取点错误；见 `real-model-fraction-crash-reporter.json`。
  启动诊断方式有差异，不能把这轮作为严格的修复前后耗时对照，也不能视为退出根因已消除。
- 相同诊断方式的第二轮同样单步 3/3、批量 2/3、菜单 1/1，见
  `real-model-fraction-crash-reporter-repeat.json`；未发生原生退出，没有采到崩溃栈。
- 旧紧凑历史记录 2/3、0/3 原样保留。干净机器安装、跨应用模型流程、多屏与高权限窗口仍按
  支持矩阵未验证；本轮没有改变打包形态，不声称旧安装器已包含新依赖。

## 原生依赖修复

检查现有依赖后发现 Koffi 2.14.1 早于新 Node 回调相关修复。依据
[官方 changelog](https://koffi.dev/changelog)：2.15.3 修复近期 Node 的 `IsOnCentralStack()`
回调断言，2.16.1 修复 Windows 回调栈检查崩溃，2.16.3 修复关闭期间异步回调崩溃。
这些与本轮原生退出相关，是升级依据，尚不足以确认三次退出的精确原因。

精确锁定 `koffi@2.16.3`，未增加依赖或自行重写 FFI。重新核对旧参考的三个适配点：
`koffi.sizeof(INPUT) === 40`、`koffi.address(HWND)`、callback pointer/register/unregister
接口仍成立；原生代码保持现有版本边界，不增加回退。安装脚本许可改为该精确版本，许可清单同步。
`native-callback-stress.json` 记录实际 Electron + 生产 FFI 的 1000 次窗口枚举和 50 次 GDI/PNG
捕获，18.14s 完成，没有保存截图；该探针不替代模型链路或长时间应用验收。

更新依赖后再次使用生产入口（没有诊断 bootstrap）完成 28×24 DIP 实际模型整轮 7/7：
单步三控件中位 18.99s / 最大 20.79s，批量 11.03s / 最大 12.14s，菜单 16.63s。
无原生退出，仍每请求最多一图；见 `real-model-pixels-koffi-fixed.json`。加上前两轮像素测试，
共 21/21 任务通过；不包含中断的失败探针。最新原生分段中位数 / p95：输入 152/162ms，
等待 606/612ms，捕获 PNG 40/48ms，窗口枚举 15/22ms（样本量分别 20/20/27/74）。

## 包内容与运行验证

升级后初次打包审计仍报通过，但人工检查发现 Koffi 新增 `lib/native/base` 下的 `.hh/.inc/.py`
残留，原记录保留为 `package-audit-koffi-before-trim.json`。其“passed”不能作为无源码残留证明。
参考原有 `runtime-file-policy.ts:42` 的最小 runtime 原则，补充排除 `node_modules/koffi/lib/**`；
核对新版 `index.js` 只从 `build/koffi/win32_x64` 加载预编译模块，此目录无需发布。
审计同时增加实际发布的依赖版本与 `.node` SHA-256 和本轮验证二进制一致的检查。

对修正后的包放回一个真实 `base.hh`，审计确实拒绝该产物；反证见
`package-audit-koffi-headers-rejected.json`。随后删除测试注入并完整重建。
`node evidence/p2-05/run-p2-05.mjs` 通过：构建 → 包内容 27/27 → 该解包产物启动 22/22。
当前可运行产物是 `release/0.1.0/win-unpacked/pi-orb.exe`；没有声称历史 NSIS 安装器被重建。
最终质量门禁 66/66，包括 461 测试与 pi-web HEAD/六项既有修改未变。
