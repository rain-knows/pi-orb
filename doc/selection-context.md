# 选区上下文

适用于 Windows 文本选区 chip 与选区问答。

经 UI Automation 读取外部窗口文本，不以 Ctrl+C 或改写剪贴板模拟选区。忽略 Orb 自身，按目标和代次更新 chip；用户可显式移除。选区问答不自动附 GUI 首帧，切换或停止清理旧选区。

来源：旧单体 `apps/desktop/src/selection-monitor.ts`、`windows-selection.ts` 与浮窗 chip；插件参考 `packages/computer-use/src/selection-turn.ts` 的首帧例外。保留 Windows UIA 思路，Pi 接入替换宿主消息通道。

实现：[monitor](../src/main/selection-monitor.ts)、[UIA](../src/main/windows-selection-native.ts)。回归：[选区](../tests/windows-selection.test.ts)。UIA 跨应用和真实快捷键范围只见 [支持矩阵](support-matrix.md)。
