# P2-02 双 Alt 快捷手势

## 参考来源与边界

- `deepseek-harness-orb` 固定提交 `72f1d738458a223696685a909e806b683eff5885` 的 computer-use
  工具禁止把截图热键作为模型输入动作；参考项目没有用户侧双 Alt 截图手势。
- pi-orb 按 `doc/pi-orb-development-goals.md` 的 P2-02 目标复用已有 `uiohook-napi` hook，读取
  `Alt=56` 与 `AltRight=3640`；检测后只唤醒 Orb 并打开既有截图预览，不自动发送图像。
- 组合状态由 `src/main/double-alt.ts` 持有；应用退出移除左右 Alt 监听器。常规可配置全局快捷键
  仍由 Electron `globalShortcut` 管理，不被替换。

## 自动化验证

```powershell
npx vitest run tests/double-alt.test.ts
npm test
npm run typecheck
npm run lint
npm run build
```

测试覆盖左右顺序、重复 keydown 的单次触发、完整释放后再次触发、慢速组合、Ctrl+Alt（AltGr
形态）拒绝以及 stop 后无触发。它们验证纯状态机，不证明操作系统 hook 在真实键盘上的事件序列。

## 尚未验收

真实键盘左右 Alt、按住不放、AltGr / 非 US 键盘布局、应用焦点变化、锁屏和睡眠恢复仍需人工验收。
未验收前不得将双 Alt 标记为跨布局或锁屏恢复已支持。
