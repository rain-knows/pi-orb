# pi-orb 支持矩阵

本文件是 pi-orb 唯一的版本兼容性声明来源。**没有经过验收的组合一律标记为“未验证”**，不因代码可以编译、依赖可以安装或文档宣称跨平台而视为支持。

- 维护规则见 [`pi-orb-development-goals.md`](./pi-orb-development-goals.md) §7.2（上游更新策略）。
- 版本与许可取证的原始记录见 [`../evidence/p0-04/cua-artifact-manifest.json`](../evidence/p0-04/cua-artifact-manifest.json) 与 [`../evidence/p0-01/environment-baseline.json`](../evidence/p0-01/environment-baseline.json)。
- 本文件随每个发布版本更新；未验证项不得因“后续再验证”而升级为支持项。

## 1. 当前基线组合（开发基线）

下表是**本机开发与证据采集时实际使用的组合**，不等于已发布的受支持组合。P1 尚未完成，因此当前没有“已支持”的发布行。

| 组件 | 版本 | 状态 | 依据 |
|---|---|---|---|
| pi-orb | `0.1.0`（`Unreleased`） | 开发中 | 本仓库 `package.json` |
| OS | Windows 11 x64（Build 26200） | 首发目标平台 | `evidence/p0-01/environment-baseline.json` |
| Node.js | `24.19.0` | 开发基线 | `evidence/p0-01/environment-baseline.json` |
| npm | `11.17.0` | 开发基线 | 同上 |
| Electron | `44.4.5` | 首个实测点 | `evidence/p0-03/README.md`（真实 Electron 腿 16/16） |
| Pi SDK | `@earendil-works/pi-coding-agent@0.87.1` | P0-02 实测 | `evidence/p0-02/README.md` |
| pi-web | `@agegr/pi-web@0.9.3`，HEAD `95a58744532c7fccaa933aa7757a1419ace67ed2` | P0-02/P0-03 实测 | `evidence/p0-02/README.md`、`evidence/p0-03/README.md` |
| 桌面驱动 | `deepseek-harness-orb@72f1d738458a223696685a909e806b683eff5885` 的 Windows native backend，仓内 `src/main/reference-windows/` | 已接入唯一生产 action path；当前参考 backend 的目标闭环、真实模型 C7/D6/D8 均已取得目标日志 | `tests/reference-windows.test.ts`、`tests/reference-windows-driver.test.ts`、`evidence/p1-06/` |
| 快捷键边沿监听 | `uiohook-napi@1.5.5` | Windows Node 环境可加载并完成 `start/stop`；hook 不可用时快捷键失败而不静默降级；真实长按仍需 Electron 人工复测 | `src/main/shortcut-edge-guard.ts`、`tests/shortcut-edge-guard.test.ts` |
| renderer 构建 | `vite@7.3.6` + `electron-vite@5.0.0` + `@vitejs/plugin-react@5.2.0` | 构建通过 | 本仓库 `npm run build` |
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
| `@earendil-works/pi-coding-agent` | **精确** `0.87.1` | 与 pi-web `0.9.3` 的依赖对齐；扩展 API 以该版本的类型声明为准 |
| `vite` | `7.3.6` | `electron-vite@5` 的 peer 范围是 `^5 \|\| ^6 \|\| ^7`，不含 `8` |
| `typescript` | `5.9.3` | `typescript-eslint@8` 的 peer 上限为 `<6.1.0`，且不使用 TS 7 预览版 |
| `eslint` | `9.39.5` | 使用 `typescript-eslint@8` 支持的稳定主版本 |
| `node` | `>=24.19.0` | 与开发基线一致；`vitest@5` 要求 `^22.12 \|\| ^24 \|\| >=26` |

## 2. 已支持 / 已验证

P1 未完成前**没有**可发布的支持行。已完成并有证据的能力按阶段记录在 `evidence/` 下：

