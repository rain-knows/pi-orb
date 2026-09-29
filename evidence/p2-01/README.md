# P2-01 参考浮球窗口几何

本阶段把 `deepseek-harness-orb` 固定提交 `72f1d738458a223696685a909e806b683eff5885` 的
`apps/desktop/src/floating-window.ts` 几何契约移植到 `src/main/floating-geometry.ts`，并通过
`src/main/floating-window-controller.ts` 接入 Electron 主进程和 preload IPC。

## 自动化证据

```powershell
npx vitest run tests/floating-geometry.test.ts
npm run typecheck
npm run lint
```

当前覆盖：72px 球、344x444 展开窗口、靠边展开方向、工作区边界夹紧、左右停靠阈值和 34x88
停靠 tab。真实多显示器、DPI、锁屏恢复、拖拽动画和置顶体验仍需人工验收，不能由这组纯函数
测试外推。
