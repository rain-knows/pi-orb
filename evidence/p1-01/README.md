# P1-01 工作区与独立会话

> 运行方式：
> - 集成（真实 pi-web 快照 + 隔离 agent/HOME + 本机假 provider）：`node evidence/p1-01/run-p1-01.mjs`
> - 应用层（真实 Electron 工作区写入路径）：`node evidence/p1-01/run-p1-01-app.mjs`
>
> 原始结果：`result.json`（19/19 断言）、`workspace-app.json`（22/22 断言）
> 状态：**通过**。这是 M1 的第一个交付项。

## 1. 交付内容

| 能力 | 位置 |
|---|---|
| Orb 配置契约（schema 校验、精确目录匹配、路径解析） | `src/shared/orb-config.ts` |
| 配置读写（原子写入、损坏文件不覆盖） | `src/main/config-store.ts` |
| 工作区校验与创建 | `src/main/workspace.ts` |
| 会话创建与切换（工作区切换必须新建会话） | `src/main/orb-session.ts` |
| 应用层装配（设置工作区 → 新代次 → 建会话） | `src/main/index.ts` |
| Orb 模式 Pi 扩展（精确 cwd 条件注册） | `pi-package/extensions/orb.ts` |
| 单元测试 | `tests/orb-config.test.ts`、`tests/workspace.test.ts`、`tests/orb-session.test.ts` |

## 2. 验收项实测

### 2.1 未选 cwd 不能启用；取消零写入（22/22 应用层断言）

| 验收点 | 实测 | 证据 |
|---|---|---|
| 启动应用不选任何工作区 | `configured=false`、`workspace=null`，且**配置文件不存在** | `workspace-app.json` |
| 未选工作区时 Orb 模式在“将来的 Orb 目录”也不生效 | 该目录的模型请求**无** `orb_mode` section | `result.json` |
| 相对路径拒绝 | `ok=false, resolved=null` | 两处独立断言 |
| 不存在的目录拒绝且**不创建任何东西** | `ok=false`，目录仍不存在 | `workspace-app.json` |
| 文件当作工作区拒绝 | `ok=false` | 同上 |
| **取消零写入** | 提交后再传空值：配置文件**字节完全相同**、不创建目录、原工作区保持不变 | 同上 |
| 未确认时不创建新目录 | `setWorkspace(missing, false)` 后目录仍不存在 | 同上 |
| 被拒绝的选择要报给用户 | `problem` 非空，且原工作区不被破坏 | 同上 |

失败的选择**不会**清空已提交的工作区，但会给出原因；否则用户选错目录时界面毫无反应。

### 2.2 Windows 大小写 / 符号链接 / junction（P1-01 明确要求）

| 情形 | 实测结果 |
|---|---|
| junction 指向同一目录 | junction 与目标的 `resolved` **完全一致**（`realpathSync.native` 解析） |
| 同一路径的大写拼写 | 与真实路径归一到**同一标识** |
| 比较键 | Windows 上大小写不敏感、分隔符统一；非 Windows 保持大小写敏感（单测覆盖） |

实现要点：比较键（`normalizeDirPath`）与真实身份（`realpathSync`）**都**参与判定，解析后的路径才是写入配置并交给 pi-web 的值，因此一个目录不会变成两个不同的 Orb 模式。

### 2.3 精确匹配，不是前缀匹配（19/19 集成断言）

在真实 pi-web 上，以假 provider **捕获真实请求体**判定，而不是看界面标签：

| cwd | 是否进入 Orb 模式 | 工具集 |
|---|---|---|
| 工作区本身 | **是**（出现 `orb_mode` section） | `bash, read` |
| 普通目录 | 否 | `bash, read` |
| 工作区的**子目录** | 否 | `bash, read` |
| 名称前缀相似的**同级目录**（`orb-workspace-2`） | 否 | `bash, read` |
| 未配置工作区时的 Orb 目录 | 否 | — |

同时断言：安装扩展后普通目录的提示与工具集与**安装前基线**一致（N1/N3）。

### 2.4 切换工作区不串会话、不毁历史

