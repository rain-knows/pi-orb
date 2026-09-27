# P0-02 插件可行性验证结果

> 运行方式：`node evidence/p0-02/run-p0-02.mjs`（可复现；每次运行重建隔离环境）
> 原始结果：`evidence/p0-02/result.json`
> 结论状态：**本机已通过（27/27 断言）**；这是“能非破坏性接入”的必要证据之一，不等于 P0 整体通过。

## 0. 修正记录：测试隔离缺口（已真正修复）

### 第一版的问题（严重）

第一版把运行 cwd 放在 `%TEMP%`（位于用户 profile 下），会话 prompt 里出现了真实的 `C:\Users\JUSTLIKEZYP\.agents\skills`。更糟的是：那时的泄漏断言检查 `snapshot.state.systemPrompt`，而该字段在这些阶段**长度为 0**，于是断言**空值通过**，而真实模型输入里仍含 14–15 处用户 skill。

- 旧结果保留为已知污染基线：`result-unclean-baseline-*.json`

### 根因（第一版的归因也是错的）

我当时归因为“`%TEMP%` 在 profile 下，Pi 沿祖先链扫描”。**真实根因不同**：`~/.agents/skills` 是 Pi 的**用户级**资源，由 `HOME` 决定并在**运行时**解析，无论 cwd 和 `agentDir` 如何都无条件加载（见快照内 `dist/core/package-manager.js` 的 `getHomeDir()` = `process.env.HOME || homedir()`，及用户级 `join(getHomeDir(), ".agents", "skills")` 加载分支）。因此**只改 cwd 是不够的**。

### 真正的修复

1. 给 pi-web 子进程传 `HOME` / `USERPROFILE` = 本次运行的隔离目录（`<runRoot>\home`）。
2. 泄漏断言改为检查**真实捕获的 provider 请求体**（不含反斜杠的通道），并在无请求可查时**失败关闭**（`vacuous`），而不是默认通过。
3. 保留运行目录在用户 profile 之外，作为额外防护。

### 修复后的实测

| 检查 | 污染基线 | 修复后（当前 `result.json`） |
|---|---|---|
| 检测器对真实模型输入 | `leaked=true` | `leaked=false` |
| normal 请求中 `.agents` / `JUSTLIKEZYP` / `SKILL.md` 命中数 | 14 / 有 / 15 | **0 / 0 / 0** |
| 断言检查的样本数（`inspected`） | – | 1（非空值） |

**反向对照已验证检测器本身有效**：把同一份检测逻辑指向旧的污染基线会报 `leaked=true`，指向当前结果报 `false`。否则“通过”可能来自一个永不报警的假检查。

> 注意：Electron 进程**不能**继承这个 `HOME` 覆盖——实测覆盖后 Electron 静默退出、零输出；它不运行 Pi 代码，因此不需要该隔离。两个环境现已在脚本中分开。

## 1. 验证的不是 mock，而是真实 pi-web 装配

| 项目 | 实际做法 |
|---|---|
| 被测源码 | `git archive` 导出 pi-web 固定 HEAD `95a58744532c7fccaa933aa7757a1419ace67ed2` 到 `%TEMP%\pi-orb-p0-head-src` |
| 依赖 | 在该快照内独立 `npm ci`（280 包），不修改 pi-web 的 `node_modules` |
| 构建 | 快照内 `next build --webpack`（`--max-old-space-size=12288`）成功后用 `next start` 运行 |
| 端口 | `127.0.0.1:31287`（与用户正在运行的 30141 无关） |
| 运行目录 | 每次运行新建 `D:\pi-orb-p0-runs\p0-02-<pid>`（**在用户 profile 之外**），内含 `agent/`、普通 cwd、Orb cwd、子目录、前缀相似目录与 `home/` |
| 用户级资源隔离 | 子进程 `HOME` / `USERPROFILE` 指向 `<runRoot>\home`（空目录），以阻断 `~/.agents/skills` 被无条件加载 |
| 凭据 | 子进程只继承系统必需变量；模型密钥、用户 `~/.pi/agent`、现有插件配置均不传入 |
| 模型 | 本机假 provider（`http://127.0.0.1:31288/v1`，`openai-completions`）捕获真实 prompt 与工具 schema；不访问任何真实模型 |
| 截图／输入 | 全程未截图、未执行桌面输入 |

隔离边界是**进程 + 目录 + 端口 + HOME** 四层：测试进程属于本次运行，只写运行目录与 `evidence/`；模型调用指向本机假服务。

## 2. 最小测试扩展

`evidence/p0-02/orb-probe-extension.ts`：

