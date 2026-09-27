# pi-Orb P0 证据总览

本目录保存“证明可以非破坏性接入”的**可复现证据**，不是实现完成报告。

## 目录

| 路径 | 内容 | 状态 |
|---|---|---|
| `p0-01/` | 环境与合同基线：支持版本、写入清单、N1–N8 对照、**可校验的变更文件 SHA-256 基线** | 已完成 |
| `p0-02/` | 插件可行性：真实 pi-web 装配，条件注册与零泄漏（27/27 断言，含 fork） | **通过** |
| `p0-03/` | 客户端 API/SSE 与安全桥接：Node 腿 27/27 断言；真实 Electron 腿 16/16 断言 | **通过** |
| `p0-04/` | 桌面驱动只读探针：窗口/DPI、截图/解码、后台语义、取消与清理 | 只读项完成；**Cua 运行时验证未通过（未安装）** |
| `p0-05/` | 最小接入方案决策记录 | 已完成 |
| `p1-00-foundation/` | P1 基建：工程骨架、质量门禁、启动冒烟、忽略规则与版本维护 | **通过**（门禁 4/4，启动 9/9） |
| `p1-01/` | P1-01 工作区与独立会话：精确 cwd 匹配、切换不串会话、用户级 skill 事实 | **通过**（集成 19/19，应用 22/22） |
| `p1-02/` | P1-02 Electron 最小浮窗：聊天闭环、独立会话、显式停止、安全姿态 | **通过**（35/35） |
| `p1-03/` | P1-03 常规唤醒快捷键：OS 级注册、冲突诊断、改键与退出释放 | **通过**（20/20）；按键人工体验未验证 |
| `p1-04/` | P1-04 明确授权的截图上下文：目标记录、DPI、拒绝路径零上传、text-only 拒绝 | **部分通过**（21/21）；正向截图路径本机未验证 |
| `p1-05/` | P1-05 真机驱动验收：安装物哈希、运行时工具目录、坐标空间、点击/输入/释放 | **部分通过**（只读 20/20、输入 20/20）；滚动与前台路径未验证 |
| `p1-06/` | P1-06 Orb 模式与工具闭环：工具仅限 Orb 模式、授权/预算/新鲜度、真实点击整链路 | **通过**（工具暴露 7/7、闭环 34/34）；模型调用工具与输入/滚动未验证 |

## 复现方式

```powershell
# P0-01 哈希基线（记录 + 校验；校验失败即非零退出）
node evidence/p0-01/record-baseline.mjs
node evidence/p0-01/verify-baseline.mjs

# P0-02 插件可行性（真实 pi-web 装配）
node evidence/p0-02/run-p0-02.mjs

# P0-03 客户端与桥接（Node 腿）
node evidence/p0-03/run-p0-03.mjs
# P0-03 客户端（真实 Electron 腿；需先有 D:\pi-orb-p0-runs\electron-probe 的 electron 44.4.5）
node evidence/p0-03/run-p0-03-electron.mjs

# P0-04 只读窗口/DPI 枚举
powershell -File evidence/p0-04/window-probe.ps1
# P0-04 截图/解码/清理（两种 DPI 模式各一次）
powershell -File evidence/p0-04/probe-capture.ps1 -AwarenessMode unaware -OutPath evidence/p0-04/capture-unaware.json
powershell -File evidence/p0-04/probe-capture.ps1 -AwarenessMode permonitorv2 -OutPath evidence/p0-04/capture-permonitorv2.json
```

P0-02/P0-03 会自动：核验 pi-web HEAD 是否为 `95a58744532c7fccaa933aa7757a1419ace67ed2`（不是则拒绝运行）→ 在 `%TEMP%\pi-orb-p0-head-src` 导出该提交的只读快照 → 快照内独立 `npm ci` + `next build` → 用独立 loopback 端口与隔离 agent 目录运行 → 结束后写 `result.json`。

