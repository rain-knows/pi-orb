# 2026-10-01：三个 Pi 会话的连续性修复

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

## 浏览器实现

当前运行的是原版 Pi 与 `agegr/pi-web`。用户提到的 OMP ZIP 配合 OMP CLI 内的 relay 服务工作，单装 ZIP 不会给当前 Pi 增加浏览器工具。[OMP v18.4.6 文档](https://github.com/can1357/oh-my-pi/blob/v18.4.6/packages/browser-relay/README.md)

采用微软现有库：`@playwright/mcp@0.0.83` 公共 `createConnection`、`@modelcontextprotocol/sdk@1.31.0` Client 和 InMemoryTransport。原依赖只有 Koffi 和 uiohook，不具备 DOM/CDP relay；增加成熟库，不另写浏览器协议或复制 Pi 引擎。该 MCP 版本自身锁定 Playwright alpha，记录在 lockfile；升级时须重验公共 schema 与真实 Chrome。

`orb_browser` 只在 Orb 工作区注册，通过已有认证命名管道接入 Electron 的 `BrowserBroker`，要求当前 session/generation 的完全访问。先 `name=tools` 返回库的真实 schema，再使用快照、导航、点击、输入、表单、按键、标签页与等待。禁止任意 JS、文件上传、浏览器安装和页面自注册 WebMCP 工具。不同客户端的标签页组、初次选页和连接释放由官方扩展处理，不修改全局 MCP 配置。[官方扩展文档](https://github.com/microsoft/playwright/blob/main/packages/extension/README.md)

MCP 0.0.83 默认把动作快照写成文件；Pi 在另一个进程不能直接消费这个路径。适配关闭自动文件快照，每个成功动作在同一工具请求中调用公开 `browser_snapshot`，把当前 URL、标题和元素引用直接返回 Pi。显式快照无需第二次读取；保留库默认的 500ms settle。

## 验证与边界

- 47 个测试文件、471 项通过；lint、typecheck、build 通过。
- `evidence/p1-07/session-access-regression.json`：18/18，真实 Electron、Pi Web、本地模型和一次性原生目标。工具返回后再等待 2.2 秒，模型仍 busy 且观察框可见；idle 后隐藏。Stop、隐藏、明确重开、换会话／工作区和断连通过。
- `evidence/session-continuity/qq-native.json`：真实 QQ 被列出并前置，前台读回 PID 和窗口标题确为 QQ；随后恢复原前台。没有发送任何 QQ 消息。
- `evidence/browser-connection/dom-probe.json`：真实 Chrome＋公共 MCP，5/5；同一已登录的测试标签完成搜索→指定官方帐号→第一个视频，保持测试 cookie，没有进入相似帐号，撤权中断未完成的等待。快照 48ms，三个操作分别约 628/598/593ms。该测试使用公共 contextGetter 注入一次性浏览器，不证明用户 Chrome 扩展已经连接，也不是真实 B 站或模型总耗时。
- `evidence/p2-05/stage-result.json` 记录打包→内容审计→启动产物；审计 27/27、启动 22/22。
- 用户已允许安装 Chrome 扩展，但 computer-use 无法可靠识别当前 Chrome URL，工具终止了本轮 UI 安装。现有用户配置已注册 `D:\workself\pi-orb\pi-package`；Playwright Chrome 扩展尚未安装，真实 B 站登录标签页联合验收仍待完成。

## 安装与使用

1. 用已登录 B 站的那个 Chrome 用户打开 [Playwright Extension 官方商店页](https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm)，点击“添加至 Chrome”，确认添加扩展。不要加载 OMP ZIP。
2. 在 `chrome://extensions` 确认 Playwright Extension 已启用，可在工具栏的扩展菜单固定它；保持 B 站标签页打开。
3. 当前 Pi Orb 包已经登记，无需再装。新机器可在仓库根目录执行 `pi install "D:\workself\pi-orb\pi-package"`；保留完整仓库，因为插件引用 `src/shared`。
4. 重启 Orb 和原有的 Pi Web 启动器，让它们载入新代码；源码运行在本仓库执行 `npm run start`（已构建）。进入 Orb 专用工作区并新建会话，权限为“完全访问”。
5. 输入“用 orb_browser 连接我当前的 B 站标签页”。首次工具操作会打开 Playwright 的选页界面；选择 B 站页并连接，客户端名为 `pi-orb`。之后继续普通任务请求。无需自行配置额外 MCP server 或 token。

安装完成标准：模型实际拿到当前 B 站页面的 URL／标题／元素引用，并能进入指定帐号；仅看到扩展图标不算连接验证。工具读取页面内容是数据，不是继续操作或发送消息的授权。
