# P0-05 最小接入方案决策

> 依据：`evidence/p0-01/`、`evidence/p0-02/`、`evidence/p0-03/`、`evidence/p0-04/`（均可复现运行）
> 基线：pi-web `0.9.3` / HEAD `95a58744532c7fccaa933aa7757a1419ace67ed2`、Pi SDK `0.87.1`、Node `24.19.0`、Windows 11 x64
> 结论：**零修改路线成立，无需上游改动**；桌面后端仅保留一个候选，其**版本与许可已通过制品取证锁定，但运行时行为未验证**（未安装、未运行，见 §3/§4）。

## 1. 决策一：接入方式 = 零修改路线（不 fork、不 patch）

P0-02 在真实 pi-web 装配下（固定 HEAD 快照 + 独立 `npm ci` + `next build` + `next start`）通过 27/27 断言：条件注册只对规范化后**精确匹配**的专用 cwd 生效；普通 cwd 的工具、命令与模型输入**均无** Orb 痕迹；fork 也继承条件注册。**上游源码 diff 为 0。**

因此：**不修改 pi-web**，不维护长期 fork，不做 monkey patch，不动 `node_modules`。

## 2. 决策二：采用的已有接口（全部为文档化公开接口）

| 层 | 采用 | 未采用（禁止） |
|---|---|---|
| Pi 扩展 | `registerTool`、`registerCommand`、`setActiveTools`、`on("session_start"｜"before_agent_start"｜"session_shutdown")`、`ctx.cwd` | 私有 hook、`globalThis` 注册表、内部 `SessionManager` |
| 模式装配 | `session_start` 内按 `ctx.cwd` 条件注册 + `before_agent_start` 结构化 `sections`/`promptGuidelines` | 启动时隐藏一遍以对抗上游自动追加 |
| 客户端 | `POST /api/agent/new`（带 `cwd`）、`POST /api/agent/{id}`（`prompt`/`abort`/`reload`/`set_tools`/`get_tools`/`get_commands`/`get_state`）、`GET /api/agent/{id}/events`（SSE）、`GET /api/sessions/{id}` | 私有 registry、页面菜单内部状态 |
| Electron 壳 | **主进程持有凭证并经 `contextBridge` 代理全部 API/SSE** | renderer 直连 pi-web（实测 403）、向 renderer 交凭证、`nodeIntegration` |
| 认证 | 既有 `PI_WEB_PASSWORD`（Basic / 会话 cookie）与现有 host/origin 校验 | 关闭认证、wildcard CORS、公开控制 API |
| 桥接 | Windows named pipe：令牌 + 会话 id + 运行代次 + 任务授权四重校验 | 监听 TCP 控制端口、向 renderer 暴露 Node |
| 桌面能力 | 单一 `DesktopBackend` 适配器，候选 Cua Driver（版本与许可已取证：`@trycua/cua-driver@0.30.1`，Windows 平台包 `MIT AND MPL-2.0`） | 并行维护多个未成熟后端 |

**关键事实修正（防止后续误用）**：`lib/session-revision.ts` 的 `snapshotRevision` 是缓存有效性令牌，**不是**权限或代次校验。运行代次与任务授权必须由执行层显式绑定，P0-03 的桥接探针演示了该模式。

**第二条关键实测事实**：真实 Electron（44.4.5）下，**沙箱 renderer 直连 pi-web API 一律 403**（opaque `file://` origin 过不了 host/origin 校验），`EventSource` 也拿不到凭证；而主进程经 `contextBridge` 代理的同一批调用全部成功（含真实 provider 调用与停止）。因此 Electron 壳的架构被实测约束为**主进程代理制**，不是可选设计。

## 3. 决策三：单一桌面后端候选

