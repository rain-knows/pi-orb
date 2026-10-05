# pi-orb 支持矩阵

> 工具集已于 2026-10-05 切换到参考项目的 13 个 Computer Use 工具；本页旧版 Playwright
> 行仅为历史证据，当前没有浏览器 DOM 网关。当前契约见 `reference-toolset-transition.md`。

本文件是 pi-orb 唯一的版本兼容性声明来源。**没有经过验收的组合一律标记为“未验证”**，不因代码可以编译、依赖可以安装或文档宣称跨平台而视为支持。

- 维护规则见 [`pi-orb-development-goals.md`](./pi-orb-development-goals.md) §7.2（上游更新策略）。
- 版本与许可取证的原始记录见 [`../evidence/p0-04/cua-artifact-manifest.json`](../evidence/p0-04/cua-artifact-manifest.json) 与 [`../evidence/p0-01/environment-baseline.json`](../evidence/p0-01/environment-baseline.json)。
- 本文件随每个发布版本更新；未验证项不得因“后续再验证”而升级为支持项。

## 1. 当前基线组合（开发基线）

下表是**本机开发与证据采集时实际使用的组合**，不等于完整 v0.1 的受支持组合。
P1/P2 实现与证据已经落地；当前仅发布预览版，§3 的未验证项仍保留。

| 组件 | 版本 | 状态 | 依据 |
|---|---|---|---|
| pi-orb | `0.1.0-preview.3` | 本地 Windows x64 未签名构建，尚未发布；旧发布版为 preview.1 | 本仓库 `package.json`、`CHANGELOG.md` |
| OS | Windows 11 x64（Build 26200） | 首发目标平台 | `evidence/p0-01/environment-baseline.json` |
| Node.js | `24.19.0` | 开发基线 | `evidence/p0-01/environment-baseline.json` |
| npm | `11.17.0` | 开发基线 | 同上 |
| Electron | `44.4.5` | 首个实测点 | `evidence/p0-03/README.md`（真实 Electron 腿 16/16） |
| Pi SDK | `@earendil-works/pi-coding-agent@1.0.0` | 当前源码与 Pi Web 宿主一致；提示词/插件/模型闭环已验证 | `evidence/upgrade-0.10/`；旧 P0 为历史记录 |
| Pi CLI | `@earendil-works/pi-coding-agent@1.0.1` | 本机全局命令与扩展更新完成；Orb 会话由 Pi Web 的 SDK 驱动 | `evidence/upgrade-0.10/environment.json` |
| pi-web | P0/P1 隔离验收使用 `@agegr/pi-web@0.9.3`，固定提交 `95a58744532c7fccaa933aa7757a1419ace67ed2` | 固定快照已完成生产构建、条件插件加载与工具暴露验收；本机当前 `@agegr/pi-web@0.10.0` (`62dc24b11aa9f4f7cc7ed9597fa584a94758cfdf`) 含用户未提交改动，未纳入支持基线 | `evidence/p0-02/result.json`、`evidence/p1-06/tool-exposure.json` |
| 桌面驱动 | `deepseek-harness-orb@72f1d738458a223696685a909e806b683eff5885` 的 Windows native backend，仓内 `src/main/reference-windows/` | 已接入唯一生产 action path；桌面闭环和历史真实模型运行记录存在，但 2026-09-30 C7/D6/D8 复跑未完整通过，暂不宣称稳定支持 | `tests/reference-windows.test.ts`、`tests/reference-windows-driver.test.ts`、`evidence/p1-06/` |
| 新插件参考 | `dsh-orb-cordis@9cdc50302d202f4497569731be488a8afa500da7`（MIT） | 已检出/核对；13 个工具、默认 millifraction 契约和后台 code_agent 作为当前移植基线；不是运行时依赖 | `doc/reference-playbook.md` §1.2、`doc/reference-toolset-transition.md` |
| Windows FFI | `koffi@2.16.3`（MIT，精确锁定） | 替换 2.14.1；原生回调/截图压力探针 1000 枚举 + 50 捕获通过；并非对间歇退出根因的证明 | `evidence/tool-speed/native-callback-stress.json`；`doc/plugin-reference-and-pointing.md` |
| 快捷键边沿监听 | `uiohook-napi@1.5.5` | Windows Node 环境可加载并完成 `start/stop`；hook 不可用时快捷键失败而不静默降级；真实长按仍需 Electron 人工复测 | `src/main/shortcut-edge-guard.ts`、`tests/shortcut-edge-guard.test.ts` |
| renderer 构建 | `vite@7.3.6` + `electron-vite@5.0.0`，原生 HTML/CSS/JS renderer | 构建通过；已删除 React 与 Vite React 插件 | 本仓库 `npm run build` |
| TypeScript | `5.9.3`（`strict`） | 类型检查通过 | 本仓库 `npm run typecheck` |
| 测试 | `vitest@5.0.2` | 单测通过 | 本仓库 `npm test` |

