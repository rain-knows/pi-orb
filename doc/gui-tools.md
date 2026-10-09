# GUI 工具

适用于模型可见 Computer Use 工具和 Windows backend。

名称、参数、枚举与描述直接见 [工具定义](../src/shared/orb-tools.ts) 和 [Pi 注册](../pi-package/extensions/orb.ts)。鼠标、键盘、等待、截图和应用入口沿用参考 schema；动作串行执行，共享 GUI 锁覆盖观察与输入。

open_in_browser 使用用户默认浏览器，随后通过可见截图操作。open_app 激活或启动应用并返回实际前台新图，慢启动不伪报前置。路径入口先拒绝危险路径再检查存在性。不维护 DOM/Playwright 网关或 observe/batch 兼容入口。

前台工具声明 model-only，防止 Code mode 把图像上下文吞入脚本。宿主已有文件、搜索与问答工具按实际配置选取；不存在的能力不会自动注册。

来源：当前插件 `packages/computer-use/src/plugin.ts`、`open.ts`、`gui-lock.ts`；Windows 原生 backend 来自旧单体 `packages/experimental/tool-computer-use/`。原生调用直接移植，Pi schema/认证桥为宿主适配。许可见 [来源](reference-playbook.md)。证据：[工具暴露](../evidence/access/tool-exposure.json)、[桌面样本](../evidence/desktop/real-model-c7-session-access.json)。
