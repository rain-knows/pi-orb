# 个人安装与启动

适用于每用户 NSIS 安装器的 pi-orb 入口；本机 piorb 别名见 [启动器](winr-piorb.md)。支持结论只见 [支持矩阵](support-matrix.md)。

需要已有 Node、Pi CLI 和已安装/生产构建的 Pi Web；版本以 [manifest](../package.json) 为准。模型与凭据沿用 Pi。安装后从开始菜单或 Win+R 输入 pi-orb；App Paths 用于 ShellExecute，不修改系统 PATH。

首次调用官方 pi install 注册 resources/pi-plugin，先备份用户设置，按 Pi 语义解析相对路径。旧同名本地插件经 CLI 移除，其他包、模型与凭据保留。运行中的 Pi Web 尚未加载插件时，由用户等待任务结束后重启；Orb 不擅自重启已有服务。

已有健康服务直接复用；未运行则定位已安装 Pi Web 包，隐藏启动 Next.js 正式生产入口，等待就绪，不打开浏览器/控制台。源码版首次选择 bin/pi-web.js 并需先完成生产构建。端口被其他服务占用时拒绝，不杀进程。开发模式或显式 PI_ORB_CONFIG 探针不执行个人安装准备。

单实例锁在 bridge/快捷键初始化前取得；重复启动经既有 showOrb/presentOrb 唤回，初始化中的唤回等窗口就绪。退出保留共享后端。工作区与授权分别见 [会话](workspaces-sessions.md)、[权限](access-lifecycle.md)。

启动入口与插件摘要保存在 Orb userData 的 startup-runtime.json，不保存密码；错误保留配置并报告原因。日志和设置备份文件名以 [personal-startup](../src/main/personal-startup.ts) 为准。

卸载前通过专用短进程调用 Pi remove，按归属清理 App Paths；保留历史、模型、凭据与工作区。Node/Pi 不可用则提示手动移除插件，不静默删除用户数据。实现：[NSIS hooks](../resources/installer.nsh)、[单实例](../src/main/index.ts)。

来源：旧单体 72f1d738458a223696685a909e806b683eff5885（MIT）的 apps/desktop/scripts/electron-builder-config.mjs、apps/desktop/src/main.ts、welcome-api.ts；复用每用户 NSIS、唤回与必要文件选择。Pi 官方包登记和单实例锁是宿主适配；不搬 dsh Node/host 管道或完整设置页。出处见 [取材入口](reference-playbook.md)。证据：[后端启动](../evidence/personal-startup/backend-startup.json)、[安装数据保护](../evidence/personal-startup/installer-smoke.json)、[升级](../evidence/windows-startup-and-workspaces/current-user-upgrade.json)。
