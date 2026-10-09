# Pi Web 0.10 / Pi 1.0 升级记录（2026-10-03）

> 阶段来源记录：保留实施时的事实与结果，不随当前版本同步。当前行为见参考手册与工具契约，支持结论只见支持矩阵。

本轮重点是 **Pi 插件装配和提示词组织**，其次是 Orb 对新版事件合同的适配。
当前版本声明统一见 [支持矩阵](./support-matrix.md)，结构化结果见
[升级证据](../evidence/upgrade-0.10/README.md)。这是本机与源码升级，未发布新安装器。

## 1. 实际运行链与升级范围

Win+R 的 `piweb` 通过用户 `.local/bin/piweb.cmd → piweb.vbs → piweb.ps1`
启动 `C:/Users/JUSTLIKEZYP/OneDrive/文档/daily/pi-web/bin/pi-web.js`。
因此同时更新了该源码检出、其 lockfile/生产构建、全局 pi-web 包和 Pi CLI。
源码合入官方 `v0.10.0`（`6fcd7d44981ab51a21d6cd6eb06d361d0e3d3068`），
保留已有 Endfield 和 Windows 模型保存修复。原有六个未提交界面文件仍保留为用户修改。

模型、凭据、全局配置、插件目录与启动脚本先备份到
`D:/pi-orb-upgrade-backups/2026-10-03`。升级后 `models.json` 与 `auth.json`
逐字节核对一致。Orb 从宿主 Pi Web 加载插件，开发 SDK 仅用于类型/测试；打包产物不携带另一套 Pi 引擎。

Pi 1.0 的 `pi update` 更新宿主，扩展更新须用 `pi update --extensions`。
此次两条路径均已执行，并通过实际生产 API 检查资源与诊断。

## 2. 提示词组织修复

全局 Prompt Architect 在 `~/.pi/agent/extensions/prompt-architect`。
旧实现设置 `systemPromptOptions.customPrompt` 并复制 Pi 的 tools/rules/docs 渲染。
当它先于其他插件执行时，后续 `promptGuidelines` 不再进入复制出来的主提示词，
原生 MCP/Code mode 与动态工具也可能失去其原有组织。

现在仅追加 `engineering`、`tool_policy`、`workflow`、`delivery_contract` 四个命名段。
Pi 自己渲染 preamble、tools、rules、docs、addendum、project_context、skills、cwd，
原生 MCP 的 server 指令和 Code mode 段也保持由其所属插件管理。Orb 单独追加 `orb_mode`。
所有 hook 完成后再由 Pi 构建原生工具与规则；同一会话工具变化由 Pi 的 transcript delta 处理。

| 来源 | 当前责任与边界 |
|---|---|
| Pi 原生 | 工具参数/声明、插件 guidelines、文档路径、上下文/skills、动态装配和转录补丁 |
| Prompt Architect | 工程、流程与交付策略；按当前 active tools 生成路由；不复制原生 renderer |
| 原生 MCP / Code mode | 连接、命名空间说明、工具发现与执行；使用 `searchTools()`、`describeNamespace()`、`describeTool()` |
| Orb | 专用 cwd 的桌面提示、观察新鲜度、像素坐标、动作顺序与权限边界 |
| SYSTEM.md / CLI customPrompt | 已有显式自定义提示时不加入全局策略；保留其主体 |
| forceSystemPrompt / 后续返回 systemPrompt | 完整替换由提出替换的插件掌控；空字符串也视为明确替换 |
| AGENTS.md / append | 只删除被后续来源完整包含的重复内容；部分重叠与改写规则保留 |

删除手工 tools/rules/docs renderer、旧 docs.md、旧 SDK stub 和 `mcp({…})` / `mcpScript`
路由，不保留旧版本兼容分支。修正 `read` 的说明为读取文件，目录查询交由 listing/shell。
模型工具与 `/usage`、`/rewind`、`/open-tui` 等用户命令分别说明。
子代理启动、supervisor 回复、web 延迟启用、用户激活 `/plan`、明确用户请求才创建 goal 的边界已逐项检查。

`/prompt-audit` 可查看策略段尺寸及 active gates，`/prompt-export <新文件>` 导出上次运行的完整有效提示词。
导出不覆盖已有文件。完整提示词含用户私有上下文，因此仓库只存无凭据的代码改动 patch 和检查结果。
四段策略在合成能力夹具中约 1409 tokens（UTF-8 bytes/4 估算，非模型 tokenizer）。

真实 Pi SDK + 实际全局扩展 + Orb 扩展的 provider 输入审计 29/29 通过；
同样的审计装入备份旧版本时明确失败。这比只检查 hook 返回值更能证明规则确实到达模型。
纯策略/去重自检 21 项、hook 控制权自检 11 项通过。

## 3. 插件与 MCP 整理

| 包 | 升级后版本 | 检查结果 |
|---|---|---|
| pi-goal-x | 0.32.3 | 资源装配正常；goal 策略保留 |
| pi-subagents | 0.75.0 | 扩展、2 skills、6 prompts 装配；宿主 SDK 路径由启动脚本明确指定 |
| @janvitos/pi-usage | 0.52.9 | 资源装配正常；用户命令 |
| @quintinshaw/pi-dynamic-workflows | 3.13.1 | 保持禁用、资源数组为空 |
| @juicesharp/rpiv-advisor | 2.12.0 | 普通会话保留；Orb 在 session_start 按专用 cwd 关闭，后续 hook 防止重新加入 |
| @narumitw/pi-plan-mode | 0.58.4 | 资源装配正常；不因工具可见而擅自进入 Plan |
| @juicesharp/rpiv-ask-user-question | 2.12.0 | 资源装配正常；按当前 schema 使用 |
| pi-rewind | 0.5.0 | 当前版本；资源装配正常 |
| pi-open-tui | 0.3.11 | 资源装配正常；用户命令 |
| pi-web-access | 0.35.0 | 修复旧插件的宿主装配警告；按需启用 Web 路由 |
| pi-mcp-adapter | 已移除 | 使用 Pi 1.0 原生 MCP；不留下同名 `/mcp` 竞争 |

