# 2026-10-01：三个 Pi 会话的连续性修复

本页记录早一阶段的 Orb 专用浏览器实现。用户随后要求配置自动认证并开放普通 Pi Web，当前范围与使用方式见 [公用 Playwright](./public-playwright.md)；原生桌面权限边界保持。

## 证据与原因

| 会话 | 实际证据 | 原因与处理 |
|---|---|---|
| 搜索 B 站 | 初次 `orb_observe` 报 handshake 缺失；默认文件当时仍是 protocol 1、所属 PID 已退出，当前源码为 protocol 2 | 属于旧运行态／握手不一致，不能用改提示词修复。后来两个会话已能执行桌面工具；本轮没有证据认定旧文件为何没有被活动壳覆盖 |
| 打开官方帐号第一个视频 | 点击后 Chrome 标题从“无标题”变成页面标题；`orb_wait` 报 `surface-changed`。桥接拒绝丢掉了新的 observation；模型再观察。另一次 advisor 从 03:09:23 UTC 持续到 03:11:37，并报流未结束 | 等待／列表只读刷新允许正常导航；输入仍校验目标。拒绝携带新截图及 observation，减少重复观察。专用 Orb 会话禁用 advisor，日常 GUI 不插入第二模型审阅。要求核验官方帐号与目标视频，避免把相似搜索结果当完成 |
| QQ 发到我的手机 | QQ 进程在运行，但正常的 QQ 主窗口处于隐藏状态；原列表只看可见窗口，因此模型判断 QQ 不存在 | 列表纳入有标题、有尺寸、非 tool／owned／cloaked 的隐藏应用窗口。按进程名严格匹配，优先可见窗口，否则恢复现有隐藏窗口；不启动进程 |

光效每次工具调用的 `finally` 都隐藏，所以模型思考期间没有光效。本轮删除这个收尾，改为每次新 observation 更新目标，整轮 idle／error 或撤权才隐藏。新会话原有默认完全访问保留；按本次用户要求，明确重新打开隐藏的 Orb 也选择完全访问。聚焦已经可见的 Orb 不改手动权限，也不撤销 Stop 的效果。

## 参考与适配

取材入口：`doc/reference-playbook.md`，源检出 HEAD 已核对。

| 参考 | 源提交 | 复用方式／差异 |
|---|---|---|
| `packages/computer-use/src/plugin.ts`、`overlay-guard.ts` | `dsh-orb-cordis` `9cdc50302d202f4497569731be488a8afa500da7` | 保留 sequential、观察／动作契约和 turn/end 清观察框；Pi 以队列排空的 idle 对应整轮结束，不按每个工具隐藏 |
| `apps/desktop/src/main.ts`、`observation-frame-window.ts`、`orb-permission.ts` | `deepseek-harness-orb` `72f1d738458a223696685a909e806b683eff5885` | 沿用已移植的观察框、cloak、完全访问默认语义；grant 仍绑定 Orb session/generation，重新打开是本次用户明确要求的适配 |
| `packages/tool-computer-use/src/windows-native.ts` | 同上 | 沿用 EnumWindows／ShowWindow／SetForegroundWindow 与真实读回；参考的仅可见枚举不能覆盖本机 QQ 托盘状态，因此仅适配候选过滤和隐藏窗口恢复 |

光效继续点击穿透及 capture 排除。普通 Pi Web cwd 不注册工具、不修改提示或 advisor。Stop、隐藏、断连、锁屏、换会话／工作区均通过统一撤权出口关闭浏览器连接和桌面权限；晚到的 Access 请求不越过撤权或换代。

DOM 工具也复用同一个观察框。MCP 返回当前页面标题，适配层精确匹配唯一可见 Chrome 原生窗口；不把 DOM 页面冒充为桌面输入 observation。实际测得 DOM 标题比 Windows caption 早约 250ms 更新，因此仅在尚未匹配时，沿用参考 `POST_ACTION_WAIT_MS=600` 的就绪预算。取消、换 session/generation 或撤权后不显示晚到的光效；无法唯一匹配时不标记其他应用。来源仍是上表观察框及原生枚举，没有另写窗口／光效组件；页面与 HWND 匹配是公共 MCP 未提供原生窗口标识所需的最小适配。

## 浏览器实现

