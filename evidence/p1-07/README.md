# P1-07 最低安全、回归与发布门禁

> 运行方式：
> - `node evidence/p1-07/collect-licenses.mjs`（第三方许可清单）
> - `node evidence/p1-07/run-release-gate.mjs`（发布门禁，26 项）
> - `node evidence/p1-07/run-lifecycle-regression.mjs`（折叠/停止/代次生命周期，9 项）
>
> 原始结果：`license-inventory.json`、`release-gate.json`（26/26）、`lifecycle-regression.json`（9/9）
> 状态：**门禁与生命周期通过**；**v0.1 尚不构成完整 M3 版本**，原因见 §6。

## 1. 交付内容

| 能力 | 位置 |
|---|---|
| 发布门禁（可执行、可证伪） | `evidence/p1-07/run-release-gate.mjs` |
| 生命周期规则（折叠即撤权，单一入口） | `src/main/window-lifecycle.ts` |
| 悬窗自身的收起控件 | `src/renderer/App.tsx`（Collapse）+ `IPC.collapseOrb` |
| 统一撤权入口 | `src/main/index.ts`（`revokeDesktopOperations`） |
| 第三方许可清单与 NOTICE | `evidence/p1-07/collect-licenses.mjs`、`THIRD_PARTY_NOTICES.md` |
| 项目自身许可 | `LICENSE`（此前缺失，已补） |
| 单测 | `tests/window-lifecycle.test.ts` |

## 2. 目标点名的 MPL 核实（`cua_driver_sdk.dll`）

结论已写入 [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) §3。要点与依据：

| 检查 | 结果 |
|---|---|
| DLL 内 ASCII 许可文本（`MIT License` / `Mozilla Public` / `Permission is hereby granted`） | **0 处** |
| DLL 内 UTF-16 许可文本 | **0 处** |
| 文件中唯一的 `license` 字符串 | 是 Rust 符号元数据的键名（`name`/`version`/`author`/`license`），不是许可授予 |
| 是否引用 `uniffi-bindgen-react-native` / `uniffi_bindgen` / `cua_driver_node_runtime` | **0 处** |
| 导入的库 | 仅操作系统库（`kernel32`、`user32`、`gdi32`、`ole32`、`oleacc`、`d3d11`、`bcrypt`、`dwmapi`、`dbghelp` 等） |

**结论**：交付物中**没有任何证据**把 MPL-2.0 归于 `cua_driver_sdk.dll`，也没有交付文件把它链到 MPL 授权的 runtime；因此按 MIT 部分处理，**不**列为 MPL 组件。

**这是一次真实的方法教训**：首次用 ASCII grep 得到 "894 处 MPL"，看似是决定性证据，实则全是 x86 指令字节的巧合。在二进制上做文本 grep 会产生假阳性；改用 UTF-16 解码 + 对唯一命中处做上下文检查后才有可信结论。该错误过程也记入 NOTICE，避免后人重犯。

**边界声明**：上述是"对交付字节的推断"，不是法律意见；未审计上游源码仓库；不对本包之外的源文件作任何断言。若上游日后声明 DLL 为 MPL 派生，NOTICE 必须更新并把 DLL 加入 MPL 清单。

### 2.1 清单中另外发现的 MPL 组件（NOTICE 未覆盖）

| 组件 | 版本 | 许可 | 是否随发行 | 依据 |
|---|---|---|---|---|
| `@ubjs/core` | 0.31.0-3 | **MPL-2.0** | 是 | package.json 声明；主页 `github.com/jhugman/uniffi-bindgen-react-native` |
| `@ubjs/node` | 0.31.0-3 | **MPL-2.0** | 是 | 同上 |
| `@ubjs/node-win32-x64-msvc` | 0.31.0-3 | **MPL-2.0** | 是（含 `uniffi-runtime-napi.win32-x64-msvc.node`，537 KB） | 同上 |

这三者指向的上游项目 `uniffi-bindgen-react-native 0.31.0-3` **正是** 上游 NOTICE 所述的项目（`@ubjs` 为其更名版）。它们**均不带许可文件**，仅在 package.json 声明，因此许可文本由 `THIRD_PARTY_NOTICES.md` 提供。这是超出上游 NOTICE 范围的发现，已如实记入。

## 3. 发布门禁实测（26/26）

### 3.1 门禁覆盖项

