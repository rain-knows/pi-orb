# 支持范围

本页是已验证范围与限制的唯一结论；其他页面只引用本页。版本直接见 [manifest](../package.json)、[插件](../pi-package/package.json) 和 [锁文件](../package-lock.json)。历史记录只证明记录中的环境和构建。

| 范围 | 已有事实 | 精选记录 |
|---|---|---|
| Windows 11 x64 / Pi Web 0.10 / Pi 1.0 接入 | 本机运行、插件装配及会话生命周期；不是宿主全量测试结论 | [生命周期](../evidence/access/session-access-regression.json)、[工具暴露](../evidence/access/tool-exposure.json) |
| 桌面操作 | 隔离目标有限点击、滚动、输入、可见浏览器及应用启动样本 | [点击](../evidence/desktop/real-model-c7-session-access.json)、[滚动](../evidence/desktop/real-model-d6-scroll-session-access.json)、[输入](../evidence/desktop/real-model-d8-type-session-access.json)、[浏览器](../evidence/desktop/real-model-browser-session-access.json)、[应用](../evidence/desktop/real-model-open-app-session-access.json) |
| 后台任务 | 独立 worker 完成、停止、失败读取与归属通知 | [后台规则及证据](background-tasks.md) |
| 个人启动与升级 | 开发机隔离安装探针、生产后端启动、当前用户升级和本机启动器实测 | [启动](../evidence/startup/backend-startup.json)、[安装](../evidence/startup/installer-smoke.json)、[升级](../evidence/startup/current-user-upgrade.json)、[启动器](../evidence/startup/runtime.json) |
| 浮窗 | 当前参考同步后的打包界面与交互夹具 | [界面](../evidence/ui/ui-probe.json) |
| 分发 | 记录中的包内容、真实 Pi loader、实际打包启动 | [审计](../evidence/packaging/package-audit.json)、[加载](../evidence/packaging/plugin-load.json)、[启动](../evidence/packaging/packaged-smoke.json) |

## 未验证与限制

多显示器、DPI 变化、高权限窗口、广泛跨应用流程和不同 Chromium 内容输入稳定性未验证。仅支持当前 schema 的 screen_index；没有其他平台的支持声明。

真实键盘（包括 AltGr）、锁屏/休眠恢复与 UI Automation 跨应用体验需人工验收。干净机器安装、卸载、升级、中文/UNC 路径的完整矩阵和未签名 SmartScreen 体验尚未完成。本机成功不等同干净机支持。

原生长压力有成功样本，但历史真实模型 native 退出原因未解释；保留 [退出样本](../evidence/diagnostics/real-model-fraction-recheck-logged.json)、[压力样本](../evidence/diagnostics/native-callback-stress.json) 和 [包拒绝反证](../evidence/diagnostics/package-audit-koffi-headers-rejected.json)，不把反证改写为通过。

宿主未加载的网络工具不会自动出现；后台没有独立模型偏好配置。尚无上下文预算调整后的同任务 token/耗时对照。Pi Web 全量测试不属于本仓库通过声明。验证命令与分层要求见 [验证策略](verification.md)。
