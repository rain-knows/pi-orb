# 本机启动器

适用于当前账户已有安装；分发安装器的 pi-orb 入口见 [个人启动](personal-user-installation.md)。

Win+R 输入 piorb，通过 HKCU App Paths/piorb.exe 启动已安装的 pi-orb.exe。命令行副本位于 %USERPROFILE%/.local/bin/，piorb.cmd 调用 piorb-launch-hidden.vbs；VBS 从 pi-orb App Paths 解析安装路径，清除子进程 ELECTRON_RUN_AS_NODE，不依赖源码目录。

piweb 保留独立打开网页用途；piweb restart 需核对 Next 入口、进程归属和空闲状态，允许复用 Orb 启动的生产服务。直接启动 Next 避免 CLI 二次派生控制台；不得自动重启健康共享服务。

可审查副本见 [CMD](../scripts/windows-launchers/piorb.cmd)、[VBS](../scripts/windows-launchers/piorb-launch-hidden.vbs)、[PowerShell](../scripts/windows-launchers/piweb.ps1)。PowerShell 5.1 文件保留 UTF-8 BOM。日志位置由脚本和 [个人启动代码](../src/main/personal-startup.ts) 决定。

安装路径报错先核对注册视图、EXE 与同步脚本退出码；弹窗不能单独证明安装文件不存在。历史复核不能重写为当前环境结论。记录：[安装](../evidence/startup/installation.json)、[运行](../evidence/startup/runtime.json)、[脚本宿主](../evidence/startup/script-host-check.json)。

来源：旧单体 72f1d738458a223696685a909e806b683eff5885（MIT）的每用户 App Paths 打包形态，以及本项目已有 personal-startup/showOrb/presentOrb；只适配本机短命令，不另建产品设置或发布管道。支持边界见 [支持矩阵](support-matrix.md)。
