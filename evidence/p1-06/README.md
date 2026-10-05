# P1-06 Orb 模式与工具闭环

2026-10-05 当前参考合同：C7 20/20、D6 21/21、D8 22/22、可见浏览器 22/22；后台
完成 8/8、产品桥停止 10/10、真实 provider 失败回读 12/12。均为有限样本。
`open_app` 冷启动旧适配已按参考修正，修复后运行因锁屏中止，仍未验收。
下方较早 D 组及旧 orb_* 判定保留为历史，当前结论以本段及对应 session-access JSON 为准。

> 运行方式：
> - `node evidence/p1-06/run-p1-06-tools.mjs`（工具暴露：真实 pi-web + 本机假 provider 捕获工具 schema）
> - `node evidence/p1-06/run-p1-06.mjs`（工具闭环：真实 Electron 壳 + 真实驱动 + 丢弃式目标；含 C7 取点↔落点断言）
> - `node evidence/p1-06/run-real-model-c7.mjs`（真实模型 C7：隔离真实 pi-web + 真实模型；**需解锁的交互式桌面**）
> - `node evidence/p1-06/run-real-model-c7.mjs d6-scroll`（真实模型 D6；**需解锁的交互式桌面**）
> - `node evidence/p1-06/run-real-model-c7.mjs d8-type`（真实模型 D8；**需解锁的交互式桌面**）
> - `node evidence/p1-06/run-real-model-c7.mjs browser`（真实可见网页闭环）
> - `node evidence/p1-06/run-real-model-c7.mjs open-app`（独立 WinForms 应用冷启动闭环）
> - `node evidence/p1-06/run-real-code-agent.mjs`（真实模型后台 `code_agent`：独立 worker、产物和完成通知）
> - `$env:PI_ORB_EVIDENCE_PI_WEB='...'; node evidence/p1-06/run-real-code-agent.mjs stop`（真实模型后台停止：worker 取消、注册表和通知）
> - `node evidence/p1-06/run-real-code-agent.mjs failure`（真实 provider 错误回读，要求错误全文一致）
>
> 历史结果：旧版 `tool-exposure.json`（7/7）、`loop-verification.json`（迁移前）、`loop-verification-reference-backend.json`（旧授权模型）与 `real-model-*-reference-backend.json`；当前 session Access 闭环由脚本写入 `loop-verification-session-access.json`。真实模型新合同结果独立写入 `real-model-*-session-access.json`，不覆盖历史记录。
> 状态：下方旧 `orb_*` 表格属于迁移前历史；当前 Orb 工作区以 13 个直接 GUI 工具加 3 个后台工具为准。后台真实模型完成闭环已通过 8/8（`real-model-code-agent-session.json`），停止闭环已通过 10/10（`real-model-code-agent-stop-session.json`）；C7/D6/D8 和后台失败仍按当前支持矩阵标为未验证。旧 Cua 链路只作迁移基线，不代表最终生产后端。

## 1. 交付内容

| 能力 | 位置 |
|---|---|
| 工具契约、限额、拒绝理由、模式提示段 | `src/shared/orb-tools.ts` |
| 任务授权与批次状态机（一动作一观察、失败即停） | `src/main/desktop-task.ts` |
| 桥协议（版本、令牌比较、浏览器来源识别） | `src/shared/bridge-protocol.ts` |
| 桥服务端（命名管道、准入规则、拒绝上抛） | `src/main/bridge-server.ts` |
| 桌面 broker（策略→驱动，行为唯一裁决点） | `src/main/desktop-broker.ts` |
| Cua 适配器（历史 P1 证据；已从生产代码删除） | `evidence/p1-05/` 与本目录历史 JSON |
| 扩展侧工具注册、`/orb` 命令、桥客户端 | `pi-package/extensions/orb.ts`、`bridge-client.ts` |
| 壳侧授权 IPC 与界面 | `src/main/index.ts`、`src/renderer/index.html`、`src/renderer/floating.js` |
| 单测 | `tests/orb-tools.test.ts`、`desktop-task.test.ts`、`desktop-broker.test.ts`、`bridge-server.test.ts` |

