# P1-06 Orb 模式与工具闭环

> 运行方式：
> - `node evidence/p1-06/run-p1-06-tools.mjs`（工具暴露：真实 pi-web + 本机假 provider 捕获工具 schema）
> - `node evidence/p1-06/run-p1-06.mjs`（工具闭环：真实 Electron 壳 + 真实驱动 + 丢弃式目标；含 C7 取点↔落点断言）
> - `node evidence/p1-06/run-real-model-c7.mjs`（真实模型 C7：隔离真实 pi-web + 真实模型；**需解锁的交互式桌面**）
>
> 原始结果：`tool-exposure.json`（7/7）、`loop-verification.json`（**39/39**）、`real-model-c7.json`
> 状态：**工具暴露与桌面闭环通过**（含真实点击、前台滚动、C7 产品侧闭环）；**真实模型自主调用工具**与**向 Chromium 内容输入文本**未验证，见 §5.1 与 §6。

## 1. 交付内容

| 能力 | 位置 |
|---|---|
| 工具契约、限额、拒绝理由、模式提示段 | `src/shared/orb-tools.ts` |
| 任务授权与批次状态机（一动作一观察、失败即停） | `src/main/desktop-task.ts` |
| 桥协议（版本、令牌比较、浏览器来源识别） | `src/shared/bridge-protocol.ts` |
| 桥服务端（命名管道、准入规则、拒绝上抛） | `src/main/bridge-server.ts` |
| 桌面 broker（策略→驱动，行为唯一裁决点） | `src/main/desktop-broker.ts` |
| Cua 适配器（坐标换算、目标识别、观察消费） | `src/main/cua-adapter.ts` |
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

## 3. 工具闭环实测（38/38，真实链路）

被测链路是产品自己的代码，不是模拟：

```
丢弃式 Electron 目标（自报收到的事件）
  ↑ 锁定的 Cua 驱动（真实后台点击）
  ↑ src/main/cua-adapter.ts
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
| 滚动 → Chromium 内容（**前台升级**） | **可用**（P1-05 实测目标记录到真实 `wheel` 且滚动条实际位移） |
| 文本输入 → Chromium 内容 | 驱动拒绝（后台投递不支持该窗口类）；前台升级尚未做到稳定投递 |
| 元素寻址 | Chromium 内容不暴露可编辑元素，因此坐标是唯一可行寻址方式 |

因此工具集注册了 `orb_type` 与 `orb_scroll`，在这类窗口上被驱动拒绝时会**如实报回**给模型与用户，不会静默成功；`orb_scroll` 能够按驱动规定升级到前台并生效。

## 5.1 真实模型 C7 验收：入口已就绪，当前被「工作站已锁定」阻断

自动化已验证**产品侧**的 C7：模型读图得到的那一点，与产品最终点击的那一点是同一个点
（§3.4，本轮新增断言，`landedCell=1,2`，分数 `(611.6,360.4)`）。
自动化**无法**验证**模型侧**：真实模型拿到真实截图后，是否自己决定调用 `orb_observe`、
再用截图上读出的分数调用 `orb_click`。为此新增了一个可重复执行的入口：

```powershell
node evidence/p1-06/run-real-model-c7.mjs
```

它跑的是真实链路：丢弃式目标窗口 ← 锁定的 Cua 驱动 ← pi-Orb adapter/broker/bridge
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

**当前阻断原因（环境，不是产品）**：

```
foreground is LockApp and the input desktop is not accessible.
The workstation appears to be locked; unlock it and re-run. Nothing was sent to any model.
```

连续 3 次探测一致：前台进程是 `LockApp`，`OpenInputDesktop` 失败。锁屏下**任何窗口都无法被前置**，
因此反射式唤醒路径无法把丢弃式目标窗口记为“用户正在看的窗口”，截图授权链在第一步就断掉。
这一项**必须**在解锁的交互式桌面下才能有结论。

**锁屏下仍已取得的真实证据（10/11 项前置通过，未消耗额度）**：

| 检查 | 结果 | 证据 |
|---|---|---|
| 隔离 pi-web 启动 | 通过 | `http://127.0.0.1:31502` |
| 隔离浮窗写出自己的握手指令 | 通过 | `pid` 与正在运行的 30620 **不同** |
| 命名管道可连接 | 通过 | `\\.\pipe\pi-orb-<隔离 pid>` |
| 隔离浮窗不是用户正在运行的那个 | 通过 | `handshake.pid !== 30620` |
| CDP 可驱动 Orb 渲染层 | 通过 | `pi-Orb` / `out/renderer/index.html` |
| 唤醒快捷键注册 | 通过 | `Control+Alt+F11`，`shortcutProblem` 为空 |
| 真实 pi-web 会话已创建 | 通过 | 会话 id `01a0e6fe-…` |
| **会话所用模型声明支持图像** | 通过 | `TZcode/deepseek-v4.1-flash`，`input=["text","image"]` |
| 驱动列出丢弃式目标（按 pid） | 通过 | `P1-05 input target` |
| 交互式桌面可用 | **失败** | `LockApp` 在前台，输入桌面不可访问 |