| 类别 | 检查 |
|---|---|
| 质量门禁 | typecheck、lint、单测、生产构建 |
| 非破坏性 | pi-web HEAD 与其 6 个既有改动文件未被触碰 |
| 凭据与像素 | 交付树内无密钥材料、无截图/原生二进制/归档、无色 `auth.json`/`.env` |
| 忽略规则 | `node_modules/`、`out/` 被忽略；无构建产物被暂存 |
| 许可 | 清单存在、无 AGPL/GPL-3/SSPL、每个已安装生产依赖都声明许可、MPL 组件与源码路径被点名、项目自带 LICENSE |
| 版本维护 | 版本/changelog/支持矩阵三者一致；驱动、Electron、Pi SDK 版本与实测一致 |
| 证据完整性 | 7 份原生验收记录存在；未验证项仍在记录中 |
| 发布卫生 | `.gitignore` 保留项目级 `.pi` 可版本化；README 如实标注未验证 |

### 3.2 门禁可证伪（三次反向对照）

一个永不报警的检查等于没有检查（P0-02 曾因此误判）。因此每条关键检查都做了反向对照：

| 注入 | 结果 |
|---|---|
| 在源码注入一个 `sk-…` 形式的假密钥 | `passed=false`，精确报出 `src/shared/__gate-test.ts: OpenAI-style API key`，退出码 1 |
| 在清单注入一个 `license: "AGPL-3.0"` 的假依赖 | `passed=false`，报出 `no AGPL, GPL-3 or SSPL component is present`，退出码 1 |
| 把支持矩阵里的版本号改成 `9.9.9` | `passed=false`，报出 `the support matrix records the project version :: looked for 0.1.0`，退出码 1 |

三次均退出码 1，恢复后回到 26/26。

## 4. 生命周期实测（9/9）

规则来自 §6.1/§6.2：桌面授权必须是**易失**的。判定通过真实壳 + 真实 pi-web 会话 + 真实桥读取。

| 断言 | 实测 |
|---|---|
| 壳能列出桌面目标 | 通过 |
| 存在会话，因此可授予授权 | 通过（真实 pi-web 会话） |
| 批准后授权生效 | `authorized=true` |
| **显式停止清除授权** | 通过 |
| 停止不破坏目标/桥的一致性 | 通过 |
| **停止桌面操作不结束聊天会话** | `sessionId` 前后一致 |
| **停止桌面操作不改变运行代次** | 前后均为 1 |
| **折叠悬浮窗撤销桌面授权** | 授权 `true` → 折叠 → `false`（经桥读取确认） |
| 壳在整段生命周期后仍存活 | 通过 |

折叠的验证方式值得记录：窗口一旦隐藏，其 renderer 可能被挂起，`getStatus()` 不再返回。因此折叠效果是**经桥（主进程）**读回的，不依赖被隐藏的 renderer——这也是为什么不把折叠效果断言写成"界面上的文字变了"。

## 5. 本阶段发现并修复的真实缺陷

### 5.1 有多条隐藏路径绕开撤权（安全相关）

原来有三处各自隐藏窗口：快捷键/收起的 wake controller、窗口 `close` 处理器、托盘菜单 "Hide orb"。规则只落在第一处，于是**用窗口关闭按钮或托盘菜单收起时，桌面授权会存活**——一个隐藏的悬浮窗仍能移动用户的鼠标键盘。

修复：引入 `OrbWindowLifecycle` 作为**唯一**折叠入口（`hide()` + `revokeDesktopTask()` + `discardPendingCapture()` 严格配对），上述三处与新增的窗口收起控件全部走它。单测断言"任何一次 hide 都必须伴随一次 revoke/discard"，并用参数化用例覆盖三条路由。

### 5.2 悬浮窗没有自己的收起控件

浮窗此前只能靠全局快捷键或托盘收起，界面本身没有入口。补上 `Collapse` 控件（经同一生命周期入口，因此撤权行为一致）。

### 5.3 仓库声明的 MIT 缺 LICENSE 文件

`package.json` 声明 `"license": "MIT"`，但仓库没有 `LICENSE`。发布门禁现在把这条作为硬检查。

### 5.5 截图路径在截图时重读前台窗口，使正向路径永远失败（P1-04 的遗留缺陷）

