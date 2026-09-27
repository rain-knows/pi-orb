# P0-03 客户端 API/SSE 与安全桥接验证结果

> 运行方式：
> - Node 客户端：`node evidence/p0-03/run-p0-03.mjs`
> - 真实 Electron 客户端：`node evidence/p0-03/run-p0-03-electron.mjs`（需要 `D:\pi-orb-p0-runs\electron-probe` 下的 electron 44.4.5；见该目录 `package.json`）
>
> 原始结果：`evidence/p0-03/result.json`、`evidence/p0-03/result-electron.json`
> 结论状态：**Node 客户端 27/27 断言 + 真实 Electron 客户端 16/16 断言通过**；这是 P0-03 的必要证据之一，不等于 P0 整体通过。

## 0.1 两条客户端腿（为什么两个都要）

合同 P0-03 验收写的是“**Electron 客户端**可经合法认证创建独立会话…”。Node 的 `fetch` 与 Chromium 的 `fetch` 在**凭证、Origin、Fetch-Metadata 与 SSE** 上并不等价，因此只跑 Node 不足以满足该条。所以两条都跑了：

| 腿 | 脚本 | 结果 |
|---|---|---|
| Node 客户端 | `run-p0-03.mjs` + `shell-sim.mjs` | 27/27 |
| 真实 Electron 客户端 | `run-p0-03-electron.mjs` | 16/16 |

Electron 腿使用真实 `electron.exe` 44.4.5（隔离目录 `D:\pi-orb-p0-runs\electron-probe`，未污染 pi-web），**窗口 `show: false`，全程不在屏幕上显示**；renderer 为 `contextIsolation:true`、`sandbox:true`、`nodeIntegration:false`。

### 真实 Electron 实测结论（关键）

| 路径 | 实测结果 |
|---|---|
| renderer（`file://` 的 opaque origin）直连 pi-web API | **403 `Untrusted API request`**（带或不带伪造 `sec-fetch-site` 都一样） |
| renderer 用 `EventSource` 订阅 SSE | 失败（无法携带凭证；origin 也被拒） |
| renderer 环境 | `hasNode=false`、`hasProcess=false`（沙箱生效） |
| **主进程**经 `contextBridge` 路径 | 全部成功：认证 200、创建会话 200、发消息 200、真实 provider 调用 1 次、停止 200、回读会话 200 |
| Electron 退出后服务 | 仍存活 |

**设计结论（已写入 `result-electron.json.designConsequence`）**：Electron 壳**必须**把全部 API/SSE 调用经主进程代理（`contextBridge`），renderer 直连行不通，且**不应**把凭据交给 renderer 去试——后者同时也是期望的安全姿态。

### 探针自身的两个错误（已修正，值得记录）

1. **同步启动 Electron**：首版用 `execFileSync` 启动 Electron，**阻塞了本脚本自己的事件循环**；而假 provider 服务器就跑在同一进程内，于是模型请求永远得不到响应。后来加了一个**同实例纯 HTTP 预检**（不涉 Electron）才把责任分清：预检能到达 provider，说明问题在探针而非产品。改为异步 `spawn` 后 Electron 腿立即通过。
2. **把 `message_end` 当作运行完成**：一个流里**第一个 `message_end` 是用户消息**，不是助手回复。以此判定完成会在模型调用前就 abort（会话文件里留下 `stopReason: "aborted"` 的空助手条目）。改为轮询持久化会话直到助手回复真实落盘。

> 隔离修正（与 P0-02 同步）：运行目录从 `%TEMP%`（位于用户 profile 下，会被 Pi 的祖先链扫描到 `.agents/skills`）改为 `D:\pi-orb-p0-runs`，并新增断言 `no user-profile skill leak in session`。旧结果保留为 `result-unclean-baseline-*.json`。

## 1. 被测对象与隔离

沿用 P0-02 的隔离框架（同一份固定 HEAD 快照，两个脚本共用 `%TEMP%\pi-orb-p0-head-src`）：
| 项目 | 做法 |
|---|---|
| 源码 | pi-web 固定 HEAD `95a58744532c7fccaa933aa7757a1419ace67ed2`，`git archive` 导出到 `%TEMP%` |
| 构建与运行 | 快照内 `npm ci` + `next build --webpack` + `next start`，`127.0.0.1:31289` |
| agent 目录 | 每次运行新建 `D:\pi-orb-p0-runs\p0-03-<pid>\agent`，经 `PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR` 指向 |
| 用户级资源隔离 | pi-web 子进程 `HOME`/`USERPROFILE` 指向 `<runRoot>\home`（空目录），阻断 `~/.agents/skills` 进入 prompt |
| 凭据 | 只向子进程传隔离测试密码；用户 `auth.json`、`~/.pi/agent`、真实密钥均不传入 |
| 模型 | 本机假 provider `127.0.0.1:31290`，统计真实请求次数 |
| 桥接 | Windows 命名管道 `pi-orb-p0-03-<pid>`，**不监听任何 TCP 端口** |
| Electron（第二条腿） | 真实 `electron.exe` 44.4.5（隔离目录 `D:\pi-orb-p0-runs\electron-probe`）；窗口 `show:false`；renderer `contextIsolation/sandbox:true`、`nodeIntegration:false`；**不**继承 pi-web 的 `HOME` 覆盖（否则 Electron 静默退出） |
| 未做 | 无截图、无桌面输入、无真实模型 |