Orb 包同时出现在全局/本项目声明中，由 Pi 资源加载器去重；实际资源及命令只有一份。
没有自行实现第二套插件加载机制。插件装配诊断为空不等于每个插件的所有交互都经过验收；
此次真实操作重点是原生 MCP、提示词组合、Orb 模型/桌面闭环。

原有 `mcp.json` 的 URL、headers、env、command 等连接信息保留；旧 adapter 的
`auth:false`、`protocolVersion`、`lifecycle`、`approveTools` 等字段一次性清除。
配置经原生 validator 校验，转换报告只列服务器名与移除字段，无密钥。
context7、anysearch、amap、deepwiki、chrome-devtools 均完成真实握手/工具列表获取，
分别 2 / 4 / 15 / 3 / 31 个工具。普通生产会话真实模型执行了 Code mode 发现、描述与 Anysearch 搜索，
取得真实结果并正常完成。浏览器 Settings → MCP 可见五个“已在会话中连接”的服务。

新版 MCP 文件保存的同步 rename 在 Windows 并发写测试中复现 EPERM。
Pi Web 已复用现有异步原子写入函数，短暂锁定重试时保留旧文件；项目配置保留文件 mode，
全局配置仍为私有文件。并发写不丢失、锁/拒绝/清理合同与模型配置测试通过。

## 4. Orb 接口适配与参考来源

开发前核对两处本地参考提交与 [取材手册](./reference-playbook.md)：旧单体 `72f1d738458a223696685a909e806b683eff5885`、
新插件 `9cdc50302d202f4497569731be488a8afa500da7`。
桌面行为沿用参考项目的 `packages/experimental/tool-computer-use/` Windows 实现和新插件的像素/图片合同，
该阶段像素实验与来源见 [历史提速证据](../evidence/tool-speed/README.md)；当前坐标合同只见 [参考手册](./reference-playbook.md) §6.3。本轮没有改动这些参考源和界面/权限语义。
参考项目的 dsh 会话驱动不能直接作为 Pi 运行时，因此只调整 `src/main/orb-session.ts` 与 Pi 插件接入边界。

- Pi 1.0 的 `agent_end` 不是逻辑完成：重试、压缩、follow-up 仍可能继续。
  Orb 自己发起的消息以 Pi Web 的 `prompt_done` 完成；扩展发起的运行以最终 `agent_settled` 完成。
- 最终 stopReason 从 assistant `message_end` 读取；异步 `prompt_error` 报错后仍等完成通知，不抢先推进队列。
- stream epoch 拒绝停止、代次切换和下一条消息之后到达的旧流事件/结束回调，避免错误解除 busy。
- 12 个桌面观察/输入工具声明 `exposure: model-only`，在 Code mode only 下仍直接交给模型调用，
  不允许嵌入脚本吞掉截图上下文；公开 Playwright 工具保持原有开放行为。
- 测试 mock 跟随 Pi 1.0 `ExtensionToolContext.tools/executeTool`，不保留旧 context API 兼容层。

## 5. 验证和边界

| 验证 | 结果 |
|---|---|
| Orb 单测 | 50 文件 / 482 测试通过；含提前 agent_end、prompt_error、旧流结束、停止后事件与会话切换 |
| Orb typecheck / lint / build | 通过 |
| Pi Web build / lint | 通过 |
| Pi Web 聚焦配置/提示/装配测试 | 171 通过，7 平台条件跳过，0 失败 |
| 追加 MCP 短暂锁定回归后的文件保存测试 | 14 通过，3 平台条件跳过，0 失败 |
| Provider 提示词审计 | 29/29；旧版本反证失败保留 |
| 原生 MCP | 5/5 真实连接；真实模型搜索检查 5/5 |
| 实际生产保存接口（隔离配置） | 3/3；模型真实变更回读，MCP 连续 20 次替换落盘 |
| 全局 Pi CLI + 当前全局插件 + 真实模型 | 3/3；实际 1.0.1 启动、响应、无插件加载错误 |
| 真实 Electron/Pi Web 授权生命周期 | 21/21 |
| 真实模型 + 新全局提示词 + Orb 原生桌面 | 7/7 disposable target 任务 |
| 解包产物内容/实际启动 | 27/27 + 22/22，执行完整 P2-05 runner |

Pi Web 全量测试未通过：Windows 上部分 Jiti React context 模块解析和 shell 命令夹具失败，
原生 read-only MCP 集成夹具有无进度挂起，进程树在确认归属后终止。此限制保留在证据，
不能把聚焦与生产运行结果说成全量测试通过。多屏、高权限窗口、真实键盘及干净机安装等原有未验证项
仍见支持矩阵；本轮成功样本不扩大这些支持声明。

本机可运行产物在 `release/0.1.0-preview.1/win-unpacked/pi-orb.exe`。
本轮只重建本地产物，不覆盖 GitHub 已发布预览安装器。升级后新会话使用新提示词和插件装配；
旧转录中的历史指令不作为新的全局策略来源。
