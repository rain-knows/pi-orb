# preview.3 Windows 修正证据

本页为 2026-10-04 阶段证据，不随产品更新重写。当前使用说明见 [个人安装与启动](../../doc/personal-user-installation.md)。

- `ui-lifecycle.json`：真实 Electron + Pi Web + 本机测试供应商；默认 Full Access 标签、同目录不重建、运行中切换、原授权/撤权合同。
- `current-user-upgrade.json`：当前已安装用户升级、短命令、无控制台与数据保留。
- `../personal-startup/backend-startup.json`：真实生产 Next 入口与 Win32 控制台探针，7/7。
- `../p2-05/`：包内容和打包产物启动。

复现 UI 扩展检查（Pi Web 需要已构建，测试有独立配置、用户目录、工作区和端口）：

```powershell
$env:PI_ORB_EVIDENCE_PI_WEB = '<已构建的 Pi Web>'
node evidence/p1-07/run-lifecycle-regression.mjs --workspace-ui --output=evidence/windows-startup-and-workspaces/ui-lifecycle.json
```

结果只由对应 JSON 判定，不外推干净机器、升级向导或 SmartScreen。截图仅为本机预览，未进入源码分发。

## 来源与实现

已验证只读参考 HEAD 为 `72f1d738458a223696685a909e806b683eff5885`。

| 来源 | 复用与适配 |
|---|---|
| 参考 apps/desktop/resources/icon-windows.svg | 直接复用圆角底板、渐变和阴影；主体替换为 π，避免用参考产品品牌标志表示 Pi。SVG、PNG、ICO 同源，托盘和窗口读取同一 PNG |
| 参考 src/floating-window.ts:55-129 | 原生上下文菜单与辅助入口；在现有菜单追加「切换工作区…」，托盘提供同一动作 |
| 参考 src/project-manager.ts、floating-session.ts | 固定宿主目录和独立会话生命周期；参考没有用户文件夹切换器，不搬 dsh project 初始化，用已有 Pi 文件选择与 generation/session 边界 |
| 参考 src/orb-permission.ts | 默认 Full Access；Pi 的 session Access 和撤权语义保留，实际 authorize/revoke 状态立即送到 renderer |
| Pi Web 0.10 bin/pi-web.js、Next.js 正式 CLI | 第二层 spawn 未设置 windowsHide。解析已验证安装包内的 next/dist/bin/next，以相同 cwd、start/-p/-H 和 PI_WEB_HOSTNAME 直接隐藏启动；服务本体仍为原 Pi Web，不改上游、不注入 preload、不替换会话引擎 |

通过已有 `chooseWorkspace` 和 `setWorkspace`。取消和再次选中同一目录零会话变更。
切换先撤销旧 desktop grant、取消旧 provider/排队消息，停止成功才保存目录、增加 generation、
写握手并创建新会话。旧会话历史不删除。界面清除旧 transcript、草稿、选区、截图和历史列表，
避免内容被发往新目录；新会话获得默认 Full Access。Stop、隐藏、断连仍撤销当前授权。

图标用 `scripts/build-app-icon.mjs <Sharp package path>` 重生成；复用已安装的
electron-builder ICO 转换器。Sharp 仅为外部图形工具，没有新增产品依赖。
许可证及修改说明在 `THIRD_PARTY_NOTICES.md`；新 PNG 是固定批准产品资源。