- **候选：Cua Driver（trycua/cua）**，版本与许可已通过 `npm pack` 制品取证锁定（**未安装、未运行**）：
  - `@trycua/cua-driver@0.30.1`（wrapper，MIT）；`@trycua/cua-driver-win32-x64-msvc@0.30.1`（**`MIT AND MPL-2.0`**）。
  - 取证内容：tarball 及二进制 SHA-256、包内文件清单、能力符号枚举。详见 `evidence/p0-04/cua-artifact-manifest.json`。
  - **许可差异**：真正交付的原生二进制在平台包里，许可不是纯 MIT。上游自带 `node-runtime-NOTICE.md`：其中一个 `.node` 文件是 MPL-2.0 派生构建，对应源码由上游在匹配 tag 提供。MPL-2.0 是文件级弱 copyleft，不传染整个 pi-Orb；分发需附 NOTICE 并告知如何取得对应源码。
  - **残留不确定**：NOTICE 只点名 `.node`，而包许可字段含 MPL；26.8 MB 的 `cua_driver_sdk.dll` 未被 NOTICE 点名。P1-07 打包前必须核实，不得假定。
  - **能力面（从制品声明实际枚举）**：动作类（click/drag/move/type/press/hotkey/scroll/invoke-menu）、观察类（list-windows/apps、get-window-state/desktop-state/screen-size、snapshot、parse-visual-regions）、显式坐标空间 `VisualActionCoordinateSpace`、验证与升级原语（`ActionEvidence`、`VerifyState`、`BoundsExpectation`、`ActionEscalation`）、会话级授权（start/end/escalate、`DriverAuthorizationHost`）。
  - **平台权限不对称**：SDK 含 macOS 专属权限 API，未发现 Windows 对应符号；权限状态不能用单一跨平台形状建模。
  - 其它许可边界：ClawHub 的 skill 副本为 MIT-0；Kasm(MIT)、OmniParser(CC-BY-4.0)；`cua-agent[omni]` 含 ultralytics **AGPL-3.0**，**不引入**。
  - **运行时行为完全未验证**（未安装）：真实工具目录输出、权限交互、截图与输入语义均未在本机运行确认。
- 只有在 Cua 于 P1-05 真机输入验收中失败，才评估 Windows 原生 helper（参考 DeepSeek Orb 的 koffi/GDI/SendInput，但其取消路径缺按键/鼠标释放，移植必须补测）。
- **只保留一个生产候选**，不并行维护。

## 4. 未通过项与未验证项（必须如实保留）

| 项 | 状态 | 原因 |
|---|---|---|
| **Cua 候选版本/许可取证** | **通过** | 版本号、tarball 与二进制 SHA-256、文件清单、许可构成、能力符号已落盘（`cua-artifact-manifest.json`） |
| **Cua 候选运行时验证** | **未通过（未做）** | 用户选择不安装：未启动驱动进程，无真实工具目录输出与权限交互 |
| Cua 运行时工具目录输出 | 未验证 | 未安装、未启动驱动进程；能力面来自类型声明枚举 |
| Cua 原生二进制许可义务（MPL-2.0） | 已识别，未处理 | 分发前需附 NOTICE；DLL 是否含 MPL 义务待 P1-07 核实 |
| 真实输入（点击/输入/滚动/取消释放） | 未验证 | 属 P1-05，需真机人工授权 |
| 图像坐标到输入坐标一致性 | 未验证 | 已量化风险（见下），未做真机输入验证 |
| macOS / Linux | 未验证 | 首发仅 Windows x64 |
| 多显示器 | 未验证 | 本机仅 1 个显示器 |
| elevated 窗口捕获 | 未验证 | 未测试 |
| Electron 跨 origin cookie/SameSite | **已实测（简化形态）** | 真实 Electron 44.4.5 + 沙箱 `file://` renderer 下，直连 API 均为 403，须经主进程代理；完整 UI 栈（React/Vite）未验证 |
| pi-web 原地生产构建 | 未通过（环境限制） | 该 `node_modules` 不完整（缺 `@next/env`），且原地构建 4GB/8GB 堆均 OOM；`next dev` 在本机不可用（Turbopack 拒跨盘链接、webpack 跨盘解析失败、临时目录文件监视器触发 libuv `fs-event.c` 断言）。改用快照内 12GB 堆构建 + `next start` |

**已量化、必须在 P1 处理的风险**：本机 2560×1600 物理分辨率、约 150% 缩放。DPI-unaware 进程看到 **1707×1067**，与物理像素相差 **1.5 倍**；且本机同时存在 `dpi=96` 与 `dpi=144` 两组窗口。桌面 helper **必须显式声明 per-monitor-v2 DPI awareness**，否则截图坐标会被直接当输入坐标而点错位置。

