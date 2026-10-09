# 历史恢复

适用于历史列表、载入与断线后的前台恢复。

通过 Pi Web 公开摘要/详情接口读取历史，按工作区过滤。加载历史先切换会话与撤销旧资源；消息去重、队列和流事件按当前会话身份处理。关闭或卸载不删除历史。

来源：旧单体 `apps/desktop/renderer/floating.js` 的历史交互；Pi Web 持久会话替代 dsh runtime，不另建转录数据库。

实现：[client](../src/main/pi-web-client.ts)、[session](../src/main/orb-session.ts)、[renderer](../src/renderer/floating.js)。回归：[历史](../tests/pi-web-history.test.ts)、[恢复](../tests/floating-recovery.test.ts)。规则关联：[工作区与会话](workspaces-sessions.md)。
