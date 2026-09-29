# P0-01 基线记录

> 捕获时间：见 `environment-baseline.json`。本记录只描述事实与验证边界，不宣称 P0 已通过。

## 已核对事实

- 首发验证平台：Windows 11 x64（Build 26200）。
- Node.js：`v24.19.0`；npm：`11.17.0`。
- pi-web 工作树：`C:\Users\JUSTLIKEZYP\OneDrive\文档\daily\pi-web`。
- pi-web 包版本：`@agegr/pi-web@0.9.3`。
- Pi SDK：`@earendil-works/pi-coding-agent@0.87.1`（及同版本的相关 Pi 包）。
- pi-web HEAD：`95a58744532c7fccaa933aa7757a1419ace67ed2`。
- pi-web 工作树在基线捕获时已有 6 个改动文件：
  - `app/endfield.css`
  - `components/AppShell.tsx`
  - `components/ChatInput.tsx`
  - `components/MessageView.tsx`
  - `components/SessionSidebar.tsx`
  - `docs/local-endfield-verification.md`

这些文件属于已有工作树状态，后续不得归因于 pi-orb。

## 变更文件哈希基线（可校验）

交付物要求“已有用户源码 diff 可区分”。仅用文字声称“已记录哈希”不算证据，因此这里真实落盘并提供校验脚本：

| 文件 | 内容 |
|---|---|
| `changed-files.sha256` | 6 个文件的工作区 SHA-256（`sha256sum` 格式） |
| `changed-files-baseline.json` | 路径、git 状态、工作区 SHA-256、`HEAD` blob SHA-1、字节数、`HEAD` 提交 |
| `record-baseline.mjs` | 重新生成上述基线 |
| `verify-baseline.mjs` | 重算并比对；发现任何差异（含新增的已修改文件或 HEAD 变动）则非零退出。**本机没有该 pi-web 检出时**输出 `skipped: true` 与原因并以 0 退出——比较确实没有发生，绝不能报成 `passed` |

用法：

```powershell
node evidence/p0-01/record-baseline.mjs
node evidence/p0-01/verify-baseline.mjs
```

记录时结果：`passed=true`，6/6 文件哈希同值，`HEAD` 未变。

**这台机器之外的行为**：被比较的 pi-web 检出属于**开发机本地状态**，不是本仓库的性质。路径取自
`changed-files-baseline.json` 的 `piWebRepo`，可用 `PI_ORB_P0_PI_WEB` 覆盖。其它贡献者的克隆或 CI
runner 上没有该检出时，脚本报告「跳过 + 原因」；发布门禁把它记为 `skipped`（在输出里列名、在
`summary.skipped` 单独计数），**不**计入 `passed`。要真正跑这次比较，把 `PI_ORB_P0_PI_WEB` 指向
记录提交对应的 pi-web 检出即可。

> 工具自证：首版记录脚本用 `.trim()` 处理 `git status --porcelain` 时丢掉了首行前导状态空格，把 `app/endfield.css` 写成 `pp/endfield.css`。**校验脚本立即报错并阻止了假基线落盘**——这正是“用可执行校验代替文字声明”的价值。

## P0-01 写入清单

| 位置 | 本阶段是否写入 | 规则 |
|---|---:|---|
| pi-orb 仓库 `evidence/**` | 是 | 只保存脱敏的版本、路径、状态和测试结果 |
| pi-web 工作树 | 否 | 不编辑、不安装扩展、不修改 `node_modules` |
| 用户 Pi 配置／凭据 | 否 | 使用隔离目录或静态/离线测试；不得读取或覆盖真实凭据 |
| 用户屏幕／截图 | 是（仅 P0-04，经用户许可） | 只读、每次 1 张、像素零落盘 |
| 桌面输入 | 否 | P0-04 只读；P1-05 前禁止输入操作 |
| 测试用 Electron | 是（`D:\pi-orb-p0-runs\electron-probe`） | 仅测试用，未写入 pi-web 与用户配置 |

## 代码对照引用（W1–W5 / P1–P3）

P0-01 要求固化这些引用作为基线。文档中旧提交的链接是历史调研基线；本表使用**本机 pi-web 与已安装 Pi 包的实际路径**。