```powershell
# P1-00 基建门禁（类型检查 / 代码检查 / 单测 / 构建 / 忽略规则 / pi-web 基线）
node evidence/p1-00-foundation/verify-foundation.mjs
# P1-00 真实 Electron 启动冒烟（隔离 userData 与配置；不截图、无桌面输入）
node evidence/p1-00-foundation/run-boot-smoke.mjs
# P1-01 工作区与独立会话（需先有 P0-02 的固定 HEAD 快照）
node evidence/p1-01/run-p1-01.mjs
node evidence/p1-01/run-p1-01-app.mjs
# P1-02 Electron 最小浮窗端到端（真实 Electron + 真实 pi-web + 本机假 provider）
node evidence/p1-02/run-p1-02.mjs
# P1-03 唤醒快捷键（真实 OS 注册 + 第二进程竞争探针；不合成按键）
node evidence/p1-03/run-p1-03.mjs
# P1-04 截图授权（只读捕获源探测 + 授权/拒绝路径端到端）
node evidence/p1-04/probe-desktop-capturer.mjs
node evidence/p1-04/run-p1-04.mjs
# P1-05 真机驱动验收（只读运行时探测 + 丢弃式目标上的真实输入）
node evidence/p1-05/probe-cua-driver.mjs
node evidence/p1-05/run-p1-05.mjs
# P1-06 工具暴露与桌面闭环
node evidence/p1-06/run-p1-06-tools.mjs
node evidence/p1-06/run-p1-06.mjs
```

## 隔离边界（所有 P0 阶段一致）

- **源码**：`git archive` 导出固定 HEAD，不修改 pi-web 工作树与 `.git`
- **依赖**：快照内独立 `npm ci`（pi-web 原 `node_modules` 不完整，缺 `@next/env`，不可直接使用）
- **凭据**：子进程只继承系统必需变量 + 隔离测试密码；用户 `auth.json`、`~/.pi/agent`、真实密钥均不传入
- **模型**：本机假 provider；无外网、无真实模型
- **配置**：`PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR` 指向每次运行新建的临时目录
- **运行 cwd**：`D:\pi-orb-p0-runs\<阶段>-<pid>`（**必须在用户 profile 之外**）
- **`HOME` / `USERPROFILE`**：指向 `<runRoot>\home`（空目录）

  > 为什么必须隔离 `HOME`：Pi 无条件加载**用户级** `HOME/.agents/skills`，且 `HOME` 在运行时解析（`process.env.HOME || homedir()`）——**与 cwd、`agentDir` 均无关**。第一版只改 cwd，结果宿主用户真实的 16 个 skills 仍被送进模型 prompt；而当时的断言检查的 `systemPrompt` 字段恒为空，**空值通过**。现已改为检查真实捕获的 provider 请求体，并在无样本可查时失败关闭。反向对照已验证该检测器会对污染基线报警。

  > Electron 进程**例外**：它必须拿到真实用户 profile，否则静默退出、零输出（已实测）；它不运行 Pi 代码，故无需该隔离。两个环境在脚本中分开。
- **端口**：P0-02 用 31287、P0-03 用 31289，均与在用的 30141 无关
- **桌面**：无鼠标键盘输入；截图经用户明确许可，每次仅 1 张，**像素零落盘**
- **Electron**：仅在 `D:\pi-orb-p0-runs\electron-probe` 安装 electron 44.4.5 作测试用；探针窗口 `show:false`，不在屏幕上显示

## 证据完整性核验（本文件生成时）

- pi-web 工作树：仍为 6 个既有改动（`app/endfield.css`、`components/AppShell.tsx`、`components/ChatInput.tsx`、`components/MessageView.tsx`、`components/SessionSidebar.tsx`、`docs/local-endfield-verification.md`）
- 该 6 个文件 SHA-256 已**落盘**于 `evidence/p0-01/changed-files.sha256`，并由 `verify-baseline.mjs` 逐轮重算比对：记录时 6/6 同值、`HEAD` 未变、无新增已修改文件 → `passed=true`
- pi-web HEAD 仍为 `95a58744532c7fccaa933aa7757a1419ace67ed2`
- `evidence/` 下无任何图片文件 → 无像素落盘
- 存在第二个 pi-web worktree `D:/pi-web-extension-scroll-pr`（分支 `fix/extension-custom-ui-scroll-height`），**属于用户自己的 PR 工作，与本项目无关，未被触碰**

## 重要事实修正

`lib/session-revision.ts` 的 `snapshotRevision` 是**客户端缓存有效性令牌**，不是权限检查、也不是运行代次。运行代次与任务授权必须由执行层显式绑定并校验。