### 依赖安装注意（环境事实）

| 事实 | 后果 |
|---|---|
| npm 11 默认拦截安装脚本 | `electron`、`esbuild` 需 `npm approve-scripts`；否则 `electron` 二进制不下载，构建后的应用无法启动 |
| 外层 `NODE_ENV=production` | `npm install` 会静默跳过全部 devDependencies |
| Electron 二进制默认下载源在本机不可用 | 需 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 后执行 `node node_modules/electron/install.js` |

### 固定依赖的理由

| 依赖 | 约束 | 理由 |
|---|---|---|
| `electron` | **精确** `44.4.5` | 窗口、沙箱与跨 origin 行为必须锁定版本实测；P0-03 的第一个实测点就是该版本 |
| `deepseek-harness-orb` Windows backend | **精确** `72f1d738458a223696685a909e806b683eff5885` | 直接导入并保留 MIT 通知；只在 pi-orb 的 Pi/授权/bridge 边界做薄适配 |
| `@earendil-works/pi-coding-agent` | **精确** `1.0.0` | P0/P1 固定快照与当前 Pi Web 工作树都使用该宿主 SDK；扩展 API 以该版本的类型声明为准 |
| `vite` | `7.3.6` | `electron-vite@5` 的 peer 范围是 `^5 \|\| ^6 \|\| ^7`，不含 `8` |
| `typescript` | `5.9.3` | `typescript-eslint@8` 的 peer 上限为 `<6.1.0`，且不使用 TS 7 预览版 |
| `eslint` | `9.39.5` | 使用 `typescript-eslint@8` 支持的稳定主版本 |
| `node` | `>=24.19.0` | 与开发基线一致；`vitest@5` 要求 `^22.12 \|\| ^24 \|\| >=26` |

## 2. 已支持 / 已验证

当前没有可发布的完整 v0.1 支持行。已完成并有证据的能力按阶段记录在 `evidence/` 下：