## 2. 工具暴露实测（7/7，真实 pi-web 装配 + 假 provider）

判定来自**本机假 provider 实际收到的工具 schema**，而不是注册调用是否成功。

| 断言 | 实测 |
|---|---|
| 普通会话**没有**任何 Orb 工具 | 通过（`orbTools=[]`） |
| Orb 会话获得当前支持的 16 个工具 | `click, input_text, scroll, hotkey, long_press, drag, wait, long_wait, screenshot, open_in_browser, open_in_finder, list_apps, open_app, code_agent, code_agent_status, code_agent_stop` |
| 普通会话只保留 pi-web 自身工具 | `bash, read`（与 P0-02/P1-01 的基线一致） |
| Orb 提示段只出现在 Orb 模式 | `orb=true normal=false` |
| 提示段包含"一动作一观察" | 通过（`observe again`） |
| 提示段声明屏幕内容为不可信输入 | 通过（`untrusted input`） |

此脚本现作为 N3 回归门禁，验证普通会话不因安装扩展而新增模型可见的 GUI 能力，Orb 会话则只获得当前支持的工具。当前证据由 provider 实收 schema 判定，覆盖 13 个参考 GUI 工具和 3 个后台工具。

## 3. 历史产品侧闭环（迁移前 Cua，38/38）

本节保留迁移前的产品侧基线，不能单独代表当前生产 backend；旧 session Access 前的参考 backend 记录也仅供追溯。当前产品闭环由
`loop-verification-session-access.json` 和 §5.1 的新真实模型记录证明。

此前参考 backend 闭环记录 `loop-verification-reference-backend.json`（41 项检查）使用已移除的逐任务 scope 与选窗 API，属于历史证据。新脚本使用 Read Only / Workspace Write、自动前台观察和 session grant；运行后以新文件实际结果为准。其中“模型实际调用工具”、Chromium 内容输入、真实驱动失败批次停止和多会话任务锁仍由真实模型证据、当前支持矩阵和单测分别覆盖。

被测链路是产品自己的代码，不是模拟：

```
丢弃式 Electron 目标（自报收到的事件）
  ↑ 参考项目 Windows native backend（真实输入）
  ↑ src/main/reference-windows-driver.ts
  ↑ src/main/desktop-broker.ts     策略：授权、预算、新鲜度、失败即停
  ↑ src/main/bridge-server.ts      命名管道 + 每次运行的令牌 + 代次校验
  ↑ 扩展读取的握手文件
```

### 3.1 桥与准入

| 断言 | 实测 |
|---|---|
| 握手文件写入令牌、管道路径与工作区 | 通过 |
| 管道应答 `hello` | 通过 |
| 无活跃会话的请求被拒 | 通过 |
| **浏览器来源请求即使带正确令牌也被拒** | `browser-originated-request` |

### 3.2 目标识别（orb 不猜目标）

| 断言 | 实测 |
|---|---|
| 壳能列出桌面窗口 | 18 个 |
| 目标窗口按**进程 id**被列出 | 通过（`pid=30316`，`P1-05 input target`） |
| 可选择目标窗口 | 通过 |
| 选择结果回报给用户 | 通过（含窗口标题、应用名、bounds） |

### 3.3 授权与拒绝零副作用

| 断言 | 实测 |
|---|---|
| 未授权时拒绝动作 | 通过 |
| 拒绝理由为 `no-task-authorization` | 通过 |
| **被拒动作对目标零副作用** | 通过（事件数不变） |
| 观察在未授权时允许（只读） | 通过 |
| 经真实 UI 路径可批准任务 | 通过 |
| 批准记录用途文本 | 通过 |
| **空白用途不会创建任务** | 通过（`authorized=false`） |
| 陈旧观察被拒 | `stale-observation` |

