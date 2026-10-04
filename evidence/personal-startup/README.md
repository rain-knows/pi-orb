# Windows 个人用户安装与启动证据

实施说明：[`../../doc/personal-user-installation.md`](../../doc/personal-user-installation.md)。
版本 preview.2 为本地构建，未发布、未签名。本机自动化不代表干净机器或 SmartScreen 验收。

| 文件 | 判定依据 |
|---|---|
| `plugin-load.json` | 从实际包复制独立插件到中文/空格目录，经真实 Pi 加载，完整工具清单与工作区边界 |
| `backend-startup.json` | 官方 Pi CLI 登记/移除，真实 Pi Web 隐藏启动、同 PID 复用，真实 API 创建会话，模型设置保留 |
| `installer-smoke.json` | NSIS 实际安装、真实 HKCU 登记、ShellExecute 短命令、主实例/握手/草稿保持、卸载清理 |
| `current-user-installation.json` | 安装到当前账户、短命令复用真实主进程、后端就绪、随包登记、原工作区和模型/凭据文件哈希保持，7/7 |
| `pi-web-baseline.json` | Pi Web 已于前一天升级后的当前 HEAD 和六个受保护文件 SHA-256，原 P0 快照不修改 |

复现：

```powershell
node evidence/p2-05/run-p2-05.mjs
node evidence/personal-startup/run-backend-startup.mjs "<官方 Pi Web目录>/bin/pi-web.js"
npm run package:win
# 无已有 App Paths 登记时，探针临时安装/卸载，不覆盖用户已有安装
node evidence/personal-startup/run-installer-smoke.mjs
```

失败记录保留：`plugin-load-wrong-count.json` 是测试工具数误设；
`backend-startup-initial.json` 是相对路径测试和缺少模型/API type 的初次结果；
`installer-smoke-timeout.json` 是第一次安装等待超时；
`installer-smoke-initial-profile.json` 是中文 PowerShell 输出和测试参数/主进程 profile 尚未正确隔离。
`installer-smoke-uninstall-wait.json` 是未等待 NSIS 临时卸载进程完成即检查登记的结果；最终探针等待登记与 EXE 实际消失。
后续修复保留完整权限/工具清单断言，当前是否通过只看对应最终 JSON。

发布门禁修正了升级前的 SDK 固定值和源码保护快照；源码分发检查仍拒绝已跟踪或可加入 Git
的截图，忽略此前已经退出 Git 跟踪的本机捕获。没有修改 Pi Web 源码、凭据或模型配置。
