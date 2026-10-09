# 参考取材入口

适用于移植、适配与上游同步。行为规则按 [主题导航](README.md) 查找，不在本页重复。

| 来源 | 固定提交 | 本地只读检出 |
|---|---|---|
| [当前插件](https://github.com/mini-yifan/dsh-orb-cordis) | aa79308e47265b7d4a774edb688de2bbd7dce66e | D:\pi-orb-ref\dsh-orb-cordis-20261009 |
| 旧插件，仅历史差异 | 9cdc50302d202f4497569731be488a8afa500da7 | D:\pi-orb-ref\dsh-orb-cordis |
| [旧单体](https://github.com/rain-knows/deepseek-harness-orb) | 72f1d738458a223696685a909e806b683eff5885 | D:\pi-orb-ref\deepseek-harness-orb |

旧单体 sparse checkout 只有 apps/desktop/src 与 packages；renderer、scripts、tests 可看同提交完整检出 C:\Users\JUSTLIKEZYP\AppData\Local\Temp\deepseek-harness-orb-pi-orb，或添加 sparse 目录。检出位置不是运行时依赖。

取材先核对 HEAD，再定位原文件。GUI 从 packages/computer-use/src/ 开始，浮窗从 packages/helper/assets/ 和 packages/helper/src/geometry.ts 开始，后台从 code-agent*.ts 开始；旧单体原生实现从 packages/experimental/tool-computer-use/ 开始。详细原文件与宿主差异在所属主题，完整当前同步文件处置在 [来源记录](../evidence/reference/reference-manifest.json)。

能移植就直接移植，不重写等价实现。不能直接移植时在所属主题记录原仓库、文件、提交、许可证、复用方式和未复用原因，再实现最小 Pi 适配。保留文件来源头与 [第三方声明](../THIRD_PARTY_NOTICES.md)；上述源码均按 MIT 保留版权，不称为本项目原创。

上游更新先核对差异与源提交，只对相关能力同步。来源散列变化需重新核对，不修改旧报告冒充新结论。参考记录只记录取材/散列，不替代行为回归；执行入口见 [来源证据](../evidence/README.md)。
