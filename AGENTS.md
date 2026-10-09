# pi-orb 开发约束

## 参考项目优先

本项目的产品形态、窗口结构、交互流程、视觉组件和架构方案必须优先直接复用
[`rain-knows/deepseek-harness-orb`](https://github.com/rain-knows/deepseek-harness-orb)。目标是基于 Pi
做参考项目的等价实现，而不是重新设计一套 Orb。

本项目的产品定位是：**基于 pi-web 的非破坏式功能扩展**。pi-orb 通过 Pi 的插件体系、Electron
悬浮窗和小型适配模块接入现有 pi-web；不复制或改写 pi-web 的会话引擎、模型循环、凭据管理和
插件加载机制。普通 pi-web 会话必须保持原有行为，Orb 能力只在专用工作区和明确授权下出现。

参考项目的本地只读检出位置（按优先级）：

| 位置 | 说明 |
|---|---|
| `D:\pi-orb-ref\dsh-orb-cordis-20261009` | 当前插件参考：原作者 `mini-yifan/dsh-orb-cordis`，固定 `aa79308e47265b7d4a774edb688de2bbd7dce66e`；窗口、Computer Use 与后台任务先看此检出，入口见取材手册 |
| `D:\pi-orb-ref\dsh-orb-cordis` | 旧插件检出，固定 `9cdc50302d202f4497569731be488a8afa500da7`，仅用于历史差异核对 |
| `D:\pi-orb-ref\deepseek-harness-orb` | **本机优选检出**；注意它是 sparse checkout（只含 `apps/desktop/src` 与 `packages`），打包脚本／测试目录不在其中 |
| `C:\Users\JUSTLIKEZYP\AppData\Local\Temp\deepseek-harness-orb-pi-orb` | 完整工作树检出（同提交）；**需要 `apps/desktop/scripts`、`apps/desktop/tests` 时看这里** |
| `C:\Users\JUSTLIKEZYP\AppData\Local\Temp\deepseek-harness-orb-research` | 只读研究检出，同提交 |

旧单体仓库的三个检出都固定在源提交 `72f1d738458a223696685a909e806b683eff5885`，只用于核对和移植，
不作为 pi-orb 的运行时依赖；源码复用仍须在本仓库保留来源提交、许可证和适配说明。
开发前先核对 `git -C D:\pi-orb-ref\deepseek-harness-orb rev-parse HEAD` 与该提交一致；
需要 sparse 检出里没有的目录时，用 `git sparse-checkout add <目录>` 或改看完整检出，
不要凭记忆描述参考实现。

**开发时的取材入口固定为 [`doc/reference-playbook.md`](./doc/reference-playbook.md)**：
它给出参考文件索引、常量和交互规格、可复用／不可复用清单、各任务的作业流程以及与上游
同步的步骤。新功能先在该手册定位参考实现，再决定移植或适配；不要凭印象“照参考风格写”。

- 能直接移植参考项目代码、组件、样式或状态模型时，禁止自行重写等价实现。
- 不能直接移植时，先记录参考项目对应文件、提交和差异，再写最小适配层。
- pi-web、Pi SDK、Electron 的接入只负责替换参考项目的会话和运行时边界，不改变参考项目的用户体验和交互语义。
- 不自行增加设置、导航、权限步骤、视觉装饰或产品概念；只有参考项目没有而 Pi 接入必需的内容才允许增加。
- 每次 UI 或架构改动都要在所属主题中注明参考项目来源文件、源提交、复用方式和未复用原因。
- 参考项目代码须保留其许可证和版权声明；不得把复用内容描述为 pi-orb 原创。
- 参考项目本地检出更新后，先核对源提交和差异，再更新本仓库；不得把临时检出路径写成运行时依赖。

## 开发方式

- 先完成能端到端运行的最小复用，再按阶段扩展。
- 删除已经废弃的路径，不保留兼容层、静默回退或重复实现。
- 独立工作单独提交，按 [验证策略](doc/verification.md) 选择必要检查；文档改动只检查引用和 diff。
- 打包与分发见 [打包](doc/packaging.md)：只复用参考打包形态，不搬 dsh 单体发布管道。
  打包改动必须验证最终安装器构建的内容、Pi 插件加载和实际启动；不得用构建成功替代内容与运行证据。
  执行 npm run verify:package；其他改动按 [验证策略](doc/verification.md) 选择检查。
