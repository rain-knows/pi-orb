# 产品合同

适用于 Orb 插件、桌面壳和安装流程。

普通工作区不新增 Orb 工具、命令或提示段；专用工作区只在明确授权下获得桌面能力。沿用 Pi 的模型循环、凭据、插件加载和 Pi Web 会话，不复制它们。

不得静默改动用户模型、凭据、主题、其他插件或全局默认值。不得写入 Pi Web 源码或依赖目录；已有服务不得擅自重启、升级或终止。每个前台会话只有一个控制者，后台独立执行；禁止两条消息流重复写入同一会话。

停止、关闭、卸载和切换保留工作区文件与 Pi Web 历史。资源和输入随授权撤销；工作区是归属边界，不是文件系统沙箱。接口按当前宿主适配，不保留废弃路径或静默回退。

实现：[插件](../pi-package/extensions/orb.ts)、[会话](../src/main/orb-session.ts)、[个人启动](../src/main/personal-startup.ts)。安全边界见 [SECURITY](../SECURITY.md)，授权规则见 [权限生命周期](access-lifecycle.md)。

来源：当前插件参考的 `docs/02-architecture.md`；宿主替换原因见 [进程边界](process-boundaries.md)。固定提交与许可证见 [取材入口](reference-playbook.md)。