即：**除“需要真实前台”这一步，D 组的链路与模型配置已全部就绪**，而这一步正是锁屏阻断的。

值得记下的一处产品观感问题（未改，先记录）：锁屏时产品报的是
「The recorded window was replaced by a different one (now "Windows 默认锁屏界面")」，
这对用户是**误导**——真实原因是“当前根本无法前置任何窗口”。harness 现在加了前置探测，
把这个环境原因直接报出来，避免把它误判成产品缺陷。

**本次未消耗任何模型额度**：前置探测在发送任何消息前就中止了。

### D 组逐项结论（task-4）

下表只给结论，不把未验证当通过。两列分开写，因为“自动化已证明的部分”与“真实模型侧”不是同一件事：

- **结果（真实模型侧）** — 五种标签之一：`通过` / `失败` / `未验证` / `驱动报成功但目标未收到` / `不适用`。
- **自动化已证明的部分** — 与该项有关、但**不能代表**真实模型侧的那一半。

| # | 项 | 结果（真实模型侧） | 自动化已证明的部分 + 判据来源 |
|---|---|---|---|
| D1 | 模型**实际发起** `orb_observe` | **未验证**：真实模型入口已就绪且除“需真实前台”外的前置已全部实测通过，但当前被工作站锁定阻断。历史上（2026-09-28）模型确实自主发起过两次 `orb_observe`，当时的 `not-configured` 已修复，但修复后未再取得结论，故**不计为通过** | 工具已注册且 provider 实收 schema：`tool-exposure.json`（7/7）。会话所用模型声明图像输入：`real-model-c7.json`（`input=["text","image"]`） |
| D2 | 随后发起 `orb_click`，坐标来自该次观察（分数 0–1000） | **未验证**：同上。历史尝试中模型确实发起过 `orb_click`，且被 `no-task-authorization` **正确拒绝**（安全拒绝，不是缺陷），不能作为通过 | 分数寻址的映射已单测：`tests/coordinate-mapping.test.ts`；同一观察被重放会被拒 |
| D3 | 每次动作后产生**新的观察**（一动作一观察） | **未验证**（模型是否遵守）。产品侧**强制执行**：重放同一观察被拒（`observation-unknown`/`stale-observation`），且动作结果文本要求 re-observe | `evidence/p1-06/loop-verification.json`；`tests/desktop-broker.test.ts` |
| D4 | 目标窗口报告**命中预期位置** | **未验证**（由模型选点的那一次）。请注意：产品侧的“取点↔落点一致”已通过，但取点的是测试、不是模型 | C7 断言：取分数 `(611.6,360.4)` → 目标自身 JSONL `cell-mousedown` `cell=1,2`，格内偏移 `(58,43)` 对格心 `(60,45)`：`loop-verification.json`（39/39） |
| D5 | 桌面任务面板显示状态且能 **Revoke**；撤销后不再执行 | **通过**（自动化 100% 覆盖该语义） | 真实 UI 路径 `revokeDesktopTask()` → 后续动作被拒 `no-task-authorization`：`loop-verification.json`；`tests/desktop-task.test.ts`。**人工点击**“Revoke”按钮的体验未验证 |
| D6 | 让模型滚动（`orb_scroll`），目标收到 `wheel` | **未验证**：经 orb 工具路径的滚动在隔离闭环中被 broker 接受，但该次运行 Windows 未授予前台，目标**零个** `wheel` 事件，故不得计为通过 | **真机已定论的部分**（P1-05 直调驱动）：前台升级后目标自身日志记录真实 `wheel`、`overScroller:true`、`scrollTop` 实际位移：`evidence/p1-05/input-verification.json` |
| D7 | 在**普通（非 Orb）**会话里操作桌面 | **通过** | 普通会话工具集为 pi-web 默认，不含任何 `orb_*`；Orb 会话恰好四个：`tool-exposure.json`（7/7，判据是 provider **实收** schema，不是 UI 标签） |
| D8 | 让模型输入非敏感文本（`orb_type`） | **未验证**（经 orb 工具路径、由模型发起的那一次） | **原生文本框已通过**（P1-05 直调驱动）：向临时记事本投递并由读回文档证实（`P1ORBTYPED`）：`evidence/p1-05/input-verification.json`。**Chromium/Electron 内容投递不可用**（后台被拒，前台未做到稳定投递）—— 见 `evidence/p1-05/README.md` §4 |