审查中发现：`ScreenshotFlow.start()` 在用户点截图按钮时**重新读取前台窗口**。但此时焦点已在 Orb 上，而 reader 显式排除自身 PID，因此**必然返回 null**——正向截图路径是一条**永远拒绝**的死路，与我先前 P1-04 文档中“正向路径只是未验证”的描述相比，实际状态更差。

同时 `recordDesktopTarget()` 在 `createWindow()` **之后**调用，本身就不满足 P1-04「唤醒前记录目标窗口」。

修复：`RecordedTargetStore` 成为“用户在看哪个窗口”的唯一记录；唤醒路径在 `show()/focus()` **之前**记录；截图流程**消费**记录，校验改为“窗口是否仍存在且标题一致”而非“是否仍在前台”。`tests/recorded-target.test.ts` 固定了这条顺序规则（记录时读一次，校验时不再读）。

这条修正在于区分两个不同问题：**“是否仍在前台”**（用户已经切到 Orb，必然为假）与**“是否仍是同一个窗口”**（真正需要校验的）。把两者混为一谈就会让功能永远不可用。

### 5.6 测试探针自身的两个错误（避免无效通过）

- 生命周期回归最初**没有 pi-web**，于是没有会话 → 无法授权 → "折叠撤权"只能报"未执行"。这属于空值通过。加上真实 pi-web 后该检查才真正执行授权→折叠→撤销。
- 最初用 `window.close()` 触发折叠：Chromium 中它对顶层窗口是 no-op，折叠**根本没发生**，因而掩盖了 5.1 的缺陷。改为走真实 UI 控件后缺陷立即暴露。

## 6. v0.1 完成度（如实记录）

依据开发目标 §5：**v0.1 = M1 + M2 + M3 + P1-07**。

| 里程碑 | 状态 |
|---|---|
| M1（小窗聊天、专用 cwd、普通 Web 回归） | **已完成**（P1-01、P1-02、P1-03） |
| M2（授权截图上下文） | **授权与拒绝路径完成**；正向截图路径本机未验证（P1-04） |
| M3（一动作一观察的 Computer Use） | **点击闭环完成**；前台投递路径、输入与滚动本机未验证（P1-05、P1-06） |
| P1-07（安全、回归、发布门禁） | **已完成**（本文件） |

**因此当前交付物不是完整 v0.1。** 未验证的能力必须标注为未启用，不得声明 M3 完成：

| 未验证 | 影响 |
|---|---|
| 前台投递路径 | 无前台窗口的环境中完全不可用（本机 `GetForegroundWindow()` 为空） |
| 截图点 ↔ 输入点一致性 | 依赖前台路径，属 P1-05 核心验收项，未完成 |
| 经 orb 工具的文本输入与滚动 | 驱动对 Chromium 内容拒绝后台投递 |
| 模型真正调用 orb 工具 | 本环境无模型在环 |
| 正向截图路径 | 需真实前台窗口 |
| macOS / Linux / 多显示器 / 高权限窗口 | 未验证 |

这些项在 [`doc/support-matrix.md`](../doc/support-matrix.md) 中逐条标注，并有对应 README 中的人工验证步骤。**发布门禁会检查这些未验证记录仍然存在**，因此一次发布无法悄悄把它们删掉来"变绿"。

## 7. 版本与文档维护

| 项 | 状态 |
|---|---|
| `package.json` 版本 | `0.1.0`（`Unreleased`） |
| `CHANGELOG.md` | Keep a Changelog 格式；版本策略与支持矩阵互相引用 |
| `doc/support-matrix.md` | 唯一的兼容性声明来源；已验证/未验证/环境事实分列 |
| `doc/cua-driver-integration.md` | 驱动接入事实（坐标空间、投递模式、会话、许可义务） |
| `evidence/README.md` | 各阶段证据索引与复现命令 |
| `README.md` | 状态、结构、命令、非破坏性保证与已知例外 |
| `.gitignore` | 依赖/构建/临时/本地目标状态/凭据/二进制/截图；**不**整体忽略 `.pi/` |

## 8. 非破坏性确认

- 未修改 pi-web 源码、`node_modules` 或用户已有改动文件；`evidence/p0-01/verify-baseline.mjs` 在门禁中每次重跑。
- 未修改用户 Pi 全局配置或凭据。
- 无真实密钥、无个人截图进入仓库；门禁逐文件检查交付树。
- 生命周期测试使用隔离 `userData`、隔离 agent 目录、隔离 HOME 与隔离测试密码。