| 引用 | 本机实际路径 | 验证情况 |
|---|---|---|
| W1 会话创建与工具合并 | `lib/rpc-manager.ts`（`startRpcSession`、`withExtensionTools`、`setActiveToolSelection`） | **P0-02 实测**：`withExtensionTools` 确实把扩展工具并入活动集；非 Orb cwd 不泄漏 |
| W2 工具选择校验 | `lib/session-tool-selection.ts`（`validateSessionToolSelection` 只允许内置工具名） | **P0-02 实测**：`set_tools: []` 得到 chat-only，扩展工具与命令均随之消失 |
| W3 工具预设菜单 | `components/ChatInput.tsx` 的 `TOOL_PRESETS` | **P0/P0-05 记录**：无 `registerToolPreset` 接口；未改上游菜单 |
| W4 客户端 API/SSE | `app/api/agent/new/route.ts`、`app/api/agent/[id]/route.ts`、`app/api/agent/[id]/events/route.ts`、`app/api/sessions/[id]/route.ts` | **P0-03 实测**（Node + 真实 Electron 两条腿） |
| W5 启动偏好 | `lib/startup-preferences.ts` | 未在本轮测试中改动；Orb 不得未经确认传新默认模型偏好 |
| P1 Pi 扩展 API | `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` + `docs/extensions.md` | **P0-02 实测**：`registerTool`/`registerCommand`/`setActiveTools`/`session_start`/`before_agent_start`/`sessions` sections |
| P2 图片消息类型 | `docs/message-types.md` | 未验证（属 P1-04） |
| P3 包/资源范围与信任 | `docs/packages.md` + `lib/project-trust.ts` | **本轮新增真实发现见下方** |

### 新增真实发现：用户级 `.agents/skills` 无法用 cwd 或 agentDir 隔离

Pi 加载 **用户级** `HOME/.agents/skills`，其中 `HOME` 在**运行时**解析（`process.env.HOME || homedir()`），**与 cwd 和 `agentDir` 均无关，且无条件加载**。因此：

- 本轮首次运行时测试 cwd 在 `%TEMP%`（用户 profile 下），真实用户级 16 个 skills 被加载进会话 prompt；但那**不是**因为祖先链，而是因为用户级目录本身。
- 仅把 cwd 移出 profile **不能**修复；必须把子进程 `HOME` 指向隔离目录。
- 产品含义：**只要宿主用户有 `~/.agents/skills`，它就会进入所有会话的 prompt，Orb 无法用工作目录或 agentDir 隔离**（包括普通 cwd 会话）。这对“非破坏性”的影响是：Orb 不能承诺“更改 prompt 内容”为零，但可以承诺“不主动改变它”。P1-01 必须显式声明这一点。

## N1–N8 对照结果（结合 P0-02/P0-03/P0-04 证据）

| 不变量 | 本阶段证据 | 状态 |
|---|---|---|
| N1 普通 cwd 行为不变 | P0-02：普通 cwd 的工具、命令、模型输入（含真实 provider 请求体）无 Orb 痕迹 | 本 P0 测试面通过 |
| N2 不改全局默认值/凭据/主题/插件配置 | 写入清单；全部测试只写隔离 agent 目录与 `evidence/`；pi-web 6 文件哈希与基线逐一同值 | 本 P0 测试面通过 |
| N3 普通会话不新增 GUI 工具 | P0-02：普通 cwd 请求无 `orb_probe`、无 `orb_p0_probe` section | 本 P0 测试面通过 |
| N4 单一后端所有权 | P0-03：壳/Electron 退出后服务仍存活；只连接已有服务，不重启/升级 | 本 P0 测试面通过 |
| N5 不双写会话 | P0-03：双客户端同一 sessionId；reload 后 sessionId 稳定；旧代次请求被拒 | 本 P0 测试面通过 |
| N6 不删除用户文件/历史 | 写入清单；全部运行只写约定目录；像素零落盘 | 已保持（P0 范围） |
| N7 退出/断连清理授权 | P0-03：代次提升与撤销授权后立即拒绝；P0-04：GDI 逐周期零增长 | 部分覆盖；按键/鼠标释放属 P1-05 |
| N8 明确版本、不保留废弃 fallback | 版本表 + 依赖锁；仅用受支持 API，无 monkey patch | 已遵守 |

## 当前结论

P0-01 的环境、写入边界与代码引用已固化并完成映射；运行行为由 P0-02/P0-03/P0-04 取证。**P0 整体是否通过需看 P0-05 决策记录中的未通过项**。
