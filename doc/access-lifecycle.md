# 权限生命周期

适用于前台桌面操作和后台工具授权。

新 Orb 会话以及明确重新打开隐藏的 Orb 默认 Full Access。聚焦已可见窗口保留手动选择；正常回复结束保留当前会话授权。Access 分档决定可见工具及可执行能力，执行前仍检查会话、owner 和 generation。

Stop、隐藏、断连、锁屏、会话或工作区切换、退出统一撤销旧授权，释放按键、鼠标、GUI 锁和监听器，丢弃记录目标。停止与完成通知互斥。截图分享有独立的预览确认流程。

实现：[桌面 broker](../src/main/desktop-broker.ts)、[生命周期](../src/main/window-lifecycle.ts)、[输入驱动](../src/main/reference-windows-driver.ts)。回归：[授权工具](../tests/orb-tools.test.ts)、[按键释放](../tests/reference-windows-input.test.ts)、[生命周期](../tests/window-lifecycle.test.ts)。实际证据见 [权限记录](../evidence/p1-07/session-access-regression.json)。

来源：当前插件 `packages/computer-use/src/gui-lock.ts`、`plugin.ts`；Pi 使用 owner/generation 撤销边界替代 dsh 生命周期，固定身份见 [取材入口](reference-playbook.md)。