## 5. 非破坏性结论

### 一个被纠正的真实约束（且直接影响 P1）

P0 首轮运行的会话 prompt 里出现了宿主用户真实的 16 个 skills。**最初的归因是错的**（当时写“沿祖先链扫描，把 cwd 移出 profile 即可”）：

- 真实根因：Pi 加载 **用户级** `HOME/.agents/skills`，其中 `HOME` 在运行时解析（`process.env.HOME || homedir()`），**与 cwd 和 `agentDir` 均无关，且无条件加载**。因此只改 cwd 无法修复。
- 已修复：给 pi-web 子进程传隔离的 `HOME`/`USERPROFILE`；并将泄漏断言改为检查**真实捕获的 provider 请求体**，且在无样本可查时**失败关闭**（避免空值通过）。
- 反向对照已验证检测器有效：同一检测逻辑对污染基线报 `leaked=true`，对当前结果报 `leaked=false`（normal 请求中 `.agents`/`JUSTLIKEZYP`/`SKILL.md` 命中数均为 **0**）。

**产品含义（必须带入 P1-01）**：只要宿主用户存在 `~/.agents/skills`，它就会进入**所有**会话的 prompt（包括普通 cwd 会话），Orb **无法**用工作目录或 `agentDir` 隔离它。因此 Orb 能承诺的是“不主动改变它”，而**不能**承诺“prompt 内容零差异”。P1-01 必须在工作区与提示词装配时显式声明这一点。

### 哈希基线与逐轮校验

“未改动用户已有源码”现在由可执行校验支撑，不是文字声明：`evidence/p0-01/` 落盘了 6 个变更文件的工作区 SHA-256（`changed-files.sha256`、`changed-files-baseline.json`），并提供 `record-baseline.mjs` / `verify-baseline.mjs`（任何字节变化、新增已修改文件或 HEAD 变动都会非零退出）。记录时 `passed=true`（6/6）。

| 不变量 | 状态 | 证据 |
|---|---|---|
| N1 普通 cwd 行为不变 | 本 P0 测试面通过 | P0-02：普通 cwd 工具/命令/模型输入无 Orb 痕迹 |
| N2 不改全局默认值/凭据/主题 | 本 P0 测试面通过 | 仅写运行目录；`HOME` 重定向后未读写真实 `~/.pi/agent`、`~/.agents`；哈希校验 6/6 |
| N3 普通会话不新增 GUI 能力 | 本 P0 测试面通过 | P0-02：普通 cwd 请求无 `orb_probe`、无 Orb section |
| N4 单一后端所有权 | 本 P0 测试面通过 | P0-03：壳/Electron 退出不杀服务；只连接已有服务 |
| N5 不双写会话 | 本 P0 测试面通过 | P0-03：双客户端同一会话；旧代次请求被拒 |
| N6 不删除用户数据 | 已保持 | 仅写约定目录；像素零落盘；哈希校验可证明源码未被改 |
| N7 退出/断连清理 | 部分覆盖 | P0-03：撤销授权即拒；P0-04：GDI 逐周期零增长。按键/鼠标释放属 P1-05 |
| N8 明确版本、不保留废弃 fallback | 已遵守 | 仅用受支持 API；无 monkey patch；无兼容层 |

**上游改动：不需要。** 原 pi-web 工具预设菜单不显示 Orb 模式，这是既有事实，不影响 P0/P1 核心；若将来需要菜单集成，按 P2-06 单独提案，不作为前提。

## 6. 进入 P1 的前置条件

1. P1-01/P1-02（工作区与最小浮窗）可**立即开始**——它们不依赖桌面驱动。
2. **P1-05（真机输入验收）前必须先做二选一决策**：(a) 安装已锁定的 `@trycua/cua-driver@0.30.1`，接受平台包 `MIT AND MPL-2.0` 的 NOTICE/源码义务（并在 P1-07 前核实 DLL 的 MPL 归属）；或 (b) 改用 Windows 原生 helper 路线。不得在未决定许可义务的情况下把它写入发布产物。
3. 任何阶段若发现必须改上游，停下请用户决定最小扩展点，不得自行扩大范围。