| 能力 | 状态 | 证据 |
|---|---|---|
| 条件注册：非 Orb cwd 不新增工具、命令或 prompt section | 已验证（P0-02，27/27 断言） | `evidence/p0-02/` |
| 客户端认证、创建独立会话、发消息、重连、停止、退出不杀服务 | 已验证（P0-03 Node 27/27 + Electron 16/16） | `evidence/p0-03/` |
| 沙箱 renderer 直连 pi-web 被拒（403），须经主进程代理 | 已实测 | `evidence/p0-03/result-electron.json` |
| 只读窗口枚举、截图与解码、逐周期 GDI 零增长 | 已验证（只读） | `evidence/p0-04/` |
| pi-web 既有 6 个改动文件的哈希基线可校验 | 已验证 | `evidence/p0-01/verify-baseline.mjs` |
| **P1-01 工作区与独立会话**：未选工作区不能启用；取消零写入；精确 cwd 匹配（子目录与前缀相似同级目录均不匹配）；junction 与大小写拼写归一到同一标识；切换工作区不串会话且不毁历史 | 已验证 | `evidence/p1-01/`（集成 19/19，应用 22/22） |
| **P1-02 Electron 最小浮窗**：聊天闭环、流式输出、显式停止、独立会话可被 pi-web 浏览、renderer 无 Node/无直连 | 已验证 | `evidence/p1-02/`（35/35） |
| **P1-03 唤醒快捷键**：OS 级注册、冲突可诊断、改键与退出释放槽位 | 已验证（第二进程竞争探针） | `evidence/p1-03/`（21/21） |
| **P1-04 截图授权与正向路径**：无目标拒绝且零上传、伪造确认零上传、text-only 模型不收到图像、per-monitor-v2 DPI 感知生效；真实窗口→预览→确认发送全链 | 已验证 | `evidence/p1-04/`（43/43） |
| **仅文本模型截图发送前拒绝**：Orb 从会话工作区查询当前模型能力，明确拒绝且 provider 请求数不增加；图像模型仍能发送 | 已验证（隔离产品链路） | `evidence/p1-04/result.json`（43/43）；人工复测待重启 Orb |
| 捕获源窗口身份：`window:<hwnd>:<index>` 中间段为真实 Win32 句柄 | 已验证（只读枚举，不产生像素） | `evidence/p1-04/capturer-probe.json` |
| **历史 Cua 0.30.1 安装物**：版本、许可构成与两个裸二进制 SHA-256 均与 P0-04 清单一致 | 历史探针已验证，不属于当前生产能力 | `evidence/p1-05/input-verification.json` |
| **历史 Cua 运行时工具目录**：57 个工具；窗口 id 为 bigint；窗口有前序 zIndex | 历史探针已验证，不属于当前生产能力 | `evidence/p1-05/cua-runtime-probe.json` |
| **历史 Cua 坐标空间差异**：`getScreenSize` 报 1707x1067 而物理为 2560x1600；窗口 bounds 为物理像素，动作为屏幕 DIP | 历史探针已实测，不属于当前生产能力 | `evidence/p1-05/input-verification.json` |
| **点击坐标换算的正确性**（两种记录矛盾，以产品整链路实测为准） | **产品整链路实测已裁决**：当前实现「分数 × 驱动上报窗口尺寸」命中 `1,2`（`loop-verification-session-access.json`）；曾据一次直调探针改成「屏幕 DIP − 物理原点」，**同链路实测落 `0,1`**，故不采用。P1-05 记录的那条规则与本次链路实测相矛盾，其**逐次落点归属存疑**（与本次探针同类问题） | `evidence/p1-06/loop-verification-session-access.json`；`doc/cua-driver-integration.md` §1 记录了两侧数字与残留疑问 |
| **模型坐标契约：最新附加截图的 0–1000 millifraction** | 已验证：截图分数 → HID 分数 → 原生位置；会话/代次/观察绑定和动作后新截图均有自动化覆盖 | `tests/coordinate-mapping.test.ts`、`tests/orb-tools.test.ts`、`tests/reference-windows-driver.test.ts`、`evidence/p1-06/loop-verification-session-access.json` |
| **截图取点→输入落点在**同一次运行**内一致（C7 产品侧闭环）** | 已验证（自动化闭环：取的是截图分数，落点由目标自身日志判定） | `evidence/p1-06/loop-verification-session-access.json`（当前运行全项通过）——取分数 `(611.6,360.4)` → 目标 JSONL 命中 `1,2` |
| **历史 Cua 后台点击**：4/4 瞄准格子命中，且不抢前台 | 历史验证；当前参考 Win32 backend 使用可见 GUI／SendInput，不声明任意后台窗口点击支持 | `evidence/p1-05/input-verification.json` |
| **历史 Cua 后台输入文本**：向原生应用投递并读回 | 历史验证；不属于当前参考 Windows backend 的后台投递能力 | 同上 |
| **通用桌面体验改进**：按请求选窗、默认完全访问、中文状态行、草稿保持、运行输入光标隐藏、工具期间不隐藏面板 | 单测及打包交互已验证；实际 bridge／broker／Win32 点击自报目标 `0,0` 通过，未宣称模型自主跨应用或任意后台 GUI 投递 | `doc/orb-experience-improvements.md`；`evidence/frontend-port/interaction-probe.json`、`native-target-probe.json` |
| **前台点击投递**：目标记录到真实 `mouse-down`，驱动报 `delivery_mode:foreground` | 已验证 | 同上 |
| **历史 Cua 前台滚动的物理到达与生效**：曾在一次运行中由目标日志证实；2026-09-28 最新复跑驱动虽报成功但目标为 0 个 `wheel` | **历史 Cua 路径不稳定，不属于当前生产能力**；当前参考 backend 的 D6 以真实模型目标日志单独判定 | `evidence/p1-05/input-verification.json`（历史探针）；`evidence/p1-06/real-model-d6-scroll-reference-backend.json` |
| **历史 Cua 后台→前台升级**：typed `scroll` 无法表达 `delivery_mode`，旧适配器曾按 `background_unavailable` 升级 | 历史探针已验证；适配器已删除，不属于当前生产能力 | `evidence/p1-05/input-verification.json` |
| **历史 Cua 拒绝结果解析**：驱动拒绝不能被适配器误报为成功 | 历史探针已验证；当前 broker/参考 backend 有独立拒绝合同 | `tests/desktop-broker.test.ts`、`tests/reference-windows-driver.test.ts` |
| **按键/鼠标无残留** | 已验证（直接采样 OS 全局键态，输入前后差分；不依赖目标窗口日志，因后者含测试自身的 ALT 解锁） | 同上 |
| **C6：真实 native 按下中途取消释放** | 已验证；disposable target 自身日志收到 `mouse-down=1`、匹配 `mouse-up=1`，取消错误也正确上报 | `evidence/p1-05/reference-cancel.json`（5/5） |
| **参考工具集仅限 Orb 模式**：Orb 工作区当前 13 个 GUI 工具，并提供 `code_agent`、`code_agent_status`、`code_agent_stop`；普通 Pi/Pi Web 会话不新增 Computer Use 或后台任务工具 | 真实 Pi loader 的工作区边界与活跃工具 roster 见 `evidence/personal-startup/plugin-load.json`；工具契约见 `doc/reference-toolset-transition.md` | `pi-package/extensions/orb.ts`、`pi-package/extensions/code-agent.ts`、`tests/orb-tools.test.ts` |
| **真实模型后台 `code_agent` 完成闭环**：模型调用、独立 Pi Web worker、产物写入和 owner 单次完成通知 | 已验证（8/8；真实 provider `TZcode/deepseek-v4.1-flash`，隔离 workspace，凭据仅硬链/符号链） | `evidence/p1-06/real-model-code-agent-complete-session.json`、`evidence/p1-06/run-real-code-agent.mjs` |
| **真实模型后台 `code_agent_stop` 停止闭环**：模型调用、产品桥停止、worker 注册表归零、无产物和无完成通知 | 已验证（10/10；真实 provider `TZcode/deepseek-v4.1-flash`，隔离 workspace，凭据仅硬链/符号链） | `evidence/p1-06/real-model-code-agent-stop-session.json`、`evidence/p1-06/run-real-code-agent.mjs stop` |
| **真实后台 provider 失败回读**：最终助手错误、持久注册表与前台单次失败通知的错误全文一致 | 已验证（12/12；隔离 worker 的实际请求触发真实 provider 503）；同时覆盖只有 settled、没有 prompt_error 的结束路径 | `evidence/p1-06/real-model-code-agent-failure-session.json`、`tests/code-agent-manager.test.ts`、`tests/pi-web-image-model.test.ts` |
| **桌面工具闭环**：session Access、新鲜度、拒绝零副作用、真实点击落点为目标格心 | **已验证（当前 session Access backend）**；自动前台观察、Read Only/Workspace Write、点击、滚动、撤权均由 disposable 目标与壳日志证明 | `evidence/p1-06/loop-verification-session-access.json` |
| 桥准入：无会话/错误令牌/浏览器来源/旧代次均被拒 | 已验证 | `evidence/p1-06/` + `tests/bridge-server.test.ts` |
| Orb 扩展仅凭握手文件连接壳的命名管道：无需额外设置 `PI_ORB_BRIDGE_PIPE` | 已验证（隔离管道测试 + 当前壳只读探针） | `tests/bridge-client.test.ts`；2026-09-28 `hello.ok=true`，无效会话返回 `unknown-session` |
| **第三方许可清单**：每个已安装生产依赖均声明许可，无 AGPL/GPL-3/SSPL | 已验证 | `evidence/p1-07/license-inventory.json` |
| **`cua_driver_sdk.dll` 的 MPL 归属核实**：交付物中无任何证据把 MPL 归于该 DLL（无许可文本、不引用 uniffi runtime、仅导入系统库） | 已核实并记录 | `THIRD_PARTY_NOTICES.md` §3 |
| `@ubjs/*` 三个包（MPL-2.0，随发行） | 已识别并计入 NOTICE | 同上 §2–§3 |
| **发布门禁**：质量门禁、非破坏性、凭据/像素、忽略规则、许可、版本一致性、证据完整性、打包配置与产物审计记录、CI 与发布流程、renderer 参考一致性 | 已验证（且多次反向对照可证伪） | `evidence/p1-07/release-gate.json`（66/66） |
| **session Access 生命周期**：新会话与明确重开默认完全访问；turn idle 保留 grant 并隐藏观察框；Stop、隐藏、断连撤权；workspace/session 切换替换为新会话 grant | 当前探针 21/21 通过；原生与 DOM 工具结束后的模型思考期间仍显示光效；首次启动失败保留 | `evidence/p1-07/session-access-regression.json`；`doc/session-continuity.md` |
| **浏览器窗口工具**：通过 `open_in_browser` 打开默认浏览器或 http(s) 地址，再使用参考项目 GUI 工具观察和操作可见窗口 | 当前代码和打包审计已移除 DOM/Playwright 网关；真实模型浏览器闭环仍待人工验收 | `pi-package/extensions/orb.ts`；`doc/toolset-comparison-2026-10-04.md` |
| **P2-01 参考浮球体验**：72px 球、344x444 展开 bounds、方向选择、左右停靠 tab 与**停靠滑动动画**、拖动 IPC、收起还原、hover/pin、系统主题、参考 GIF 状态动效、History/Access/New、连续 prompt、问题卡片、**观察框**、**布局变化后仍可找回** | 已接入；JSDOM、打包探测和 renderer parity 自动化通过；跨应用真实模型流程、多屏/DPI 与逐状态人工视觉验收仍未验证 | `tests/floating-geometry.test.ts`、`tests/floating-dock-animation.test.ts`、`tests/floating-recovery.test.ts`、`tests/renderer-reference-parity.test.ts`、`tests/observation-frame.test.ts`、`tests/floating-renderer.test.ts`、`tests/orb-session.test.ts`、`src/main/floating-window-controller.ts`、`src/main/observation-frame.ts`、`src/main/index.ts`、`src/renderer/index.html`、`src/renderer/floating.js`、`src/renderer/floating.css`、`evidence/frontend-port/visual-review.md` |
| **P2-02 双 Alt 手势检测**：左右物理 Alt、时序窗口、单次触发、组合键拒绝、退出卸载、进入截图预览、锁屏／休眠后清除遗失的按键状态 | 已接入（纯状态单测、类型、lint 和构建通过；实际键盘及真实锁屏／休眠体验未验证）。参考项目固定提交 `72f1d738458a223696685a909e806b683eff5885` 无对应全局手势；本项是 Pi 接入所需的独立能力 | `tests/double-alt.test.ts`、`tests/double-alt-recovery.test.ts`、`tests/shortcut-edge-guard.test.ts`、`src/main/double-alt.ts`、`src/main/shortcut-edge-guard.ts`、`src/main/index.ts` |
| **P2-03 history 与选区上下文**：当前 workspace 摘要、历史 session 绑定、文本 transcript 恢复、Windows UI Automation 选中文字 chip | 已接入（公开 API adapter、workspace 过滤、选区纯逻辑测试和 bridge 接入通过；真实 UI Automation 与人工窗口体验未验证） | `tests/pi-web-history.test.ts`、`tests/orb-session.test.ts`、`tests/windows-selection.test.ts`、`src/main/windows-selection-native.ts`、`src/main/index.ts`、`src/renderer/floating.js`、`evidence/p2-03/README.md` |
| **P2-04/P2-06 桌面操作扩展**：参考按钮/次数/修饰键、replace/submit、纵向滚动、等待、应用列表、前台信息、热键、长按、同窗口拖拽、动作后回图、显式截图导出、浏览器/文件夹打开及应用激活或启动 | 已接入自动化；真实桌面动作、目标像素、保存对话框、剪贴板和真实模型仍需人工验收 | `doc/desktop-tools-port.md`、`tests/orb-tools.test.ts`、`tests/desktop-broker.test.ts`、`tests/reference-windows-driver.test.ts`、`tests/reference-windows-input.test.ts` |
| **P2-05 Windows x64 打包产物**：NSIS 每用户安装包与解包目录可构建 | 当前 preview.3 本机构建，内容审计 30/30、实际启动 22/22；旧 preview.1 发布与 GitHub runner 动画失败披露保留在发布记录 | `electron-builder.config.mjs`、`evidence/p2-05/`、`doc/release-process.md` §9 |
| **P2-05 产物内容审计**：产品文件在 asar 的运行时路径上、许可证随包、无仓库源码／测试／证据／凭据／密钥／其它平台二进制／构建残留，Koffi 版本和二进制匹配验证环境 | 已验证（30/30，新增头文件残留反证） | `evidence/p2-05/package-audit.json`、`evidence/tool-speed/package-audit-koffi-headers-rejected.json` |
| **P2-05 打包产物可运行**：真实启动 `pi-orb.exe`，preload 桥可用、renderer 无 Node 权限、构建后 renderer 与素材从 asar 加载、参考壳层已挂载且令牌解析为参考值、**停靠滑动观测到真实位移**、session Access bridge 存在且旧选窗 API 不存在 | 已验证（22/22；桌面 native action 闭环另由 session Access 探针证明） | `evidence/p2-05/packaged-smoke.json` |
| **参考项目 Windows 后端自带的规格测试已移植**：窗口选择 10 条不变量 + 输入 13 条（键映射、UIPI 拒绝、剪贴板顺序、滚轮档位、PNG 头等） | 已验证（23/23，逐条对应参考 spec） | `tests/reference-windows-foreground.test.ts`、`tests/reference-windows-input.test.ts` |
| **独立随包 Pi 插件**：无源码目录时加载，完整工具清单保持工作区边界 | 真实 Pi 1.0 加载并检查 15/15；普通会话保持宿主原有活跃工具，Orb 会话获得参考 host roster、13 个 GUI 工具和 3 个后台任务工具；worker 激活已加载的宿主 web 工具，隔离 GUI/前台提示与图片投影；不改写历史。工具 inventory 为受控 fixture，不代表实际搜索服务验证 | `evidence/personal-startup/plugin-load.json` |
| **个人启动与后端复用**：官方 CLI 注册/移除，隐藏 Pi Web 启动、同 PID 复用、真实 API 会话与模型偏好保留 | 隔离用户设置/随机端口 7/7；preview.3 新增 Win32 无控制台探针；不等同于新用户环境安装 | `evidence/personal-startup/backend-startup.json` |
| **个人安装与短命令**：NSIS 安装至中文/空格目录、App Paths/ShellExecute、单实例保留草稿、卸载清理与应用配置保留 | 当前开发机 8/8；完整干净用户环境、交互安装/升级向导与 SmartScreen 仍未验证 | `evidence/personal-startup/installer-smoke.json` |
| **当前账户 preview.2 → preview.3 升级**：静默升级、真实短命令启动、无控制台、同实例唤回、图标与数据保留 | 本机 11/11；模型/凭据字节不变、工作区和快捷键保留；完整干净用户与交互向导仍未验证 | `evidence/windows-startup-and-workspaces/current-user-upgrade.json` |
| **工作区入口与默认完全访问界面**：原生菜单入口、同目录无操作、切换前停止旧任务、实际授权/撤权标签同步 | 单测及实际 Electron/Pi Web UI 生命周期 25/25；参考底板图标用于安装器/快捷方式/托盘 | `evidence/windows-startup-and-workspaces/ui-lifecycle.json`、`doc/windows-startup-and-workspaces.md` |
| **`open_app` 的参考语义**：直接使用 backend 激活/启动；成功后 600ms 返回当时的真实前台截图，慢启动不误报失败；`name` 拒绝路径／参数片段／shell 元字符 | 单测验证实际观察绑定、慢启动、后续 wait、新图、错误和取消；修复后真实模型冷启动→依据截图点击→目标事件→新图 22/22（有限样本） | `tests/reference-windows-open-app.test.ts`、`tests/orb-tools.test.ts`、`evidence/p1-06/real-model-open-app-session-access.json`、`doc/reference-toolset-transition.md` |
| **当前参考工具合同的真实 C7/D6/D8**：自动首帧、模型自主调用、目标实际落点/滚动/输入和动作后新图 | 有限样本通过：C7 20/20、D6 21/21、D8 22/22；存在更早模型取点失败，不代表任意任务稳定成功 | `evidence/p1-06/real-model-c7-session-access.json`、`real-model-d6-scroll-session-access.json`、`real-model-d8-type-session-access.json` |
| **可见默认浏览器闭环**：模型 open_in_browser → wait → click，本地页面收到完成请求 | 有限样本通过 22/22；没有使用 DOM/Playwright 网关，不代表任意网站或登录态覆盖 | `evidence/p1-06/real-model-browser-session-access.json` |