| 能力 | 状态 | 证据 |
|---|---|---|
| 条件注册：非 Orb cwd 不新增工具、命令或 prompt section | 已验证（P0-02，27/27 断言） | `evidence/p0-02/` |
| 客户端认证、创建独立会话、发消息、重连、停止、退出不杀服务 | 已验证（P0-03 Node 27/27 + Electron 16/16） | `evidence/p0-03/` |
| 沙箱 renderer 直连 pi-web 被拒（403），须经主进程代理 | 已实测 | `evidence/p0-03/result-electron.json` |
| 只读窗口枚举、截图与解码、逐周期 GDI 零增长 | 已验证（只读） | `evidence/p0-04/` |
| pi-web 既有 6 个改动文件的哈希基线可校验 | 已验证 | `evidence/p0-01/verify-baseline.mjs` |
| **P1-01 工作区与独立会话**：未选工作区不能启用；取消零写入；精确 cwd 匹配（子目录与前缀相似同级目录均不匹配）；junction 与大小写拼写归一到同一标识；切换工作区不串会话且不毁历史 | 已验证 | `evidence/p1-01/`（集成 19/19，应用 22/22） |
| **P1-02 Electron 最小浮窗**：聊天闭环、流式输出、显式停止、独立会话可被 pi-web 浏览、renderer 无 Node/无直连 | 已验证 | `evidence/p1-02/`（35/35） |
| **P1-03 唤醒快捷键**：OS 级注册、冲突可诊断、改键与退出释放槽位 | 已验证（第二进程竞争探针） | `evidence/p1-03/`（20/20） |
| **P1-04 截图授权与正向路径**：无目标拒绝且零上传、伪造确认零上传、text-only 模型不收到图像、per-monitor-v2 DPI 感知生效；真实窗口→预览→确认发送全链 | 已验证 | `evidence/p1-04/`（43/43） |
| **仅文本模型截图发送前拒绝**：Orb 从会话工作区查询当前模型能力，明确拒绝且 provider 请求数不增加；图像模型仍能发送 | 已验证（隔离产品链路） | `evidence/p1-04/result.json`（43/43）；人工复测待重启 Orb |
| 捕获源窗口身份：`window:<hwnd>:<index>` 中间段为真实 Win32 句柄 | 已验证（只读枚举，不产生像素） | `evidence/p1-04/capturer-probe.json` |
| **历史 Cua 0.30.1 安装物**：版本、许可构成与两个裸二进制 SHA-256 均与 P0-04 清单一致 | 历史探针已验证，不属于当前生产能力 | `evidence/p1-05/input-verification.json` |
| **历史 Cua 运行时工具目录**：57 个工具；窗口 id 为 bigint；窗口有前序 zIndex | 历史探针已验证，不属于当前生产能力 | `evidence/p1-05/cua-runtime-probe.json` |
| **历史 Cua 坐标空间差异**：`getScreenSize` 报 1707x1067 而物理为 2560x1600；窗口 bounds 为物理像素，动作为屏幕 DIP | 历史探针已实测，不属于当前生产能力 | `evidence/p1-05/input-verification.json` |
| **点击坐标换算的正确性**（两种记录矛盾，以产品整链路实测为准） | **产品整链路实测已裁决**：当前实现「分数 × 驱动上报窗口尺寸」命中 `1,2`（`loop-verification.json`）；曾据一次直调探针改成「屏幕 DIP − 物理原点」，**同链路实测落 `0,1`**，故不采用。P1-05 记录的那条规则与本次链路实测相矛盾，其**逐次落点归属存疑**（与本次探针同类问题） | `evidence/p1-06/loop-verification.json`（39/39）；`doc/cua-driver-integration.md` §1 记录了两侧数字与残留疑问 |
| **模型坐标契约：位置是截图分数（0–1000）** | 已验证（单测 + 产品链路）：分数→请求的换算命中预期格 | `tests/coordinate-mapping.test.ts`；`evidence/p1-06/loop-verification.json` |
| **截图取点→输入落点在**同一次运行**内一致（C7 产品侧闭环）** | 已验证（自动化闭环：取的是截图分数，落点由目标自身日志判定） | `evidence/p1-06/loop-verification.json`（39/39）——取分数 `(611.6,360.4)` → 目标 JSONL 命中 `1,2` |
| **真实模型 C7：模型自主观察、按截图坐标点击并再次观察** | **已验证（当前参考 backend，24/24）**；目标日志命中 `0,0`，工具序列为 `orb_observe → orb_click → orb_observe` | `evidence/p1-06/real-model-c7-reference-backend.json` |
| **后台点击**：4/4 瞄准格子命中，落点在格中心，且不抢前台 | 已验证（丢弃式自报网格目标） | `evidence/p1-05/input-verification.json` |
| **后台输入文本**：向原生应用投递并由读回文档证实 | 已验证 | 同上 |
| **前台点击投递**：目标记录到真实 `mouse-down`，驱动报 `delivery_mode:foreground` | 已验证 | 同上 |
| **历史 Cua 前台滚动的物理到达与生效**：曾在一次运行中由目标日志证实；2026-09-28 最新复跑驱动虽报成功但目标为 0 个 `wheel` | **历史 Cua 路径不稳定，不属于当前生产能力**；当前参考 backend 的 D6 以真实模型目标日志单独判定 | `evidence/p1-05/input-verification.json`（历史探针）；`evidence/p1-06/real-model-d6-scroll-reference-backend.json` |
| **真实模型 D6：自主调用 `orb_scroll`** | **已验证（当前参考 backend，25/25）**；目标日志收到 `wheel` 且 `scrollTop` 改变 | `evidence/p1-06/real-model-d6-scroll-reference-backend.json` |
| **真实模型 D8：自主调用 `orb_type`** | **已验证（当前参考 backend，25/25）**；目标日志读回 `P1ORBD8TEST` | `evidence/p1-06/real-model-d8-type-reference-backend.json` |
| **历史 Cua 后台→前台升级**：typed `scroll` 无法表达 `delivery_mode`，旧适配器曾按 `background_unavailable` 升级 | 历史探针已验证；适配器已删除，不属于当前生产能力 | `evidence/p1-05/input-verification.json` |
| **历史 Cua 拒绝结果解析**：驱动拒绝不能被适配器误报为成功 | 历史探针已验证；当前 broker/参考 backend 有独立拒绝合同 | `tests/desktop-broker.test.ts`、`tests/reference-windows-driver.test.ts` |
| **按键/鼠标无残留** | 已验证（直接采样 OS 全局键态，输入前后差分；不依赖目标窗口日志，因后者含测试自身的 ALT 解锁） | 同上 |
| **C6：真实 native 按下中途取消释放** | 已验证；disposable target 自身日志收到 `mouse-down=1`、匹配 `mouse-up=1`，取消错误也正确上报 | `evidence/p1-05/reference-cancel.json`（5/5） |
| **Orb 工具仅限 Orb 模式**：普通会话无 orb 工具、Orb 会话恰好四个 | 已验证（provider 实际收到 schema） | `evidence/p1-06/tool-exposure.json` |
| **桌面工具闭环**：授权/预算/新鲜度、拒绝零副作用、真实点击落点为目标格心 | **已验证（当前参考 backend）**；目标枚举、观察、授权、点击、滚动、撤权均由 disposable 目标与壳日志证明 | `evidence/p1-06/loop-verification-reference-backend.json` |
| 桥准入：无会话/错误令牌/浏览器来源/旧代次均被拒 | 已验证 | `evidence/p1-06/` + `tests/bridge-server.test.ts` |
| Orb 扩展仅凭握手文件连接壳的命名管道：无需额外设置 `PI_ORB_BRIDGE_PIPE` | 已验证（隔离管道测试 + 当前壳只读探针） | `tests/bridge-client.test.ts`；2026-09-28 `hello.ok=true`，无效会话返回 `unknown-session` |
| **第三方许可清单**：每个已安装生产依赖均声明许可，无 AGPL/GPL-3/SSPL | 已验证 | `evidence/p1-07/license-inventory.json` |
| **`cua_driver_sdk.dll` 的 MPL 归属核实**：交付物中无任何证据把 MPL 归于该 DLL（无许可文本、不引用 uniffi runtime、仅导入系统库） | 已核实并记录 | `THIRD_PARTY_NOTICES.md` §3 |
| `@ubjs/*` 三个包（MPL-2.0，随发行） | 已识别并计入 NOTICE | 同上 §2–§3 |
| **发布门禁**：质量门禁、非破坏性、凭据/像素、忽略规则、许可、版本一致性、证据完整性 | 已验证（且五次反向对照可证伪） | `evidence/p1-07/release-gate.json`（32/32） |
| **生命周期**：折叠/停止/turn 完成或失败撤权与丢弃记录、不结束会话、不改代次、断连撤权 | 已验证 | `evidence/p1-07/lifecycle-regression.json`（10/10）与 `src/main/index.ts` 的统一撤权出口 |
| **P2-01 参考浮球体验**：72px 球、344x444 展开 bounds、方向选择、左右停靠 tab、拖动 IPC、收起还原、hover/pin、系统主题、新会话 | 已接入（几何与 session controller 自动化通过；视觉和人工窗口体验仍需确认） | `tests/floating-geometry.test.ts`、`tests/orb-session.test.ts`、`src/main/floating-window-controller.ts`、`src/renderer/App.tsx`、`doc/p2-01-reference-reuse.md` |
| **P2-02 双 Alt 手势检测**：左右物理 Alt、时序窗口、单次触发、组合键拒绝、退出卸载、进入截图预览 | 已接入（纯状态单测、类型、lint 和构建通过；实际键盘体验未验证） | `tests/double-alt.test.ts`、`src/main/double-alt.ts`、`src/main/index.ts`、`src/renderer/App.tsx` |

