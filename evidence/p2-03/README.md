# P2-03 历史会话入口

## 参考项目复用

参考项目 `floating.html` / `floating.js` 的 history 按钮打开已有 overlay session 列表，并在
选择后切换 transcript。pi-orb 不能读取 DSH 私有 RPC，因此复用 pi-web 已公开的：

选区读取直接对照参考项目固定提交 `72f1d738458a223696685a909e806b683eff5885` 的
`apps/desktop/src/windows-selection.ts`、`windows-selection-native.ts` 和
`selection-toolbar-controller.ts`；pi-orb 保留其 UI Automation / mouse-up 语义，但把结果
接入现有 composer，而不是再创建一套 overlay session。

- `GET /api/sessions?summary=1`：取得会话摘要；
- `GET /api/sessions/:id?tail=80`：取得指定会话的公开上下文；
- 通过 `OrbSessionController.openExistingSession` 绑定当前 Orb 会话。

主进程只返回 `orbWorkspace` 精确匹配的会话，避免把其它 cwd 的历史混入 Orb。历史上下文只保留
user/assistant 文本，不把 thinking、tool 结果或原始 JSONL 暴露给 renderer；没有新增本地 history
store，也没有直接读取 pi agent 目录。

## 自动化验证

```powershell
npx vitest run tests/pi-web-history.test.ts tests/orb-session.test.ts
npm test
npm run typecheck
npm run lint
npm run build
```

测试覆盖外部 JSON 的坏记录过滤、文本 block 提取、现有 session 绑定和运行中拒绝切换。

## 选区上下文接入

在保持非破坏性边界的前提下，本阶段现在也接入了参考项目同类的 Windows 选区读取路径：

- `src/main/windows-selection-native.ts` 使用 Win32 low-level mouse hook 观察左键释放，并通过
  Windows UI Automation `TextPattern` 读取当前焦点控件的选中文字；读取上限为 4000 个字符。
- `src/main/windows-selection.ts` 负责 hook 事件到选区事件的纯逻辑转换，并过滤空文本和 Orb 自身进程。
- 主进程通过受限 IPC 发送选区文本、来源进程标签、可选 bounds 和捕获时间；renderer 以 selection chip 展示，用户显式发送 prompt 时才附加文本。
- 发送后或用户关闭 chip 会清理上下文；会话切换、工作区切换和壳退出也会清理上下文。

这条链路不读取系统剪贴板，不模拟 `Ctrl+C`，不做 OCR，也不把来源标签当作授权。

## 未验证范围

参考项目的选择工具栏还包含独立的原生 toolbar、辅助功能授权提示和搜索/翻译动作；pi-orb 当前只复用
其 Windows UI Automation 读取语义，并将结果放入自己的 composer chip。真实 Windows UI Automation、
多显示器/DPI 选区 bounds、锁屏恢复、高权限窗口和原生选区工具栏仍未人工验收。macOS selection
monitor 尚未接入，不把 Windows 路径外推到其它平台。
