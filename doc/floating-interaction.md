# 浮窗交互

适用于浮球、展开面板、停靠、菜单与任务书签。

复用参考 HTML/CSS/JS、系统主题、窗口几何、方向选择、滑动停靠和系统光标拖动；常量以 [几何代码](../src/main/floating-geometry.ts)、[controller](../src/main/floating-window-controller.ts) 与 [CSS](../src/renderer/floating.css) 为准。

输入草稿、焦点、问题卡片和工具执行阻止自动收起。点击输入框固定面板，点击浮球取消固定。原生动作期间临时截图排除和点击穿透。减少动效、窗口销毁时直接落位；配置只保存球位置。

可编辑右键菜单使用 Electron 编辑角色；已打开时拒绝叠加菜单。Pi 无自有 dsh 主窗，因此壳菜单使用隐藏 Orb，仍走统一撤权。模型设置沿用 Pi，不搬 dsh 设置/更新面板。

来源：旧单体 `apps/desktop/renderer/floating.{html,css,js}`、`apps/desktop/src/floating-window.ts`；当前插件 `packages/helper/assets/{floating.css,floating.html,shell.js}` 与 `packages/helper/src/geometry.ts`。Pi 会话模块替换宿主协议；产品图片与版权见 [第三方声明](../THIRD_PARTY_NOTICES.md)。

回归：[几何](../tests/floating-geometry.test.ts)、[停靠](../tests/floating-dock-animation.test.ts)、[renderer](../tests/floating-renderer.test.ts)、[DOM/CSP](../tests/renderer-reference-parity.test.ts)。当前界面记录见 [UI probe](../evidence/ui/ui-probe.json)。
