# 工作区与会话

适用于前台会话、Pi worker 和工作区切换。

Orb 能力按配置的专用 cwd 注册；普通会话保持宿主工具和已有资源。用户级 skills 由 Pi 自己加载，Orb 不承诺清除这些既有资源。后台工具范围从实际已加载宿主能力选择，不虚构搜索或问答服务。

切换工作区或会话先停止旧任务、撤权并清空旧上下文；历史仍归属原目录。旧 stream epoch、generation 和 owner 事件不得改变新会话状态。

Pi 1.0 的 agent_end 可能发生在重试、压缩或 follow-up 之间。Orb 发起的消息以 prompt_done 完成，扩展发起的运行以最终 agent_settled 完成；prompt_error 不抢先推进队列，最终 stopReason 从 assistant message_end 获取。

实现：[workspace](../src/main/workspace.ts)、[Orb 会话](../src/main/orb-session.ts)、[代次](../src/main/generations.ts)。回归：[会话测试](../tests/orb-session.test.ts)、[工作区测试](../tests/workspace.test.ts)。来源：当前插件 `packages/computer-use/src/code-agent.ts` 的归属模型；Pi 生命周期替换 dsh 驱动，见 [后台任务](background-tasks.md)。
