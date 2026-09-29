# P2-01 参考项目复用记录

日期：2026-09-29

## 来源

- 仓库：`https://github.com/rain-knows/deepseek-harness-orb`
- 固定提交：`72f1d738458a223696685a909e806b683eff5885`
- 本地只读检出：`C:\Users\JUSTLIKEZYP\AppData\Local\Temp\deepseek-harness-orb-pi-orb`
- 主要来源文件：`apps/desktop/renderer/floating.html`、`floating.css`、`floating.js`、`apps/desktop/src/floating-window.ts`、`orb-avatar.ts`

## 本阶段复用

pi-orb 的 React renderer 保留 Pi 会话和授权 IPC，但按参考 shell 的结构收敛为：

1. 72px 头像球作为唯一常驻入口；点击球展开或收起面板。
2. 展开面板使用 12px chrome、36px 圆角、顶部历史／权限／新建三控件、底部 72px 输入胶囊。
3. 头像资源作为打包静态资源，不改变 Pi 会话边界。
4. 桌面授权、快捷键和窗口选择放在权限入口的轻量浮层中，不增加主导航或独立设置页。
5. 截图仍保留 pi-orb 的预览确认和代次校验，这是 Pi 接入所需的安全边界。
6. 主进程已接入参考项目的浮球几何：72px 球、344x444 含 chrome 的展开窗口、工作区方向选择、拖动释放后的左右边缘停靠 tab，以及多显示器最近显示器计算。
7. renderer 已复用参考项目的 hover 展开／离开收起、点击 pin 保持展开、系统深色主题和 dock tab 拉回；顶部 `+` 通过 Pi session adapter 创建真实新会话。

## 未直接复制及原因

- `floating.js` 依赖 dsh Host RPC、独立 overlay Session、`dsh-app://` 协议和 iframe ChatView，不能直接运行在 pi-web 的 Electron bridge 中；当前只移植其 DOM 状态和 CSS 约定，Pi 会话继续走本仓库 `OrbSessionController`。
- `floating-window.ts` 的拖拽、贴边停靠和动态 BrowserWindow 尺寸已通过 `floating-geometry.ts` 与
  `floating-window-controller.ts` 接入 pi-orb 主进程；窗口收起会先还原为 96x96 球，配置只保存球位置。
- 真实多显示器、DPI、锁屏恢复与人工拖动验收仍未完成，因此支持矩阵仍标记为未验证。
- 参考 `floating.js` 的历史列表依赖 DSH overlay session/history RPC；pi-web adapter 当前只公开当前会话的创建、提示和 SSE，不能伪造跨会话历史，因此首阶段保留 transcript，不增加第二套 history store。
- 参考 `observation-frame-window.ts` 是独立的 click-through 原生 overlay；pi-orb 当前没有公开的观察框生命周期契约，本阶段不在 renderer 里画会挡截图的假边框。
- 参考项目的自定义 avatar 持久化和菜单模型依赖 Desktop profile；当前使用仓库静态 avatar，不扩展 Pi 配置写入。

本记录不把“视觉相似”当作参考项目功能完成证明；未复用项必须在对应 P2 任务接入真实边界后单独验收。
