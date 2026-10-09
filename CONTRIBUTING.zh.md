# 为 pi-orb 贡献代码

[English](CONTRIBUTING.md) | 中文

感谢你考虑为 pi-orb 提交贡献。这是一个约束比较特殊的小项目，动手前请先读完本文件——大部分评审意见
来自下面这些规则，而不是代码风格偏好。

## 决定一切的规则：复用参考项目

pi-orb 是 [pi-web](https://github.com/agegr/pi-web) 的**非破坏式扩展**，它的产品形态、悬浮窗、
交互语言和桌面后端都**移植自** [`rain-knows/deepseek-harness-orb`](https://github.com/rain-knows/deepseek-harness-orb)
的固定提交。这意味着：

- **动手前先查** [`doc/reference-playbook.md`](doc/reference-playbook.md)，用带行号的索引确认你要改的
  行为在参考项目里由哪个文件负责、哪些常量与交互规格必须一致、什么可复用／可适配／不可搬。
- **参考项目已经实现的，直接移植，不要自己写等价实现。** 自创版本会被要求换回复用版本。
- **确实不能移植时**，先在阶段文档里记录参考文件、提交和差异，再写最小适配层。
  `doc/p2-01-reference-reuse.md` 与 `doc/p2-05-distribution.md` 是两个已完成的样例。
- **归属必须写对。** 移植代码保留 MIT 声明，并在文件头写明来源仓库、提交、原路径，同时登记到
  [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。不得把复用内容说成原创，也不得把原创说成复用
  ——`src/main/double-alt.ts` 的注释记录了这个头注释被更正的经过。
- 不自行增加参考项目没有的设置、导航、权限步骤、视觉装饰或产品概念；只有 Pi／pi-web 接入必需的
  内容才允许增加。

## 非破坏性合同

[`doc/pi-orb-development-goals.md`](doc/pi-orb-development-goals.md) 的 N1–N8 是**要求**，不是期望。
简版：

- cwd 不是已配置 Orb 工作区的普通会话，**不新增**任何工具、命令或 prompt section。
- pi-orb 只连接已存在的 pi-web；不启动、不重启、不升级、不关闭不是自己启动的实例，
  也不写入 pi-web 的工作树或 `node_modules`。
- 安装、关闭或卸载 pi-orb 不删除任何用户文件与历史。
- 撤权（收起、停止、断连、换会话、锁屏、退出）必须释放按键、鼠标、锁与监听器，并撤销桌面授权与
  已记录目标。

## 环境搭建

受支持平台只有 Windows x64；已验证的版本组合见 [`doc/support-matrix.md`](doc/support-matrix.md)。

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

两个常见的坑：

- npm 11 默认拦截依赖安装脚本。`package.json` 里已声明 `allowScripts`，否则 Electron 二进制不会下载；
  若 `node_modules/electron/dist` 为空，构建与所有打包探测都会以难以理解的方式失败。
- `PI_ORB_*` 环境变量（pi-web 地址、密码、配置路径）见 [README](README.md#environment)。

## 验证是改动的一部分

本仓库的每条结论都有可重跑的脚本支撑。PR 需要**在同一次提交里**带上它所改内容的证据：

| 你改了什么 | 跑什么 | 记录到 |
|---|---|---|
| 任意改动 | `npm run typecheck && npm run lint && npm test` | — |
| 任意改动 | `node evidence/p1-07/run-release-gate.mjs` | `evidence/p1-07/release-gate.json` |
| 桌面后端、坐标、工具 | `node evidence/p1-06/run-p1-06-tools.mjs` | `evidence/p1-06/tool-exposure.json` |
| 打包、图标、依赖 | `node evidence/p2-05/run-p2-05.mjs` | `evidence/p2-05/*.json` |
| 只能由人判断的项 | [`doc/manual-acceptance.md`](doc/manual-acceptance.md) | 对应 evidence 结果；支持结论只更新支持矩阵 |

发布门禁会替你执行下列规则：

- **不得为了让检查变绿而放宽断言。** 断言站不住，要么行为错了、要么测试错了——在提交信息里说清是哪个。
- **未验证就保持未验证。** 没有在真实桌面测过的能力写在 `doc/support-matrix.md` 的「未验证」表里；
  没有可复现证据不得移到受支持表。
- **删记录不是修复。** 门禁要求验收记录及其未验证项继续存在，因此发布无法靠删掉做不到的项目变绿。
- **门禁检查必须可证伪。** 每条检查都是因为抓到过问题才存在；新增时请在提交信息里说明「什么情况会让它失败」。

## 提交与阶段

工作按小而可单独评审的阶段交付，每个阶段有自己的文档与提交（`P1-01` … `P1-07`、
`P2-01` … `P2-05`）。一次阶段提交应在同一个改动里更新：

- 代码及其测试；
- 对应的 `evidence/<阶段>/` 记录（**重新生成**，不要手改）；
- [`CHANGELOG.md`](CHANGELOG.md)；
- 若已验证／未验证状态发生变化，更新 [`doc/support-matrix.md`](doc/support-matrix.md)
  （它是版本兼容性的唯一来源，不得在其它地方另行声明支持）；
- 涉及架构或新复用参考材料时，补 `doc/` 下的阶段文档。

提交信息请写清「之前哪里不对、现在凭什么认为对了」。历史是本项目的推理记录，写「fix stuff」会让
下一个读者多花一个下午。

## 许可

pi-orb 使用 MIT 许可。提交贡献即表示你同意以相同许可提供该贡献。不要引入与本项目再分发相冲突的
依赖——门禁会因 AGPL/GPL-3/SSPL 组件而失败，并要求每个生产依赖声明其许可。

## 报告安全或安全问题

任何可能被利用的问题请**不要**开公开 issue，见 [`SECURITY.md`](SECURITY.md)。
