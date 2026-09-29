# pi-orb 文档

本目录集中保存 pi-orb 的开发目标、技术栈建议和相关能力评估。当前内容属于开发前研究与决策材料，不代表产品已经实现或通过全部验收。

## 文档索引

| 文档 | 用途 | 状态 |
|---|---|---|
| [`reference-playbook.md`](./reference-playbook.md) | **开发取材入口**：参考项目本地检出、取材优先级、可复用／不可复用清单、必须一致的常量与交互规格、各任务作业流程、上游同步与提交前检查 | 随参考提交和实现变化维护 |
| [`pi-orb-development-goals.md`](./pi-orb-development-goals.md) | 产品目标、非破坏性合同、目标架构、P0/P1/P2 优先级、验收矩阵和阻塞规则 | 开发目标与验收基线 |
| [`tech-stack.md`](./tech-stack.md) | 技术栈建议、选型依据、版本边界、P0 验证门槛和明确非目标 | 技术选型建议，待验证 |
| [`support-matrix.md`](./support-matrix.md) | 唯一的版本兼容性声明来源：已验证 / 未验证 / 已知环境事实 | 随每个发布版本维护 |
| [`pi-orb-reuse-assessment.md`](./pi-orb-reuse-assessment.md) | 参考项目复用边界、当前 P1 状态和最短解阻塞路径 | 随能力和证据变化维护 |
| [`p2-01-reference-reuse.md`](./p2-01-reference-reuse.md) | DeepSeek Orb 固定提交、本地检出和 P2-01 复用／适配记录 | P2-01 阶段记录 |
| [`p2-05-distribution.md`](./p2-05-distribution.md) | P2-05 Windows x64 打包与分发：参考来源与不搬清单、三个非默认决定、自动化边界与人工项 | P2-05 阶段记录 |
| [`manual-acceptance.md`](./manual-acceptance.md) | 唯一的人工验收入口：前置条件、A–D 加 E 组（安装包）步骤、记录规则与结果回写位置 | 需要真实按键／多屏／高权限窗口／真实模型／干净机安装时使用 |
| [`cua-driver-integration.md`](./cua-driver-integration.md) | **历史** Cua 驱动探针：坐标空间、投递模式约束、会话与授权、许可义务 | P1-05 迁移前运行时记录；不代表当前生产 backend |
| [`../evidence/p1-07/CONTRACT-MATRIX.md`](../evidence/p1-07/CONTRACT-MATRIX.md) | P1 合同对照：N1–N8 不变量与 §7.1 发布必测项的证据映射（含未验证项） | 随每个发布版本维护 |
| [`pi-fff-lsp-necessity.md`](./pi-fff-lsp-necessity.md) | FFF 与 LSP 对当前 Pi 工作流的需要程度评估 | 可选开发工具评估，不属于运行时依赖 |

## 相关文件

| 文件 | 用途 |
|---|---|
| [`../README.md`](../README.md) | 项目说明、仓库结构、开发命令与依赖 |
| [`../CHANGELOG.md`](../CHANGELOG.md) | 版本历史与版本号策略 |
| [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) | 第三方组件许可、MPL 归属核实与源码获取路径 |
| [`../LICENSE`](../LICENSE) | 项目自身 MIT 许可 |
| [`../evidence/README.md`](../evidence/README.md) | 可复现的验证证据索引 |

## 阅读顺序

1. 要写代码前先读 [`reference-playbook.md`](./reference-playbook.md)，确定这块能力在参考项目里对应哪个文件、什么语义。
2. 再读开发目标，了解产品范围和不可破坏的不变量。
2. 再读技术栈文档，区分已确定方向、推荐选型和实施前验证项。
3. 需要版本兼容性或“这个组合能不能用”的判断时，只读支持矩阵。
4. 需要在真实桌面上做人工验收（真实按键、多屏、高权限窗口、真实模型在环）时，只读 [`manual-acceptance.md`](./manual-acceptance.md)。
5. 需要评估代码搜索或语义开发辅助时，再读 FFF/LSP 报告。

## 文档维护约定

- 文档中的“已确定”仅表示产品方向已确定，不等于实现已经验证。
- 没有经过对应 P0/P1/P2 验收的版本、驱动、平台或 API 组合，统一标记为“未验证”，不宣称兼容。
- **版本兼容性只写在 [`support-matrix.md`](./support-matrix.md) 一处**，其它文档不另行声明支持范围；新增或取消支持必须同时更新该文件与 [`../CHANGELOG.md`](../CHANGELOG.md)。
- 引用当前仓库之外的资料时保留来源 URL、版本或提交；引用缺失的历史调研不补造内容。
- 参考项目的固定提交、本地检出位置、取材优先级和复用清单只在 [`reference-playbook.md`](./reference-playbook.md) 维护；每次复用新文件或参考提交变化时同步更新该文件。
- 产品实现不得以文档中的推荐项为依据绕过用户授权、上游接入门槛或非破坏性测试。
- 每完成一个开发任务，在同一次交付中完成对应文档沉淀：新增事实写入本目录，可复现验证写入 `evidence/`，不把事实留在会话记录里。