- 仅在 `resolve(ctx.cwd)` 与 `PI_ORB_P0_ORB_CWD` **规范化后完全相等**时注册；
- 注册 `orb_probe` 工具与 `/orb-probe` 命令，并用 `setActiveTools` 去重激活；
- `before_agent_start` 只在匹配时写入结构化 section `orb_p0_probe` 与 guideline；
- 只读；不执行任何桌面输入，不自行选择模型。

普通 cwd 不注册任何工具、命令或提示段——这直接对应 N3（普通会话不得新增模型可见 GUI 能力）。

## 3. 通过断言（27/27）

安装前基线：

1. 无扩展时普通 cwd 无 orb 工具
2. 无扩展时普通 cwd 无 orb 命令

安装扩展后（同一隔离配置）：

3. 普通 cwd 无 orb 工具
4. 普通 cwd 无 orb 命令
5. 精确 Orb cwd 有 orb 工具
6. 精确 Orb cwd 有 orb 命令
7. Orb cwd 的子目录不匹配
8. 与 Orb cwd 前缀相似的同级目录不匹配
9. 同一 Orb cwd 的两个并发会话都获得工具

真实模型输入（假 provider 捕获）——**这是关键对照**：

10. normal cwd 模型输入已被检查（样本非空）
11. normal cwd 模型输入**无宿主资源泄漏**
12. Orb cwd 模型输入已被检查（样本非空）
13. Orb cwd 模型输入**无宿主资源泄漏**

生命周期：

14. fork 继承条件扩展（含工具与命令）
15. fork 产生不同 session id
16. chat-only（`set_tools` 置空）移除扩展工具与命令
17. 恢复工具选择后扩展工具回归
18. `reload` 后条件注册仍成立
19. 重启（resume）后条件注册仍成立

Orb 差异（假 provider 捕获）：

20. Orb cwd 请求携带 `orb_probe` 工具 schema
21. Orb cwd 请求包含结构化 `orb_p0_probe` prompt section
22. 普通 cwd 确实发出了模型请求（负例前提成立）
23. 普通 cwd 请求**不含** `orb_probe` 工具
23. 普通 cwd 请求**不含** orb prompt section
24. 普通 cwd 会话 system prompt 不含 orb section
25. Orb cwd 会话 prompt 暴露 orb section

26. 移除扩展后，普通行为恢复（无 orb 工具／命令）

卸载已于上条声明（26 项共 27 条断言，其中“两会话”与“前缀相似目录”各计一条）。
关键实测差异（同一 provider 请求对比）：普通 cwd `tools=[read]`；Orb cwd `tools=[read, orb_probe]`，且 system prompt 多出 `orb_p0_probe` 段。

## 4. 环境限制（必须记录，不得掩盖）

- pi-web 当前 `node_modules` **不完整**（缺 `@next/env`，`npm ls` 报大量 UNMET/EXTRANEOUS），因此无法直接从该目录 `next dev`/`next start`。测试改用快照内独立安装，未修改 pi-web。
- 直接对 pi-web 目录做固定 HEAD 生产构建时曾两次 OOM（4GB、8GB 堆）。快照内 12GB 堆构建成功。
- `next dev` 在本机不可用于该快照：Turbopack 拒绝跨盘 `node_modules` 链接，webpack 跨盘符解析失败，临时目录文件监视器触发 libuv `fs-event.c` 断言。因此采用 **生产构建 + `next start`**。
- 因此“上游更新兼容性”仍属未验证：本结论只针对上表固定版本组合。

## 5. 对非破坏性合同的贡献

| 不变量 | 本任务证据 | 状态 |
|---|---|---|
| N1 普通 cwd 行为不变 | 安装前／后普通 cwd 工具、命令、模型输入对比 | 已覆盖本项测试面 |
| N2 不改全局默认值与配置 | 测试只写运行目录；`HOME` 已重定向到隔离目录，**未读也未写**真实 `~/.pi/agent` 与 `~/.agents`；pi-web 工作树未写入 | 已覆盖本项测试面 |
| N3 普通会话不新增 GUI 能力 | 普通 cwd 请求无 orb 工具、无 orb prompt | 已覆盖本项测试面 |
| N8 不维护废弃路径 | 仅用受支持的 `registerTool`/`registerCommand`/`setActiveTools`/`before_agent_start`，无 monkey patch | 已覆盖本项测试面 |
| N6/N7 卸载与清理 | 已测“移除扩展后行为恢复”；按键释放、授权撤销属 P0-03/P1 | 部分覆盖 |

## 6. 明确未验证

- 未验证 macOS/Linux。
- 未验证其它 pi-web／Pi SDK 版本组合。
- 未验证真实模型供应商、真实截图与真实桌面输入（按计划属于 P0-04／P1-05）。
- 生产构建在本机原始 pi-web 目录（非快照）受内存限制未通过，属环境限制而非源码缺陷。
