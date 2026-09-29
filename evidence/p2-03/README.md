# P2-03 历史会话入口

## 参考项目复用

参考项目 `floating.html` / `floating.js` 的 history 按钮打开已有 overlay session 列表，并在
选择后切换 transcript。pi-orb 不能读取 DSH 私有 RPC，因此复用 pi-web 已公开的：

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

## 未实现范围

参考项目的选区文字来自 DSH overlay session；本阶段不读取系统剪贴板、不模拟 Ctrl+C、不做 OCR，
因此 P2-03 的选区/辅助功能文本仍未实现。多显示器选区遮罩和原生观察框也继续保持未验证。
