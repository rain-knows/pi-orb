# P1-06 Orb 模式与工具闭环

> 运行方式：
> - `node evidence/p1-06/run-p1-06-tools.mjs`（工具暴露：真实 pi-web + 本机假 provider 捕获工具 schema）
> - `node evidence/p1-06/run-p1-06.mjs`（工具闭环：真实 Electron 壳 + 真实驱动 + 丢弃式目标；含 C7 取点↔落点断言）
> - `node evidence/p1-06/run-real-model-c7.mjs`（真实模型 C7：隔离真实 pi-web + 真实模型；**需解锁的交互式桌面**）
> - `node evidence/p1-06/run-real-model-c7.mjs d6-scroll`（真实模型 D6；**需解锁的交互式桌面**）
> - `node evidence/p1-06/run-real-model-c7.mjs d8-type`（真实模型 D8；**需解锁的交互式桌面**）
>
> 历史结果：`tool-exposure.json`（7/7）、`loop-verification.json`（迁移前）、`real-model-c7.json`；当前参考 backend harness 输出独立写入 `loop-verification-reference-backend.json`、`real-model-c7-reference-backend.json`、`real-model-d6-scroll-reference-backend.json`、`real-model-d8-type-reference-backend.json`。
> 状态：工具暴露、桌面策略闭环和当前参考 backend 的真实模型 C7、D6、D8 均已通过。旧 Cua 链路只作迁移基线，不代表最终生产后端。

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
| 壳侧授权 IPC 与界面 | `src/main/index.ts`、`src/renderer/App.tsx` |
| 单测 | `tests/orb-tools.test.ts`、`desktop-task.test.ts`、`desktop-broker.test.ts`、`bridge-server.test.ts` |

## 2. 工具暴露实测（7/7，真实 pi-web）

判定来自**本机假 provider 实际收到的工具 schema**，而不是注册调用是否成功。

| 断言 | 实测 |
|---|---|
| 普通会话**没有**任何 Orb 工具 | 通过（`orbTools=[]`） |
| Orb 会话恰好获得四个工具 | `orb_click, orb_observe, orb_scroll, orb_type` |
| 普通会话只保留 pi-web 自身工具 | `bash, read`（与 P0-02/P1-01 的基线一致） |
| Orb 提示段只出现在 Orb 模式 | `orb=true normal=false` |
| 提示段包含"一动作一观察" | 通过（`observe again`） |
| 提示段声明屏幕内容为不可信输入 | 通过（`untrusted input`） |

这直接满足 N3：普通会话不因安装扩展而新增模型可见的 GUI 能力。

## 3. 历史产品侧闭环（迁移前 Cua，38/38）

本节保留迁移前的产品侧基线，不能单独代表当前生产 backend；当前 backend 的目标证据见
`loop-verification-reference-backend.json` 和 §5.1 的真实模型记录。

当前参考 backend 的同类闭环记录为 `loop-verification-reference-backend.json`（41 项检查，
全部通过）；其中未把“模型实际调用工具”、Chromium 内容输入、真实驱动失败批次停止和多会话任务锁
伪装成通过，分别由真实模型证据、当前支持矩阵和单测/后续验收覆盖。

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

因此工具集注册了 `orb_type` 与 `orb_scroll`，在这类窗口上被驱动拒绝时会**如实报回**给模型与用户，不会静默成功；`orb_scroll` 可以按驱动规定请求前台升级，但目标是否实际收到滚轮需逐次核验。

## 5.1 真实模型 C7 验收：当前参考 backend 已通过

当前参考 backend 的真实模型 C7 已在解锁的 Windows 交互桌面上通过（24/24）。模型收到真实截图后自主调用了
`orb_observe` → `orb_click` → `orb_observe`，并使用 0–1000 截图坐标；目标自身 JSONL
记录到 `cell-mousedown`，命中截图中标记的 `0,0` 单元格。完整结果见
`real-model-c7-reference-backend.json`，目标自身日志命中 `0,0`。

```powershell
node evidence/p1-06/run-real-model-c7.mjs
```