小结：D5、D7 自动化已定论；D3 的**规则**、D4 的**产品侧**已定论，但模型侧仍未验证；D1、D2、D6、D8 的模型侧均**未验证**，其中 D6 的那次运行属于“驱动报成功但目标未收到”，按规则不计为通过。

任何一项要变成 `通过`，都需在**解锁的交互式桌面**下重跑 `evidence/p1-06/run-real-model-c7.mjs`（或按 `doc/manual-acceptance.md` §5/§6 手工执行）。

## 6. 明确未验证

2026-09-28 的首次真实模型尝试中，模型确实自主调用了 `orb_observe`（省略和指定
`window_id` 各一次），但都收到 `Refused (not-configured): No Orb bridge pipe is known`。
这证明了“模型决定调用”的连接点，**没有**证明观察或点击成功；C7 和 D2–D8 仍待复测。
根因是扩展已读到包含 `pipePath` 的握手文件，却在 `BridgeClient.call` 时只传 token。
现已改为传递完整握手对象，并用“无环境变量、仅握手文件”命名管道测试防止回归。
pi-web 与 Orb 已重启；只读探针得到 `hello.ok=true` 和无效会话的 `unknown-session`。

| 项 | 原因 |
|---|---|
| **模型真正调用 orb 工具** | 本环境无模型在环时无法验证；现已有真实模型入口 `evidence/p1-06/run-real-model-c7.mjs`（隔离真实 pi-web + 真实模型），但**当前工作站已锁定**（`LockApp` 在前台、输入桌面不可访问），唤醒路径无法前置丢弃式目标，故本次未取得结论，也未消耗模型额度。解锁后重跑即可。 |
| **输入与滚动经 orb 工具** | **滚动已实测**（P1-05 前台升级到达并生效；本阶段闭环接受该调用）；**向 Chromium 内容输入文本**仍未验证（驱动对该事件类型不可用）。 |
| **失败即停（batch-stopped）由真实驱动失败触发** | 由单测覆盖（`tests/desktop-broker.test.ts`）；本次整链路中未构造真实驱动失败。 |
| 普通 vs 高权限窗口、多显示器 | 未对高权限窗口测试（不自动提权）；仅 1 个显示器。 |
| 同一任务锁在多会话并发下的行为 | 单任务锁由单测覆盖；整链路只覆盖单会话场景。 |
| MacOS/Linux | 未在非 Windows 平台运行。 |

## 7. 安全与非破坏性确认

- 输入只发往丢弃式目标窗口；未截图、未落盘像素、未输入真实凭据。
- 令牌写在壳自己的数据目录（`0600`），不在环境变量里；桥只监听命名管道，无 TCP 端口。
- 未修改 pi-web 源码或 `node_modules`；pi-web 以固定 HEAD 快照 + 隔离 agent 目录 + 隔离 HOME 运行。
- 桌面授权**不持久化**：撤销、换工作区、退出、代次变更都会清除；重新加载会话不会恢复授权。
