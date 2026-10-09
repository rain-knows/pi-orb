# 2026-10-09 上游同步证据

范围与适配理由见 [阶段记录](../../doc/reference-sync-2026-10-09.md)。
`reference-manifest.json` 覆盖插件 32 个提交的 47 个文件、旧单体 1 个提交的 9 个文件；
逐文件列出处置、源码 SHA-256／Git blob，以及 13 个来源与目标文件的 SHA-256 和许可头。
参考检出仅供开发审计，产品运行不读取它们。

按顺序复现（打包构建完成后再启动 UI 探针）：

```powershell
npm run lint
npm test
node evidence/reference-sync/record-reference.mjs
node evidence/p1-07/check-provenance.mjs --json
node evidence/p2-05/run-p2-05.mjs
node evidence/reference-sync/run-ui-probe.mjs
```

构建步骤包含类型检查。P2-05 分别证明内容审计 30/30、真实 Pi 插件加载 15/15 和
打包启动/OS 光标拖动 IPC 23/23，不以构建成功代替运行证据。

`run-ui-probe.mjs` 为真实打包 Electron 配置独立 userData、专用工作区、确定性 Pi Web
HTTP/SSE 夹具，记录 `ui-probe.json`（18/18）。通过 Electron 主进程 inspector 在该独立
进程内捕获 `shell.openExternal` 及菜单选择，不导航用户浏览器、不移动用户光标、
不使用真实模型或凭据。验证跨会话书签/归属标题、200px 级侧栏、默认折叠停止报告、
不展示防重启模型指令、停止按钮在面板内、准确 URL 仅打开一次、已读结束书签移除、
未知书签拒绝、观察框默认开启与关闭持久保存。

`bookmarks-folded.png`、`bookmarks-expanded.png` 是只含 Orb 夹具窗口的目视复核截图；
像素文件按仓库规则不进入 Git。真实模型 Computer Use、多屏/DPI 和安装生命周期的
支持声明继续以支持矩阵及已有证据为准。
