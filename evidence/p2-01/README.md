# P2-01 参考浮球窗口几何

本阶段把 `deepseek-harness-orb` 固定提交 `72f1d738458a223696685a909e806b683eff5885` 的
`apps/desktop/src/floating-window.ts` 几何契约移植到 `src/main/floating-geometry.ts`，并通过
`src/main/floating-window-controller.ts` 接入 Electron 主进程和 preload IPC；renderer 同步复用
hover 收起、pin、系统主题和 dock tab 交互，顶部 `+` 通过 Pi adapter 创建真实新会话。

## 自动化证据

```powershell
npx vitest run tests/floating-geometry.test.ts
npm run typecheck
npm run lint
```

当前覆盖：72px 球、344x444 展开窗口、靠边展开方向、工作区边界夹紧、左右停靠阈值和 34x88
停靠 tab；session controller 还覆盖同工作区新会话和旧 SSE 释放。真实多显示器、DPI、锁屏恢复、
拖拽动画、置顶体验和主题切换的人工验收仍需完成，不能由自动测试外推。
