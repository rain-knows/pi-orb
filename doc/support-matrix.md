# pi-Orb 支持矩阵

本文件是 pi-Orb 唯一的版本兼容性声明来源。**没有经过验收的组合一律标记为“未验证”**，不因代码可以编译、依赖可以安装或文档宣称跨平台而视为支持。

- 维护规则见 [`pi-orb-development-goals.md`](./pi-orb-development-goals.md) §7.2（上游更新策略）。
- 版本与许可取证的原始记录见 [`../evidence/p0-04/cua-artifact-manifest.json`](../evidence/p0-04/cua-artifact-manifest.json) 与 [`../evidence/p0-01/environment-baseline.json`](../evidence/p0-01/environment-baseline.json)。
- 本文件随每个发布版本更新；未验证项不得因“后续再验证”而升级为支持项。

## 1. 当前基线组合（开发基线）

下表是**本机开发与证据采集时实际使用的组合**，不等于已发布的受支持组合。P1 尚未完成，因此当前没有“已支持”的发布行。

| 组件 | 版本 | 状态 | 依据 |
|---|---|---|---|
| pi-Orb | `0.1.0`（`Unreleased`） | 开发中 | 本仓库 `package.json` |
| OS | Windows 11 x64（Build 26200） | 首发目标平台 | `evidence/p0-01/environment-baseline.json` |
| Node.js | `24.19.0` | 开发基线 | `evidence/p0-01/environment-baseline.json` |
| npm | `11.17.0` | 开发基线 | 同上 |
| Electron | `44.4.5` | 首个实测点 | `evidence/p0-03/README.md`（真实 Electron 腿 16/16） |
| Pi SDK | `@earendil-works/pi-coding-agent@0.87.1` | P0-02 实测 | `evidence/p0-02/README.md` |
| pi-web | `@agegr/pi-web@0.9.3`，HEAD `95a58744532c7fccaa933aa7757a1419ace67ed2` | P0-02/P0-03 实测 | `evidence/p0-02/README.md`、`evidence/p0-03/README.md` |
| 桌面驱动 | `@trycua/cua-driver@0.30.1` + `@trycua/cua-driver-win32-x64-msvc@0.30.1` | 版本与许可已取证，**运行时未验证** | `evidence/p0-04/cua-artifact-manifest.json` |
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
| `@trycua/cua-driver` | **精确** `0.30.1` | 版本与许可已按制品哈希锁定；平台包许可为 `MIT AND MPL-2.0`，升级需重新取证 |
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

## 3. 未验证（不得宣称支持）

| 项 | 为什么未验证 | 影响 |
|---|---|---|
| Cua 驱动**运行时**行为 | 版本与许可已取证，但驱动进程从未启动：真实工具目录输出、权限交互、截图与输入语义均未在本机运行确认 | P1-05 必须先做，未通过前不启用任何输入能力 |
| **真实桌面输入**（点击/输入/滚动/取消释放） | 属 P1-05，需要真机人工授权 | 未通过前 P1-06 的输入工具保持禁用并明确标注 |
| `cua_driver_sdk.dll` 是否承担 MPL-2.0 义务 | NOTICE 只点名 `.node` 文件，而包许可字段为 `MIT AND MPL-2.0` | 发布打包（P1-07）前必须核实，不得自行假定任意一侧 |
| 多显示器 | 本机仅 1 个显示器 | 多屏坐标与选区分辨率未测；不得宣称已支持 |
| elevated（高权限）窗口 | 未测试 | 高权限窗口的捕获与输入语义未知 |
| macOS / Linux | 未在任何非 Windows 平台运行 | 首发仅 Windows x64；不因代码可编译而宣称支持 |
| macOS 屏幕录制 / 辅助功能权限 | Cua SDK 的权限 API 仅 macOS 专属，本机为 Windows | Windows 结果不得外推到 macOS |
| 完整 React/Vite UI 栈的跨 origin cookie/SameSite 行为 | P0-03 的 Electron 腿使用纯 HTML renderer | 需在锁定 Electron 版本后复验 |
| pi-web 原地生产构建 | 该 `node_modules` 不完整（缺 `@next/env`），且原地构建 OOM | 属环境限制；测试使用固定 HEAD 快照内独立安装 |
| pi-web 其它版本 / 其它 Pi SDK 版本组合 | 只测试了上表中的单一组合 | 未测试的组合统称“未验证” |
| 上游更新后的兼容性 | 未对任何上游新版本跑过接入合同 | 按 §7.2 流程在独立环境验证后才发布新组合 |
| **真实 pi-web 端到端聊天**（Orb 会话的完整对话流：发送、流式、停止、重连） | 属 P1-02，**已完成**（`evidence/p1-02/` 35/35） | — |
| **pi-web 的 abort 是否中断底层 provider 请求** | 实测为**否**：pi-web 的 abort 是协作式的，in-flight 请求被允许结束 | 用户可观察保证（输出停止、任务锁释放）已验收；但 P1-06/P1-07 的取消与清理不得依赖 pi-web 的 abort 完成底层销毁 |
| 窗口拖动/置顶/展开收起的**人工**体验 | 自动化只验证了窗口存在、标题、桥与聊天闭环 | 属人工确认；不得据自动断言宣称交互体验已验收 |
| 窗口位置的**跨启动**恢复 | 防抖保存已实现，但未做“移动→退出→重启→恢复”实测 | 未验证；不得宣称已支持 |
| **“存在但不可访问”的工作区**（`no-read-access` / `no-write-access`） | 本机以当前账户无法构造该状态而不改动 ACL（属对用户环境的破坏性操作） | 分支有单测，未真机构造；不得据此宣称已覆盖 |
| 网络驱动器（UNC）路径的实际访问 | 只测了归一化，未做真机访问 | 不得宣称支持网络路径工作区 |
| 双 Alt 手势、选区上下文 | 属 P2，且用户交互尚未确认 | 不阻塞 v0.1；不得当作已实现 |

## 4. 已知环境事实（不是缺陷，但影响使用）

| 事实 | 后果 |
|---|---|
| 本机 2560×1600 物理分辨率、约 150% 缩放；DPI-unaware 进程看到 1707×1067 | 桌面 helper 必须显式声明 per-monitor-v2 DPI awareness，否则截图坐标会被当作输入坐标而点错位置 |
| 本机同时存在 `dpi=96`（42 窗口）与 `dpi=144`（256 窗口）两组窗口 | 换算不能假设全局单一比例 |
| pi-web 工作树在基线捕获时已有 6 个用户改动文件 | 这些改动属用户所有，不得归因于 pi-Orb，也不得被本项目修改 |
| Pi 无条件加载用户级 `~/.agents/skills`，`HOME` 运行时解析 | 该目录存在时会进入**所有**会话（含普通 cwd）的 prompt；Orb 只能承诺“不主动改变它” |
| npm 11 默认拦截依赖安装脚本 | `electron` 与 `esbuild` 需显式 `npm approve-scripts`；`electron` 二进制经 `ELECTRON_MIRROR` 下载 |