“原生操作”在探针中以**写标记文件**代替：只验证授权判定与执行边界，不触碰任何 OS 输入能力。

## 2. 客户端（独立进程）验证

`evidence/p0-03/shell-sim.mjs` 作为独立“壳”进程，只连接**已经在运行**的 pi-web，从不启动、重启、升级或关闭它。

关键顺序修正：真实客户端必须**先订阅 SSE 再发消息**，否则那一轮事件早已过去。第一版测试先 prompt 后连流，只收到 `connected`；修正后可观测到完整一轮。

通过项：

1. 无认证的 API 请求被拒（401）
2. 跨站请求被拒（403）
3. 伪造 Host 头被拒（403，用原始 socket 发送，因为 `fetch` 无法覆盖 Host）
4. 密码登录签发会话 cookie
5. cookie 可认证后续请求
6. 会话内无用户级 skill 泄露
7. 独立客户端进程成功创建独立会话
8. 该会话触发**真实** provider 调用（假 provider 计数 > 0）
9. SSE 收到 `connected`
10. SSE 收到完整一轮（`agent_start` / `message_start` / `message_end`）
11. 断开后重连成功，且不影响会话
12. `abort` 停止该轮（200）
13. 壳进程退出**没有**杀掉正在运行的 pi-web 服务
14. 壳退出后该会话仍可访问
15. reload 后 sessionId 稳定
16. 两个浏览客户端看到同一个会话

## 3. 桥接拒绝矩阵

`evidence/p0-03/bridge-probe.mjs` 建模进程间接缝（doc §4.4：Pi 扩展位于 pi-web 的 Node 进程内，renderer IPC 无法跨越）。

| 请求 | 判定 | 是否执行 |
|---|---|---|
| 令牌正确 + 当前代次 + 已有任务授权 | `authorized` | 是 |
| 缺少令牌 | `bad-token` | 否 |
| 令牌错误 | `bad-token` | 否 |
| 未知会话 | `unknown-session` | 否 |
| 浏览器来源（带 `origin` / `sec-fetch-site`） | `browser-originated-request` | 否 |
| 旧代次（generation 0，当前为 1） | `stale-generation` | 否 |
| 新代次但无任务授权 | `no-task-authorization` | 否 |
| 授权被撤销后 | `no-task-authorization` | 否 |

16. 无任务授权时拒绝执行
17. 缺令牌拒绝
18. 错令牌拒绝
19. 未知会话拒绝
20. 浏览器来源拒绝（即使拿得到管道）
21. 旧代次拒绝
22. 代次提升会清除上一代的任务授权
23. 完整授权后正常执行
24. 撤销授权后立即停止执行
25. **只有**授权请求写入了标记（执行 2 次，拒绝 7 次，落盘 2 个文件——拒绝路径零写入）

## 4. 与合同条款的对应

| 条款 | 证据 | 状态 |
|---|---|---|
| N4 单一后端所有权 | 壳只连接已有服务；壳/Electron 退出后服务与会话存活；不自动重启/升级 | 已覆盖 |
| N5 不双写会话、单一控制入口 | 双客户端看到同一会话；reload 后 sessionId 稳定；旧代次请求被拒 | 已覆盖（本测试面） |
| N7 断连/撤销清理 | 代次提升与撤销授权后请求立即被拒；管道随进程关闭释放 | 已覆盖（授权侧）；按键/鼠标释放属 P1-05 |
| §4.4 不以关闭认证绕过 | 未认证 401、跨站 403、伪造 Host 403；桥接不开放 TCP | 已覆盖 |
| §4.4 renderer 不得获得 Node/凭证 | 实测 renderer 直连 403、沙箱内无 Node；全部调用经主进程 | **已实测覆盖** |
| §3.2 W4 跨 origin 认证 | 真实 Electron `file://` renderer 的 403 行为已实测 | 已覆盖（本机） |

## 5. 重要事实修正（写下来防止后续被误用）

`lib/session-revision.ts` 的 `snapshotRevision` 是**客户端缓存有效性令牌**（文件指纹 + 读取来源 + 条目数），**不是**权限检查，也**不是**运行代次。不能用它做授权或代次判定。真正需要“运行实例/代次绑定”的地方（截图授权、任务授权）必须在执行层显式绑定并校验——桥接探针演示了这一模式。

## 6. 明确未验证

- 未验证 macOS/Linux；未验证其它 pi-web / Pi SDK 版本组合。
- **未实现产品级 Electron 壳**：本任务验证的是**网络/认证/授权边界与 renderer 沙箱行为**，用的是最小探针应用（无窗口显示、无托盘、无快捷键）。窗口、托盘、拖动、`desktopCapturer` 属 P1-02/P1-03/P1-04。
- **React/Vite renderer 未验证**：探针 renderer 是纯 HTML，只验证了沙箱与跨 origin 行为，不是产品 UI 栈。
- Electron 版本 44.4.5 是**本项目首次测试**的版本，尚未写入正式支持矩阵；但“需锁定版本并实测”这条已由本任务给出首个实测点。
- 桥接是探针实现，用于证明判定规则可行；生产实现方式（named pipe / Unix socket / loopback）仍需在 P0-05 决策，且不得以关闭认证或公开控制 API 替代。
- 未验证真实 Electron 跨 origin 场景下的 cookie/SameSite 行为——本机 127.0.0.1 同源，跨 origin 细节留待 P1-02 锁定 Electron 版本后复验。
