# Windows 启动、图标、工作区和默认权限修正

2026-10-04，preview.3。修复 preview.2 安装后可见的 next-server 终端，补齐工作区切换入口
和 Full Access 的界面状态同步。具体支持结论仍在 `support-matrix.md`。

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

## 证据

- `tests/floating-renderer.test.ts`：初始 grant 的实时标签/选中、撤权显示，切换清理上下文，取消保留内容。
- `tests/personal-startup.test.ts`：正式 Next 入口解析、中文/空格路径、未构建安装拒绝；端口/外部服务拒绝仍测。
- `evidence/personal-startup/backend-startup.json`：真实生产 Pi Web、Win32 AttachConsole 反证黑窗口、同 PID 复用、真实会话与设置保留。
- `evidence/p2-05/`：当前打包内容和真实 Electron 启动。
- `evidence/windows-startup-and-workspaces/`：实际 UI/工作区/权限及安装升级结果。

491 个单元测试、实际界面生命周期 25/25、当前账户静默升级 11/11 已通过。
升级保留模型/凭据字节、工作区与快捷键，真实短命令启动的生产后端无控制台。
完整干净机、SmartScreen、多显示器等历史未验证项保留；本地预览构建不作完整发布声明。

官方依据：[Node 子进程](https://nodejs.org/docs/latest-v24.x/api/child_process.html)、
[Next.js CLI](https://nextjs.org/docs/app/api-reference/cli/next)。隐藏只作用于新启动的服务，
已有后端仍复用，Orb 退出保留共享后端和日志。