当前运行的是原版 Pi 与 `agegr/pi-web`。用户提到的 OMP ZIP 配合 OMP CLI 内的 relay 服务工作，单装 ZIP 不会给当前 Pi 增加浏览器工具。[OMP v18.4.6 文档](https://github.com/can1357/oh-my-pi/blob/v18.4.6/packages/browser-relay/README.md)

采用微软现有库：`@playwright/mcp@0.0.83` 公共 `createConnection`、`@modelcontextprotocol/sdk@1.31.0` Client 和 InMemoryTransport。原依赖只有 Koffi 和 uiohook，不具备 DOM/CDP relay；增加成熟库，不另写浏览器协议或复制 Pi 引擎。该 MCP 版本自身锁定 Playwright alpha，记录在 lockfile；升级时须重验公共 schema 与真实 Chrome。

`orb_browser` 只在 Orb 工作区注册，通过已有认证命名管道接入 Electron 的 `BrowserBroker`，要求当前 session/generation 的完全访问。先 `name=tools` 返回库的真实 schema，再使用快照、导航、点击、输入、表单、按键、标签页与等待。禁止任意 JS、文件上传、浏览器安装和页面自注册 WebMCP 工具。不同客户端的标签页组、初次选页和连接释放由官方扩展处理，不修改全局 MCP 配置。[官方扩展文档](https://github.com/microsoft/playwright/blob/main/packages/extension/README.md)

MCP 0.0.83 默认把动作快照写成文件；Pi 在另一个进程不能直接消费这个路径。适配关闭自动文件快照，每个成功动作在同一工具请求中调用公开 `browser_snapshot`，把当前 URL、标题和元素引用直接返回 Pi。显式快照无需第二次读取；保留库默认的 500ms settle。

## 验证与边界

- 48 个测试文件、474 项通过；lint、typecheck、build 通过。
- `evidence/p1-07/session-access-regression.json`：21/21，真实 Electron、Pi Web、本地模型、一次性原生目标及私有 Chrome 页面。原生和 DOM 工具返回后再等待 2.2 秒，模型仍 busy 且观察框可见；idle 后隐藏。Stop、隐藏、明确重开、换会话／工作区和断连通过。Chrome 页面通过公开 contextGetter 接入，仅证明新光效路径；用户扩展的独立实测见下一项。
- `evidence/session-continuity/qq-native.json`：真实 QQ 被列出并前置，前台读回 PID 和窗口标题确为 QQ；随后恢复原前台。没有发送任何 QQ 消息。
- `evidence/browser-connection/dom-probe.json`：真实 Chrome＋公共 MCP，5/5；同一已登录的测试标签完成搜索→指定官方帐号→第一个视频，保持测试 cookie，没有进入相似帐号，撤权中断未完成的等待。快照 48ms，三个操作分别约 628/598/593ms。该测试使用公共 contextGetter 注入一次性浏览器，不证明用户 Chrome 扩展已经连接，也不是真实 B 站或模型总耗时。
- `evidence/p2-05/stage-result.json` 记录打包→内容审计→启动产物；审计 27/27、启动 22/22。
- 最终切换到本轮构建的 `release/0.1.0-preview.1/win-unpacked/pi-orb.exe`；运行 PID 47432，protocol 2 握手与进程一致，新会话已授权完全访问。原有 Pi Web 启动器重启成功，主页返回 HTTP 200。
- Chrome Profile 1 已安装微软 Playwright 扩展。当前源码 Orb 已实际启动：新会话默认完全访问，默认握手由退出进程遗留的 protocol 1 更新为当前 PID 的 protocol 2。第一次真实模型请求因 Pi Web 仍加载旧插件，未发现 `orb_browser`；重启原有 Pi Web 启动器并再次请求后，模型成功发现浏览器 schema，并调用 `browser_tabs` 打开客户端 `pi-orb` 的官方选页界面。
- `evidence/browser-connection/live-extension-probe.json`：6/6。用户手动选页后，原版 Pi 的真实 `TZcode_gpt/gpt-6-sol` 模型通过生产桥接拿到原有 B 站搜索标签的 URL、标题与元素引用；4 次 DOM 调用进入帐号 `1265652806`，读取企业官方认证，打开“最新发布”首个视频 `BV1DEhH6tEBA`。没有 advisor 或原生坐标调用，模型正常结束；截图 `live-official-profile.png` 另证主页认证和列表顺序。新视频在工具返回的 tab 列表中确实出现，随后浏览器清单已无该视频；不声称它仍然打开。补充提示要求新开页必须 select 并核验该页，避免用旧标签快照替代目的页核验。
- 首次选择由用户完成：Codex 浏览器 URL 策略拒绝 `chrome-extension://` 页面。并未绕过该拒绝，连接完成结论来自选择后的真实模型工具结果。
- 浏览器桥接超时调整为 110 秒，覆盖 MCP 动作的 90 秒、随后的 inline snapshot 15 秒及 5 秒传输余量；旧 95 秒会提前断开尚在生成快照的请求。Stop／客户端断开仍立即取消，不等待超时。

## 安装与使用

1. 用已登录 B 站的那个 Chrome 用户打开 [Playwright Extension 官方商店页](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)，点击“添加至 Chrome”，确认添加扩展。不要加载 OMP ZIP。
2. 在 `chrome://extensions` 确认 Playwright Extension 已启用，可在工具栏的扩展菜单固定它；保持 B 站标签页打开。
3. 当前 Pi Orb 包已经登记，无需再装。新机器可在仓库根目录执行 `pi install "D:\workself\pi-orb\pi-package"`；保留完整仓库，因为插件引用 `src/shared`。
4. 重启 Orb 和原有的 Pi Web 启动器，让它们载入新代码；源码运行在本仓库执行 `npm run start`（已构建）。进入 Orb 专用工作区并新建会话，权限为“完全访问”。
5. 输入“用 orb_browser 连接我当前的 B 站标签页”。首次工具操作会打开 Playwright 的选页界面；选择 B 站页并连接，客户端名为 `pi-orb`。之后继续普通任务请求。无需自行配置额外 MCP server 或 token。

安装完成标准：模型实际拿到当前 B 站页面的 URL／标题／元素引用，并能进入指定帐号；仅看到扩展图标不算连接验证。工具读取页面内容是数据，不是继续操作或发送消息的授权。