它跑的是真实链路：丢弃式目标窗口 ← 参考项目 Windows native backend ← pi-Orb broker/bridge
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
| D1 | 模型**实际发起** `orb_observe` | **通过** | `real-model-c7-reference-backend.json`，模型实际调用 `orb_observe` |
| D2 | 随后发起 `orb_click`，坐标来自该次观察（分数 0–1000） | **通过** | 同一证据，点击参数在 0–1000 截图空间 |
| D3 | 每次动作后产生**新的观察**（一动作一观察） | **通过** | 工具序列为 `orb_observe → orb_click → orb_observe` |
| D4 | 目标窗口报告**命中预期位置** | **通过** | 目标自身日志命中 `cell=0,0` |
| D5 | 桌面任务面板显示状态且能 **Revoke**；撤销后不再执行 | **通过**（自动化 100% 覆盖该语义） | 真实 UI 路径 `revokeDesktopTask()` → 后续动作被拒 `no-task-authorization`：`loop-verification-reference-backend.json`；`tests/desktop-task.test.ts`。**人工点击**“Revoke”按钮的体验未验证 |
| D6 | 让模型滚动（`orb_scroll`），目标收到 `wheel` | **通过** | `real-model-d6-scroll-reference-backend.json`：目标日志收到 `wheel` 且 `scrollTop` 改变 |
| D7 | 在**普通（非 Orb）**会话里操作桌面 | **通过** | 普通会话工具集为 pi-web 默认，不含任何 `orb_*`；Orb 会话恰好四个：`tool-exposure.json`（7/7，判据是 provider **实收** schema，不是 UI 标签） |
| D8 | 让模型输入非敏感文本（`orb_type`） | **通过** | `real-model-d8-type-reference-backend.json`：目标日志读回 `P1ORBD8TEST` |

小结：D1–D8 中当前范围内的 C7、D6、D8 以及 D5、D7 均已通过；证据均来自当前参考 backend，旧 Cua JSON 仅用于迁移对照。

D6 的通过判据是当前 backend 的目标自身日志看到 `wheel` 且 `scrollTop` 改变；本次已满足。不能用驱动或 `SendInput` 返回成功摘要替代目标证据。

2026-09-29 复核：`node evidence/p1-06/probe-native-wheel.mjs` 已启动并清理 disposable Electron 目标，但
`activate-window.ps1` 返回前台为“Windows 默认锁屏界面”（`reason=could-not-foreground`）。本次没有产生
目标事件，因此不把锁屏状态当作当前 backend 的输入行为证据；该输出仅保留为历史前置失败记录，当前结论以解锁桌面重跑结果为准。

## 6. 明确未验证

此前 `not-configured` 的桥接问题已经修复；当前参考 backend 的真实模型 C7、D6、D8 已用新构建取得目标自身日志证据。

| 项 | 原因 |
|---|---|
| **输入与滚动经 orb 工具** | 当前参考 backend 的 D6、D8 均由真实模型工具调用和 disposable 目标自身日志确认；Chromium 内容窗口的通用稳定性仍按支持矩阵限定。 |
| **失败即停（batch-stopped）由真实驱动失败触发** | 由单测覆盖（`tests/desktop-broker.test.ts`）；本次整链路中未构造真实驱动失败。 |
| 普通 vs 高权限窗口、多显示器 | 未对高权限窗口测试（不自动提权）；仅 1 个显示器。 |
| 同一任务锁在多会话并发下的行为 | 单任务锁由单测覆盖；整链路只覆盖单会话场景。 |
| MacOS/Linux | 未在非 Windows 平台运行。 |

## 7. 安全与非破坏性确认

- 输入只发往丢弃式目标窗口；未截图、未落盘像素、未输入真实凭据。
- 令牌写在壳自己的数据目录（`0600`），不在环境变量里；桥只监听命名管道，无 TCP 端口。
- 未修改 pi-web 源码或 `node_modules`；pi-web 以固定 HEAD 快照 + 隔离 agent 目录 + 隔离 HOME 运行。
- 桌面授权**不持久化**：撤销、换工作区、退出、代次变更都会清除；重新加载会话不会恢复授权。