### 3.4 真实点击闭环

| 断言 | 实测 |
|---|---|
| 经产品路径观察并报告目标窗口 | 通过（窗口 735×684 物理像素，动作空间标注为 screen DIP） |
| 授权动作被执行 | 通过 |
| **点击经整条链路到达窗口** | 通过 |
| **落点为目标格子（1,2）** | 通过，格内偏移 **(60,46)** = 格子中心（120×90 的中心为 60,45），1 像素取整差 |
| 同时产生按下与松开 | `down=1 up=1` |
| 动作结果提示模型重新观察 | 通过 |
| **重放同一观察被拒** | 通过（观察被消费后报 `observation-unknown`） |
| 任务状态报告已用动作数与上限 | 通过（上限 12） |
| 撤销后动作被拒 | 通过 |
| 旧的运行代次被拒 | 通过 |
| 壳与目标在结束后仍存活 | 通过 |

点击落点与格心的 1 像素差，说明整条链路的坐标换算没有系统性偏移，而不是"恰好落在格子里"。

## 4. 本阶段发现并修复的三个真实缺陷

### 缺陷 1：桥把策略拒绝包成"请求成功"

broker 对策略拒绝返回 `{ ok:false, refused:true, reason }`，而桥服务端原先一律包成 `{ ok:true, result }`。后果是调用方读到"请求成功"但动作没执行——拒绝被渲染成普通结果，任何统计也会把被拒动作算作"已完成的工作"。

修复：桥把内层的策略拒绝**上抛**为拒绝请求（`promoteRefusal`），并把"成功结果原样透传"写成单测，使这条规则不会被无意改回。

### 缺陷 2：自动选择"最前窗口"会把输入送到错误的窗口

原实现在未指定窗口时按 `zIndex` 取最前窗口。实测中**触摸键盘宿主（TextInputHost.exe）**的 z-index 高于被测窗口，于是点击被投递到它而不是目标窗口——正是产品绝不能有的"点错窗口"。

修复：**取消该回退**。目标窗口必须被明确识别（调用方给出或用户选择），否则观察直接拒绝并说明原因。这条与截图路径的"目标必须在获得焦点前记录"是同一原则。

### 缺陷 3：同一观察可被重放

动作执行后观察仍留在适配器里，因此同一张图可以连续发多个动作——违反 §6.2 的"一动作一观察"。修复：动作执行后**消费**该观察（成功与失败都消费），下一次动作必须先重新观察。

## 5. 输入投递能力的边界（沿用 P1-05 实测）

`doc/cua-driver-integration.md` 记录的约束在本阶段同样成立并已被代码采纳：

| 组合 | 结果 |
|---|---|
| 坐标点击 → Electron/Chromium 内容（后台） | **可用**（本阶段 4/4 及本次整链路通过） |
| 坐标点击 → 同一窗口（**前台**） | **可用**（目标记录到真实 `mouse-down`） |
| 滚动 → Chromium 内容（后台） | 拒绝：`background_unavailable`（该窗口类不支持后台投递该事件类型） |
| 滚动 → Chromium 内容（**前台升级**） | **不稳定，逐次核验**（P1-05 历史运行曾由目标日志确认 `wheel` 与滚动；2026-09-28 最新复跑未收到 `wheel`，驱动摘要不能单独作为通过证据） |
| 文本输入 → Chromium 内容 | 驱动拒绝（后台投递不支持该窗口类）；前台升级尚未做到稳定投递 |
| 元素寻址 | Chromium 内容不暴露可编辑元素，因此坐标是唯一可行寻址方式 |

因此工具集注册了 `input_text` 与 `scroll`，在这类窗口上被驱动拒绝时会**如实报回**给模型与用户，不会静默成功；`scroll` 可以按驱动规定请求前台升级，但目标是否实际收到滚轮需逐次核验。

