# 打包

适用于 Windows x64 每用户 NSIS 与独立 Pi 插件资源。

安装器不请求提权，不包含 Pi Web/Node，不配置自动更新。构建版本、文件过滤、原生解包与安装行为以 [builder 配置](../electron-builder.config.mjs)、[manifest](../package.json) 和 [NSIS](../resources/installer.nsh) 为准。

使用锁定依赖的预编译 N-API 二进制，关闭 npmRebuild；审计版本、实际包内容和二进制散列，拒绝源代码、测试、精选 evidence、凭据、非目标平台与 Koffi 头文件。插件单独构建，随 resources 分发，不复制 SDK 依赖。

来源：旧单体 `apps/desktop/electron-builder.config.yml` 与 `apps/desktop/scripts/` 的 Electron 打包形态。未复用 dsh 单体企业发布管道、Cordis npm bundle 和自动 updater，因为 Pi 使用独立插件与每用户安装器。许可见 [第三方声明](../THIRD_PARTY_NOTICES.md)。

必须验证同一次最终安装器构建的包内容、真实 Pi loader 和打包启动；成功构建不代替运行证据。执行策略见 [验证策略](verification.md)，发布流程见 [发布](release-process.md)。
