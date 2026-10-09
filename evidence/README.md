# 精选事实记录

| 目录 | 用途与范围 | 执行入口 |
|---|---|---|
| [access](access/README.md) | 权限、工具暴露与会话/工作区撤权 | node tests/integration/tool-exposure.mjs；node tests/integration/lifecycle.mjs [--workspace-ui] |
| [desktop](desktop/README.md) | 隔离目标点击、滚动、输入、可见浏览器及应用启动有限真实模型样本 | node tests/integration/desktop.mjs c7|d6-scroll|d8-type|browser|open-app |
| [background](background/README.md) | 后台完成、停止与失败的有限真实模型样本 | node tests/integration/background.mjs complete|stop|failure |
| [startup](startup/README.md) | 后端隔离启动、安装数据保留与当前用户启动器历史记录 | node tests/integration/backend-startup.mjs <绝对 bin/pi-web.js>；node tests/integration/installer.mjs；node tests/integration/installed-runtime.mjs |
| [ui](ui/README.md) | 当前参考同步后的打包界面夹具 | node tests/integration/ui.mjs |
| [packaging](packaging/README.md) | 记录构建的包内容、Pi loader 和实际启动；旧记录不能证明当前构建 | node scripts/verify/package.mjs；各子步骤见 scripts/verify/ |
| [reference](reference/README.md) | 源提交、逐文件处置、许可与散列；报告中的旧散列只代表当时文件 | node scripts/verify/reference.mjs；node scripts/verify/licenses.mjs |
| [diagnostics](diagnostics/README.md) | 尚未解释的 native 退出、原生压力样本与包内容拒绝反证 | node tests/integration/native-stress.mjs；退出记录原始入口在 Git 历史，当前相关路径见 tests/integration/desktop.mjs，拒绝反证入口为 scripts/verify/package-audit.mjs |

所有新输出默认在被忽略的 runs/ 下，每次使用独立目录。精选记录保持原内容、运行身份和历史路径字段；迁移未改变其散列。来源注释和文档引用改变后，旧 reference-manifest 不证明当前文件散列通过。支持结论变化、发布或关键故障才人工选取报告提交，旧实验从 Git 历史追溯。

依赖 Pi Web 的探针要求 PI_ORB_EVIDENCE_PI_WEB 指向已完成生产构建的宿主包；不克隆旧快照，不修改宿主源码、用户配置或共享服务。真实模型配置与凭据仅复制到用户临时目录并在退出时清理，不以硬链接或符号链接连接可写用户文件。桌面探针需要隔离目标与空闲桌面；真实模型入口有实际调用费用。installer 入口仅用于干净测试账户并拒绝已有安装，installed-runtime 仅检查已运行实例。先按 [验证策略](../doc/verification.md) 选择相关场景。
