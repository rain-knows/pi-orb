# pi-orb 文档

文档按职责维护；当前行为、支持结论和阶段证据各有唯一入口。

## 当前文档

| 文档 | 负责的内容 |
|---|---|
| [项目 README](../README.md) | 安装、运行和开发命令 |
| [参考手册](./reference-playbook.md) | 开发取材入口、来源文件、固定提交、复用规则与宿主差异 |
| [开发目标](./pi-orb-development-goals.md) | 产品范围、N1–N8 不变量、架构责任与发布要求 |
| [技术栈](./tech-stack.md) | 当前模块与依赖的选择理由；版本直接查 manifest/lockfile |
| [参考工具集](./reference-toolset-transition.md) | GUI 与后台工具的契约、Pi 接入边界 |
| [个人安装与启动](./personal-user-installation.md) | 随包插件、后端复用、隐藏启动、单实例与工作区切换 |
| [支持矩阵](./support-matrix.md) | 已验证、未验证与环境限制的唯一结论来源 |
| [人工验收](./manual-acceptance.md) | 当前工具、真实键盘、多屏、高权限和干净机验收步骤 |
| [发布流程](./release-process.md) | 发布顺序、预览版边界和发布证据 |
| [打包依据](./p2-05-distribution.md) | 打包形态、依赖裁剪与安装器取舍 |

## 阶段来源记录

以下文件保留各阶段的来源和适配理由，不重复维护当前状态。后来实现有变化时，追加新阶段证据，并更新上表中对应的当前文档。

| 记录 | 用途 |
|---|---|
| [前端移植](./frontend-port.md) | 首次 renderer 移植的来源、阶段与宿主适配 |
| [P2-01 复用](./p2-01-reference-reuse.md) | 观察框、菜单、renderer 的逐文件来源 |
| [Pi Web 0.10 / Pi 1.0](./pi-web-0.10-compatibility.md) | 宿主升级与完成事件适配 |
| [2026-10-09 参考同步](./reference-sync-2026-10-09.md) | 本轮上游差异的处置和来源覆盖 |
| [本机 Win+R 入口](./winr-piorb.md) | 当前账户短命令与启动脚本的验证记录 |
| [证据索引](../evidence/README.md) | 原始结果、复现脚本与历史失败 |
| [合同证据对照](../evidence/p1-07/CONTRACT-MATRIX.md) | N1–N8 与发布测试类的证据映射 |

## 维护规则

- 当前使用先读项目 README；改代码先读参考手册。
- 同一行为只在负责它的文档定义，其他页面链接过去。
- 测试计数、版本组合与验收结论放在结果 JSON 和支持矩阵，不在阶段说明中反复同步。
- 人工验收保存步骤，执行结果写入对应 evidence；支持结论只更新支持矩阵。
- 删除已废弃方案和无关调研，不保留兼容说明；历史依据可从 Git 历史和原始证据追溯。
- 新增文档前先扩展现有职责入口；只有独立来源/适配阶段才增加记录。
- 来源、许可证和未验证边界必须保留，见 [第三方声明](../THIRD_PARTY_NOTICES.md)、[贡献指南](../CONTRIBUTING.zh.md) 和 [安全说明](../SECURITY.md)。