## 3. 未验证（不得宣称支持）

本表只列**尚未验证**的项。已验证项一律在本文件 §2；任何一项验证后必须从本表移出，不得两处同时存在。

| 项 | 为什么未验证 | 影响 |
|---|---|---|
| 多显示器 | 本机仅 1 个显示器 | 多屏坐标、跳屏选区与截图分辨率未测；不得宣称已支持 |
| elevated（高权限）窗口 | 未测试；按目标要求不自动提权 | 高权限窗口的截图与输入语义未知；不得由普通窗口结果外推 |
| 被遮挡窗口 / DirectComposition 类窗口的截图 | 已测可靠的正常路径，但未构造遮挡场景 | 见 `evidence/p1-04/README.md` §4.4 |
| **向 Chromium/Electron 内容输入文本** | 后台投递对该窗口类不可用；前台升级已实现但未做到稳定投递 | 见 `evidence/p1-05/README.md` §4 |
| 失败即停由真实驱动失败触发 | 由单测覆盖（`tests/desktop-broker.test.ts`）；整链路未构造真实驱动失败 | 部分验证 |
| 同一任务锁在多会话并发下的行为 | 单测覆盖；整链路只覆盖单会话 | 未验证 |
| 驱动内建授权语义（`desktopCaptureAuthorized`、`desktopUnlocked`、`escalate_session`） | 本阶段未使用；状态实测均为 false | **未验证**；产品侧授权仍由 pi-orb 自己的任务授权与代次绑定负责 |
| 窗口拖动/置顶/展开收起的人工体验 | P2-01 已接入参考几何和 IPC；真实 Electron 拖动、多显示器、DPI、停靠动画和置顶体验尚未人工复测 | 属人工确认；不得据自动断言宣称交互体验已验收 |
| **快捷键的按键人工体验** | OS 注册、冲突诊断与释放已验证；真实 Electron + native hook 集成探针通过，但探针使用合成 F24 输入；真实键盘、AltGr/非 US 布局、锁屏/休眠恢复仍未复测 | 属人工确认；步骤见 `evidence/p1-03/README.md` |
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
| **完整 v0.1 发布** | 上表仍有未验证项（多显示器、高权限窗口、向 Chromium 内容输入文本） | **未完成**；当前交付物不得声明为完整 v0.1 |

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
