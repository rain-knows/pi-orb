# 本机启动器

适用于当前账户已有默认目录安装；分发安装器的 pi-orb 入口见 [个人启动](personal-user-installation.md)。

Win+R 输入 piorb；PATH 中的 piorb.cmd 调用 piorb-launch-hidden.vbs，VBS 清除子进程 ELECTRON_RUN_AS_NODE 后，以完整路径启动 %LOCALAPPDATA%/Programs/pi-orb/pi-orb.exe，不依赖源码目录、注册表读取或 EXE 短名称查找。HKCU App Paths/piorb.exe 也指向同一个安装文件。自选安装目录应使用安装器提供的 pi-orb 入口。

piweb 保留独立打开网页用途；piweb restart 需核对 Next 入口、进程归属和空闲状态，允许复用 Orb 启动的生产服务。直接启动 Next 避免 CLI 二次派生控制台；不得自动重启健康共享服务。

可审查副本见 [CMD](../scripts/windows-launchers/piorb.cmd)、[VBS](../scripts/windows-launchers/piorb-launch-hidden.vbs)、[PowerShell](../scripts/windows-launchers/piweb.ps1)。PowerShell 5.1 文件保留 UTF-8 BOM。每次 VBS 启动将宿主、完整 EXE 路径与启动错误码写入脚本旁的 piorb-launch.log；应用日志见 [个人启动代码](../src/main/personal-startup.ts)。

此前 RegRead 错误被统一显示为安装不存在；移除检测后，用户在实际 Win+R 启动时捕获第 6 行 Run("pi-orb.exe") 返回 80070002。此前 ShellExecute 与同步宿主检查不能证明用户的 Win+R 环境能解析短名称，现已改为完整安装路径，不保留这两条旧路径。当前验证需覆盖最小 PATH、两种脚本宿主、Explorer 分发、CMD 与 ShellExecute 短命令，以及同实例唤醒；每日报告放 evidence/runs/，历史复核不能重写为当前环境结论。历史记录：[安装](../evidence/startup/installation.json)、[运行](../evidence/startup/runtime.json)、[脚本宿主](../evidence/startup/script-host-check.json)。

来源：旧单体 72f1d738458a223696685a909e806b683eff5885（MIT）的每用户 App Paths 打包形态，以及本项目已有 personal-startup/showOrb/presentOrb；只适配本机短命令，不另建产品设置或发布管道。支持边界见 [支持矩阵](support-matrix.md)。
