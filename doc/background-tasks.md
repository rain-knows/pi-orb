# 后台任务

适用于 code_agent 创建、继续、状态、停止与通知。

入队立即返回，独立 Pi Web session/SSE 执行。registry 记录 owner、worker、cwd 和状态；状态与停止只访问所属任务。新 worker 沿用 owner 模型与 thinking level，不新增独立模型配置。

完成通知等待 owner 与 worker 均空闲，停用 owner 的通知暂存至它重新激活。停止取消通知；用户在主窗口停止的任务不会自动重启。失败读取最终助手 stopReason/errorMessage，保留错误全文；不依赖 prompt_error 一定出现。

任务书签跨 Orb 对话展示耗时、停止和未读状态，点击打开对应 Pi Web session。继续传 session_id；执行工具按 Access 和实际宿主资源选择。

来源：当前插件 `packages/computer-use/src/code-agent.ts`、`code-agent-registry.ts`、`code-agent-completion.ts`、`packages/helper/assets/shell.js`。Pi Web API 替换 Cordis 服务；不复制 dsh standard preset 引擎。

实现：[manager](../src/main/code-agent-manager.ts)、[Pi 工具](../pi-package/extensions/code-agent.ts)。回归：[归属与通知](../tests/code-agent-manager.test.ts)。证据：[完成](../evidence/p1-06/real-model-code-agent-session.json)、[停止](../evidence/p1-06/real-model-code-agent-stop-session.json)、[失败](../evidence/p1-06/real-model-code-agent-failure-session.json)。
