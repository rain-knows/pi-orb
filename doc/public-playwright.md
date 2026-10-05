# 公用 Playwright 与扩展认证（已废弃）

> 本页只保留历史证据。当前产品已删除 Playwright/MCP 浏览器网关和扩展认证，使用参考项目
> 的 `open_in_browser` 与截图式 Computer Use 工具；实现依据见 `reference-toolset-transition.md`。
> 下文全部为已删除实现的历史调查，不得按其中的 `orb_browser`、MCP 或普通工作区开放规则操作当前版本。

2026-10-01 用户明确要求配置扩展 token，并将浏览器工具开放给普通 Pi Web。这个要求覆盖先前“普通 cwd 无任何 GUI 工具”的范围约束；原生桌面工具仍只在 Orb 工作区注册。

`orb_browser` 现为一个公用工具，标签为“Playwright 浏览器”。普通 Pi/Pi Web 直接使用现有 `BrowserBroker` 与微软公共 MCP API，不要求 Electron；活跃壳的 Orb 会话固定通过命名管道访问壳层，撤权时不会转到公用路径。握手记录 `orbSessionId`，按会话身份选择入口而非 cwd，因此普通 Pi Web 可以和 Orb 共用 `daily`。壳在初次授权、新会话及换代时发布身份，Stop 保留该身份以阻止绕过撤权。两种入口共用命令白名单、动作后 inline snapshot、取消和连接释放实现，不另写 relay。

来源：`doc/reference-playbook.md` §1.2、§8，Cordis `9cdc50302d202f4497569731be488a8afa500da7` 的 `packages/computer-use/src/plugin.ts` 生命周期及 sequential 语义；既有 Electron 观察框保持来自旧单体 `72f1d738458a223696685a909e806b683eff5885`。参考没有 Pi Web 公用 DOM 工具或微软扩展认证，这两项是用户明确要求的宿主适配。仅抽出既有浏览器工具，复用微软 `@playwright/mcp@0.0.83`；不修改 Pi/Pi Web 引擎及模型凭据。

认证保存在当前用户的 `~/.pi/agent/playwright-extension.json`，仅包含扩展 token 与 Chrome profile 目录名；不会进入仓库、打包产物、工具结果或 Orb renderer。`BrowserBroker` 在每次创建连接前读取文件并设置微软的 `PLAYWRIGHT_MCP_EXTENSION_TOKEN` 和 `PLAYWRIGHT_MCP_PROFILE_DIR_NAME`，不依赖旧终端/Explorer 的继承环境。JSON 无效时明确报错，未配置时使用微软原有手动授权流程。

普通会话的浏览器连接按 Pi session 隔离，换 session/shutdown 释放，AbortSignal 取消当前请求并关闭连接。Orb 保留完全访问检查、Stop/隐藏/断连撤权和观察光效。浏览器页面内容是数据，发送消息等操作仍须来自用户请求。

使用：在 Pi Web 或 Orb 中要求“用 orb_browser 操作当前网页”。先 `name=tools` 发现 schema，再调用 `browser_navigate`、`browser_snapshot`、`browser_click`、`browser_tabs` 等。配置匹配的 token 后无需逐次点 Allow；安装新的 MCP/CLI 不在本次变更范围内。

验证：

- 50 个测试文件、478 项通过，typecheck/lint 通过。公用工具测试覆盖同 cwd 的普通会话走直接 MCP、Orb 会话撤权后仍走桥接拒绝；认证错误会移除 token 字符串。
- `evidence/browser-connection/token-probe.json` 3/3：当前用户 Chrome Profile 1，真实官方扩展、生产 `BrowserBroker`，不手动点 Allow。初次导航 1592ms，断开后新 relay 导航 526ms；DOM 点击与 inline 快照通过。
- `evidence/browser-connection/public-model-probe.json` 3/3：真实 Pi Web 模型在 `D:/workself/pi-orb`，用户 Orb 壳未运行时完成 schema→导航→DOM 点击，并正常结束。导航 1137ms，点击 606ms；这是工具耗时，不是模型整轮耗时。
- `evidence/browser-connection/same-directory-model-probe.json` 3/3：最新 Pi Web 与打包 Orb 同时运行，普通会话 cwd 同为 `D:/workself/daily`，session 与握手 owner 不同，真实模型直接完成导航 929ms、点击 633ms；没有原生桌面或 advisor 调用。
- `evidence/browser-connection/orb-token-probe.json` 2/2：打包产物运行 PID 52308，握手 owner 与完全访问 grant 一致；生产命名管道在 1059ms 内自动连接并返回真实 Chrome 验证页。
- P1-07 生命周期 21/21：本轮前两次在一次性原生目标的前置步骤中断；增加仅测试诊断输出后重跑通过，保留前台真实读回与全部检查，没有跳过。DOM/原生光效和 Stop/隐藏/换 session/换代/断连均通过。
- P2-05：构建打包通过、内容审计 27/27、启动产物 22/22。扩展认证文件未进入 git diff 或主进程 bundle；本机文件仅当前用户和 SYSTEM 可读写。

本机 Pi Web 已用原启动器重启，Orb 已切换到最新打包产物。验证只操作一次性本地页面，不读取或复制用户 cookies，不操作扩展授权页面；测试页面和 HTTP fixture 在完成后清理。