## 3. 未验证（不得宣称支持）

本表只列**尚未验证**的项。已验证项一律在本文件 §2；任何一项验证后必须从本表移出，不得两处同时存在。

| 项 | 为什么未验证 | 影响 |
|---|---|---|
| 多显示器 | 本机仅 1 个显示器 | 多屏坐标、跳屏选区与截图分辨率未测；不得宣称已支持 |
| elevated（高权限）窗口 | 未测试；按目标要求不自动提权 | 高权限窗口的截图与输入语义未知；不得由普通窗口结果外推 |
| 被遮挡窗口 / DirectComposition 类窗口的截图 | 已测可靠的正常路径，但未构造遮挡场景 | 见 `evidence/p1-04/README.md` §4.4 |
| **不同 Chromium 页面输入的广泛稳定性** | 丢弃式 Electron 前台输入已通过当前合同 D8 22/22，未覆盖任意浏览器/页面/IME | 有限样本不能外推广泛支持；旧 Cua 后台投递记录不是当前实现依据 |
| 失败即停由真实驱动失败触发 | 由单测覆盖（`tests/desktop-broker.test.ts`）；整链路未构造真实驱动失败 | 部分验证 |
| 同一任务锁在多会话并发下的行为 | 单测覆盖；整链路只覆盖单会话 | 未验证 |
| 驱动内建授权语义（`desktopCaptureAuthorized`、`desktopUnlocked`、`escalate_session`） | 本阶段未使用；状态实测均为 false | **未验证**；产品侧授权仍由 pi-orb 自己的任务授权与代次绑定负责 |
| 窗口拖动/置顶/展开收起的人工体验 | P2-01 已接入参考几何和 IPC；真实 Electron 拖动、多显示器、DPI、停靠动画和置顶体验尚未人工复测 | 属人工确认；不得据自动断言宣称交互体验已验收 |
| **快捷键的按键人工体验** | OS 注册、冲突诊断与释放已验证；真实 Electron + native hook 集成探针通过，但探针使用合成 F24 输入；真实键盘、AltGr/非 US 布局、锁屏/休眠恢复仍未复测 | 属人工确认；步骤见 `evidence/p1-03/README.md` |
| **P2-04 真机动作与目标像素** | 新动作和动作后 Pi image block 已通过自动化；尚未在 disposable target 上验证真实热键、拖拽、长按落点及回图像素 | 目前不得宣称真实桌面已验收；需按 `evidence/p2-04/README.md` 补做交互式桌面验收 |
| 窗口位置的**跨启动**恢复 | 防抖保存已实现，但未做「移动→退出→重启→恢复」实测 | 未验证；不得宣称已支持 |
| **「存在但不可访问」的工作区**（`no-read-access` / `no-write-access`） | 本机以当前账户无法构造该状态而不改动 ACL（属对用户环境的破坏性操作） | 分支有单测，未真机构造；不得据此宣称已覆盖 |
| 网络驱动器（UNC）路径的实际访问 | 只测了归一化，未做真机访问 | 不得宣称支持网络路径工作区 |
| macOS / Linux | 未在任何非 Windows 平台运行 | 首发仅 Windows x64；不因代码可编译而宣称支持 |
| macOS 屏幕录制 / 辅助功能权限 | Cua SDK 的权限 API 仅 macOS 专属，本机为 Windows | Windows 结果不得外推到 macOS；P1-04 的 macOS 权限缺失提示未验证 |
| 完整 React/Vite UI 栈的跨 origin cookie/SameSite 行为 | P0-03 的 Electron 腿使用纯 HTML renderer | 需在锁定 Electron 版本后复验 |
| pi-web 原地生产构建 | 该 `node_modules` 不完整（缺 `@next/env`），且原地构建 OOM | 属环境限制；测试使用固定 HEAD 快照内独立安装 |
| pi-web 其它版本 / 其它 Pi SDK 版本组合 | 只测试了 §1 中的单一组合 | 未测试的组合统称「未验证」 |
| 上游更新后的兼容性 | 未对任何上游新版本跑过接入合同 | 按 §7.2 流程在独立环境验证后才发布新组合 |
| 双 Alt 的真实键盘体验 | detector 逻辑已实现；未在真实键盘上覆盖左右顺序、长按、AltGr、焦点变化及锁屏／休眠恢复 | 自动化状态测试不证明 OS hook 的实际键盘事件稳定性 |
| 选区上下文 | 属后续 P2 能力；尚未实现 | 不阻塞 v0.1；不得当作已实现 |
| P2-03 选区／辅助功能文本 | Windows UI Automation 读取与 chip 已接入；真实 UIA、选区 bounds、macOS 辅助功能和原生工具栏仍未验收 | 不读取剪贴板，不模拟 Ctrl+C，不把来源标签当作授权 |
| **完整 v0.1 发布** | 上表仍有未验证项（多显示器、高权限窗口、向 Chromium 内容输入文本） | **未完成**；当前交付物不得声明为完整 v0.1 |
| **安装包在干净目标机上的安装／卸载／升级** | 安装会写 HKCU 与用户目录，在已装过的开发机上做不可复现；需要干净账户或一次性虚拟机 | 未验证；步骤见 `doc/manual-acceptance.md` §9（E1–E9） |
| **未签名安装包的 SmartScreen 提示与绕过体验** | v0.1 不做代码签名；提示文案与用户侧行为需真实环境 | 未验证；不得宣称"可直接分发" |
| **卸载后的用户数据与工作区保留** | 需要一次真实的安装→使用→卸载流程 | 未验证；代码侧写入面已由发布门禁审计（只写 Orb userData 与用户确认的工作区） |
| **安装后的浮球观感、真实按键、多屏、DPI** | 属 P2-01/P1 人工项，打包不改变其状态 | 未验证 |