| 验收点 | 实测 |
|---|---|
| 不同工作区得到不同 session | 是（`...f084` vs `...f5e1`） |
| 第二个工作区仍在 Orb 模式 | 是 |
| 切换后原会话文件仍存在 | 是 |
| 原会话历史**逐字节未变** | 是（5968 字节 / 6 行 JSONL） |
| 切换新增了会话文件 | 6 → 7 |

原因（记录以免后续误改）：pi-web 在**创建时**固定 `cwd`，复用会话会让新工作区跑在旧目录上，所以切换必须新建会话。

### 2.5 显式声明：`~/.agents/skills` 会进入所有会话 prompt

这是 P0-05 决策要求带入 P1-01 的产品事实，本次**实测复现**而不是文字声明：

| 检查 | 实测 |
|---|---|
| 隔离 HOME 下放置一个用户级 skill 夹具 | 命中标记 = **1 次** |
| 未安装扩展、普通 cwd 会话 | 标记**存在**（1 次） |
| 安装扩展后、普通 cwd 会话 | 标记仍在，次数**不变**（1 次） |
| Orb cwd 会话 | 标记同样存在（1 次） |

**结论（产品承诺的边界）**：Pi 无条件加载**用户级** `$HOME/.agents/skills`，`HOME` 在运行时解析，与 `cwd`、`agentDir` 均无关，因此该内容会进入**每一个**会话（含普通非 Orb 会话）的 prompt。Orb 能承诺的是“**不主动改变**它”，**不能**承诺 prompt 内容逐字节零差异。真实宿主 profile 有 16 个用户级 skill（`evidence/p0-01/README.md`）；本次未读写任何真实用户 profile 文件。

## 3. 本阶段发现并修复的两个真实缺陷

### 缺陷 1：主进程忽略 `PI_ORB_CONFIG`，与扩展读的不是同一个文件

主进程用 `app.getPath("userData")` 硬拼路径，而 Pi 扩展按 `PI_ORB_CONFIG` 解析。设置该变量后**两侧读写的文件不同**，结果是：配置写成功、界面显示已配置，但 Orb 模式永远不会激活——一个没有报错的死路。

修复：把路径解析**收敛到 `src/shared/orb-config.ts` 的单一函数** `resolveOrbConfigPath`，主进程传入 Electron 的 `userData`，扩展在无 Electron 时按同一规则推导（Windows `%APPDATA%\pi-orb`，其它平台 `$XDG_CONFIG_HOME/pi-orb`）。并新增 6 个单测固定“两侧解析一致”，其中包括“空覆盖值不得产生不可用路径”。

### 缺陷 2：拒绝新工作区时不给用户任何原因

选择了一个不可用目录后，旧工作区仍可用，于是状态里 `problem=null`——用户看不到任何反馈。修复：把“最近一次操作的问题”作为状态的一部分上报，并在取消时清除陈旧问题。

## 4. 非破坏性确认

- `node evidence/p0-01/verify-baseline.mjs` 通过：pi-web HEAD 与 6 个既有用户改动文件未触碰。
- 集成脚本额外断言 pi-web 工作树仍**只有**那 6 个既有改动。
- 全部运行只写本次运行目录与 `evidence/`；不读写真实 `~/.pi/agent`、`auth.json`；不传入真实密钥；不截图、无鼠标键盘输入。

## 5. 复现前置

集成脚本复用 P0-02 建立的固定 HEAD 快照（`%TEMP%\pi-orb-p0-head-src`：`git archive` + `npm ci` + `next build`）。若快照缺失或未构建，脚本会明确报错并提示先运行一次 `node evidence/p0-02/run-p0-02.mjs`，而不是静默退化。

## 6. 明确未验证

- **未做真实 pi-web 端到端聊天**：Orb 会话的完整对话流（发送、流式、停止、断连重连）属 **P1-02**；本阶段只验证会话创建与工作区绑定。
- **未验证无权限目录**：本机以当前账户运行时无法构造“存在但不可访问”的目录而不改动 ACL（属对用户环境的破坏性操作）。`no-read-access` / `no-write-access` 分支有单测，但未在真机构造该状态。
- **未验证多显示器、网络驱动器（UNC）路径**：UNC 的归一化有单测，未做真机访问。
- 未验证快捷键行为（属 P1-03）、截图（P1-04）、桌面输入（P1-05）。