## 5.1 真实模型 C7 验收：本轮在截图前失败

旧记录曾通过，但本轮新合同在截图前失败：唤醒快捷键未触发目标记录，截图请求被拒，真实模型没有产生
Orb 工具调用。结果写入 `real-model-c7-session-access.json`；`real-model-c7-reference-backend.json`
仍保留为历史，因此本节不把旧记录当作当前稳定结论。

```powershell
node evidence/p1-06/run-real-model-c7.mjs
```

它跑的是真实链路：丢弃式目标窗口 ← 参考项目 Windows native backend ← pi-orb broker/bridge
← **真实 pi-web** ← **真实模型**（`TZcode/deepseek-v4.1-flash`，声明支持图像）。

**隔离方式（本项的核心约束）**：

| 项 | 做法 | 理由 |
|---|---|---|
| 浮窗数据目录 | `--user-data-dir=<runRoot>\shell-data` | 绝不读写你正在运行的那个浮窗（pid 30620）的握手指令 |
| 浮窗配置 | `PI_ORB_CONFIG=<runRoot>\orb-config.json` | 工作区指向本次临时目录，激活隔离会话的 Orb 模式 |
| pi-web 配置目录 | 独立 agent 目录，`models.json` **硬链接**、`auth.json` **符号链接** | 用真实 provider/凭据，但**不产生任何凭据副本** |
| 会话落点 | 上述隔离 agent 目录 | 不写入你 `~/.pi/agent/sessions` 下任何既有会话 |

已实测确认隔离成立：真实 `~/.pi/agent/sessions` 下**没有**任何本次工作区的会话目录；
临时 agent 目录（含链接）在结束时删除。

本次运行使用隔离的 pi-web、Electron user-data、工作区和 agent 目录；真实模型配置通过硬链接／
符号链接接入，没有复制凭据，也没有写入用户既有会话目录。此前锁屏记录保留在 Git 历史中，
不再作为当前 C7 结论。

本次还修正了 harness 的桌面探测声明：`OpenInputDesktop` 的 Win32 返回值必须按句柄读取，
不能声明为 `bool` 后再与 `IntPtr.Zero` 比较；旧声明会把已解锁桌面误判为不可访问。

### D 组逐项结论（task-4）

下表只给结论，不把未验证当通过。两列分开写，因为“自动化已证明的部分”与“真实模型侧”不是同一件事：

- **结果（真实模型侧）** — 五种标签之一：`通过` / `失败` / `未验证` / `驱动报成功但目标未收到` / `不适用`。
- **自动化已证明的部分** — 与该项有关、但**不能代表**真实模型侧的那一半。

| # | 项 | 结果（真实模型侧） | 自动化已证明的部分 + 判据来源 |
|---|---|---|---|
| D1 | 模型**实际发起** `click`（使用自动附加截图） | **失败（最新复跑）** | 最新记录的模型工具调用为空；旧通过记录仍在 Git 历史 |
| D2 | 随后发起 `click`，坐标来自当前截图（分数 0–1000） | **失败（最新复跑）** | 最新运行没有产生点击调用 |
| D3 | 每次动作后产生**新的观察**（一动作一观察） | **未验证（最新复跑未进入动作）** | 需重新取得同一运行内的 observe→click→observe |
| D4 | 目标窗口报告**命中预期位置** | **失败（最新复跑）** | 目标日志没有 `cell-mousedown` |
| D5 | Access 控件显示当前权限档；撤权后不再执行 | **产品探针通过；人工未验证** | 新探针走 `revokeOrbAccess()`，并断言后续动作被拒 `no-task-authorization`：`loop-verification-session-access.json`；`tests/desktop-task.test.ts`。**人工点击** Access 控件的体验未验证 |
| D6 | 让模型滚动（`scroll`），目标收到 `wheel` 并动作后观察 | **环境中止** | 前台为 `LockApp`/不可交互桌面，未向模型发送动作；结果见 `real-model-d6-scroll-session-access.json` |
| D7 | 在**普通（非 Orb）**会话里操作桌面 | **通过** | 普通会话工具集为 pi-web 默认，不含 GUI 或后台工具；当前 Orb 会话获得 16 个：`tool-exposure.json`（7/7，判据是 provider **实收** schema，不是 UI 标签） |
| D8 | 让模型输入非敏感文本（`input_text`）并动作后观察 | **本轮未完成** | 没有生成新的 session-access JSON；旧记录仅作历史 |