## 4. 已知环境事实（不是缺陷，但影响使用）

| 事实 | 后果 |
|---|---|
| 本机 2560×1600 物理分辨率、约 150% 缩放；DPI-unaware 进程看到 1707×1067 | 桌面 helper 必须显式声明 per-monitor-v2 DPI awareness，否则截图坐标会被当作输入坐标而点错位置 |
| 本机同时存在 `dpi=96`（42 窗口）与 `dpi=144`（256 窗口）两组窗口 | 换算不能假设全局单一比例 |
| pi-web 的 abort 是协作式的 | 实测 abort 不中断底层 provider 请求：**不得**依赖 pi-web 的 abort 完成底层销毁；用户可观察保证（输出停止、任务锁释放）已验收 |
| pi-web 工作树在基线捕获时已有 6 个用户改动文件 | 这些改动属用户所有，不得归因于 pi-orb，也不得被本项目修改 |
| Pi 无条件加载用户级 `~/.agents/skills`，`HOME` 运行时解析 | 该目录存在时会进入**所有**会话（含普通 cwd）的 prompt；Orb 只能承诺“不主动改变它” |
| npm 11 默认拦截依赖安装脚本 | `electron` 与 `esbuild` 需显式 `npm approve-scripts`；`electron` 二进制经 `ELECTRON_MIRROR` 下载 |
| 工作站锁屏时无法前置任何窗口 | 反射式唤醒路径无法把目标窗口记为“用户正在看的窗口”，截图授权链在第一步断掉；此时产品报「recorded window was replaced」对用户是**误导**（真正原因是没有可前置的窗口）。真实模型类验收必须在解锁的交互式桌面下进行。见 `evidence/p1-06/README.md` §5.1 |

工具速度此前阶段见 [实施记录](./tool-speed-optimization.md)，最新插件像素适配与小控件结果见
[后续阶段](./plugin-reference-and-pointing.md)：生产等待保留 600ms；小控件有限样本通过，
失败与原生退出记录保留，不宣称普遍成功率、提速比例或原生退出根因已经解决。
