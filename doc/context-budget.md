# 上下文预算

适用于 Orb 前台模型请求；完整持久历史不改写。

工具结果文本按参考 Unicode 字符预算裁剪；精确预算和实现见 [context hook](../pi-package/extensions/computer-use-context.ts)。请求投影只保留最新一张 Orb 观察图，包括自动首帧与工具回图；保留用户图片、其他工具图片和普通会话内容。worker 不使用前台图像投影。

来源：插件参考 `packages/computer-use/src/policy.ts` 与 `presets/computer-use/agent.cordis.yml`，旧单体 `packages/compaction/compaction-tool-result-pruner/src/index.ts`。移植 policy 和裁剪算法；Pi 公共 context hook 替换 Cordis surface 写入，最新 Orb 图像投影属于宿主适配。

回归：[文本与图片预算](../tests/computer-use-context.test.ts)。真实 loader 见 [插件加载记录](../evidence/personal-startup/plugin-load.json)，支持和性能边界见 [支持范围](support-matrix.md)。
