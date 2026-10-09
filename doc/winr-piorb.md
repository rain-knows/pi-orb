# 本机 Win+R 全功能启动

Win+R 输入 `piorb`：启动已安装的新版 Orb，注册随包 Pi 插件，复用健康 Pi Web；
未运行时由 Orb 自动启动 Pi Web 的官方 Next production 入口。新 Orb 会话默认完全访问，
Stop／隐藏／断连继续撤权。重复执行只唤醒同一实例。

`piweb` 继续单独打开网页版；`piweb restart` 在验证本机 Next 入口及进程归属后重启服务。
启动链修正为直接启动 Next，避免 Pi Web CLI 二次派生子控制台；同时允许复用 Orb 启动的
同一 Pi Web 生产服务，不再依赖旧 CLI 父进程身份。

## 本机入口

- `HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\piorb.exe` 指向
  `%LOCALAPPDATA%\Programs\pi-orb\pi-orb.exe`，供 Win+R/ShellExecute 使用。
- `%USERPROFILE%\.local\bin\piorb.cmd` → `piorb-launch-hidden.vbs` → 已注册的安装版。
  VBS 清除该子进程的 `ELECTRON_RUN_AS_NODE`，使用现有 `pi-orb.exe` 注册路径，
  不从源码目录运行。
- 原 `piweb.cmd`／VBS 包装保留，更新 `piweb.ps1`；Windows PowerShell 5.1 的 UTF-8 BOM 保留。
  可审查副本位于 `scripts/windows-launchers/`。这里是当前账户的本机脚本，不新增产品设置或发布管道。

启动和单实例逻辑复用已落地的 `src/main/personal-startup.ts`、`src/main/index.ts` 及
`resources/installer.nsh` 的每用户 App Paths 模式；其参考基线为
`deepseek-harness-orb@72f1d738458a223696685a909e806b683eff5885`。
本轮只适配本机短命令，不改变参考交互、Pi 会话循环或授权模型。

## 2026-10-09 验证

- 更新前备份启动脚本、安装目录和受保护配置到
  `%LOCALAPPDATA%\PiWeb\launcher-backups\20261009-091049`，备份不进入仓库。
- 安装目录应用/插件资源已更新为上一阶段审计通过的解包产物；安装版 `app.asar` SHA-256
  与该构建一致。保留原卸载器、安装身份、工作区和快捷键。
- 发现空闲开发版占用单实例锁：确认其没有 Orb 会话后，仅关闭该项目开发进程，切换安装版。
- 运行时发现共享 Pi Web 缓存旧插件；通过公开 `agent/running` 确认零运行任务后，
  用更新后的 `piweb restart` 受控重载。之后不再自动重启健康服务。
- 实际执行 CMD/VBS 和 `Start-Process piorb` 的 ShellExecute 入口；重复启动主 PID 不变。
- 真实 Pi Web `get_tools` 确认 13 个当前 GUI 工具和 3 个后台工具全激活，旧 `orb_*` 工具为零。
  认证 named-pipe status 返回 Full Access，后台 status 往返成功；未发送模型任务或桌面动作。
- 隔离端口冷启动回归 7/7：正式 Pi CLI 注册、Pi Web 就绪、无 Windows 控制台、同 PID 复用、
  真实会话创建、插件移除与配置保留。未影响共享服务。
- 模型、凭据、Pi 设置和 Orb 配置 SHA-256 不变；`startup-runtime.json` 仅更新插件摘要。

证据见 `evidence/winr-launcher/installation.json`、`runtime.json` 和
`evidence/personal-startup/backend-startup.json`。复核当前已打开的 Orb：

```powershell
node evidence/winr-launcher/verify-running.mjs
```

`piweb` 启动/错误日志在 `%LOCALAPPDATA%\PiWeb\`，Orb 自启动后台日志在
`%APPDATA%\pi-orb\pi-web-startup.log`。观察框已保存的开关偏好保持原值。

## 安装路径报错复核

用户截图中的 `The current-user pi-orb installation was not found.` 来自 VBS 的
注册表读取失败分支；该提示本身不能证明安装文件不存在。复核时，两种注册表视图的
安装项和对应 EXE 均存在，原脚本已无法复现报错，因此未擅自归因或重装。
此前仅异步调用脚本不足以发现错误弹窗。本次补充同步 `cscript`、等待 `wscript`
退出码及 CMD 路径残留脚本进程检查，全部通过；ShellExecute 重复启动维持主 PID，
真实运行时仍有 16 个 Orb 工具。证据见 `evidence/winr-launcher/script-host-check.json`。