小结：工具注册、授权、目标日志中的滚动/输入动作和普通会话隔离已通过；最新真实模型 C7/D6/D8
闭环均未完整通过，不能把一次动作成功写成稳定的模型闭环。旧 Cua JSON 仅用于迁移对照。

D6 的动作到达判据是 backend 的目标自身日志看到 `wheel` 且 `scrollTop` 改变；旧
`reference-backend` 记录满足这一部分，但本轮 session-access 运行在 `LockApp`/不可交互桌面中止，
未向模型发送动作。因此不能把旧驱动成功摘要替代当前真实模型证据。

2026-09-29 复核：`node evidence/p1-06/probe-native-wheel.mjs` 已启动并清理 disposable Electron 目标，但
`activate-window.ps1` 返回前台为“Windows 默认锁屏界面”（`reason=could-not-foreground`）。本次没有产生
目标事件，因此不把锁屏状态当作当前 backend 的输入行为证据；该输出仅保留为历史前置失败记录，当前结论以解锁桌面重跑结果为准。

## 6. 明确未验证

此前 `not-configured` 的桥接问题已经修复；真实模型 C7/D6/D8 的历史通过记录与最新失败复跑并存，
在连续复跑稳定前按未验证处理。

| 项 | 原因 |
|---|---|
| **open_app 修复后的真实冷启动闭环** | 新独立 WinForms 探针因锁屏中止，未向模型发送动作；见 `real-model-open-app-session-access.json`。 |
| **失败即停（batch-stopped）由真实驱动失败触发** | 由单测覆盖（`tests/desktop-broker.test.ts`）；本次整链路中未构造真实驱动失败。 |
| 普通 vs 高权限窗口、多显示器 | 未对高权限窗口测试（不自动提权）；仅 1 个显示器。 |
| 同一任务锁在多会话并发下的行为 | 单任务锁由单测覆盖；整链路只覆盖单会话场景。 |
| MacOS/Linux | 未在非 Windows 平台运行。 |

## 7. 安全与非破坏性确认

2026-10-05 后台闭环复测：`run-real-code-agent.mjs complete` 为 8/8，`stop` 为 10/10，
`failure` 为 12/12。failure 在隔离 worker 的公开 provider-request 钩子只改模型 ID，
触发实际 provider 503；最终助手、注册表、前台单次失败通知的错误全文必须一致。
该失败可能只发出 `agent_settled`，不能仅依赖 `prompt_error`。管理器经现有 Pi Web
`GET /api/sessions/{id}` 回读最终助手 stopReason/errorMessage。停止证据是产品桥
执行停止，不表示模型自主调用了 `code_agent_stop`。修复前的误报成功记录保留在
`real-model-code-agent-failure-before-fix-session.json`。

- 输入只发往丢弃式目标窗口；未截图、未落盘像素、未输入真实凭据。
- 令牌写在壳自己的数据目录（`0600`），不在环境变量里；桥只监听命名管道，无 TCP 端口。
- 未修改 pi-web 源码或 `node_modules`；pi-web 以固定 HEAD 快照 + 隔离 agent 目录 + 隔离 HOME 运行。
- 桌面授权**不持久化**：撤销、换工作区、退出、代次变更都会清除；重新加载会话不会恢复授权。
