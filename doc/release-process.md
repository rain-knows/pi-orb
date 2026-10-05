# 发布流程（Windows x64 预览版）

本文件说明 pi-orb 目前**怎么发布**、发布出来的东西是什么、以及为什么它还不是一次 v0.1 正式发布。
产品边界与未验证项的唯一来源仍是 [`support-matrix.md`](./support-matrix.md)；安装后的行为验收步骤在
[`manual-acceptance.md`](./manual-acceptance.md) §9。

## 1. 当前发布形态：预览版，不是 v0.1

| 事实 | 后果 |
|---|---|
| 安装包**未签名** | Windows 可能提示「未知发布者」；实际 SmartScreen 体验仍按 `manual-acceptance.md` §9（E9）标为未验证 |
| 发布门槛**未满足** | 多显示器、高权限窗口、Chromium 内容输入、干净机安装／卸载／升级仍未验证（`support-matrix.md` §3） |
| 因此每个 release 都标为 **prerelease** | 不得被当作完整 v0.1；release notes 必须带上未验证清单 |

发布不等于「目标达成」。项目目标里的「完整 v0.1 发布」一行仍写着**未完成**，只有 §3 的未验证项
都得到结论后才会改变——这与发布一个预览版并不矛盾：预览版是让人**能拿到东西试用**，
而不是宣称它已经完成。

## 2. 触发方式

`.github/workflows/release-preview.yml`，两种入口：

| 入口 | 用途 |
|---|---|
| **手动 `workflow_dispatch`** | 需要显式输入 `confirm_unsigned=unsigned`。这是刻意的摩擦：公开发布一个未签名二进制应当是一个决定，而不是顺手一点 |
| **推送 `v*` tag** | tag 本身就是那个决定 |

没有任何 push／pull_request 会自动发布。

## 3. 发布时实际执行的顺序（以及为什么是这个顺序）

1. **跑发布门禁** `evidence/p1-07/run-release-gate.mjs`——
   不允许从一个通不过自己门禁的提交发布任何东西。
2. **在 release runner 上重建并重新验证** `node evidence/p2-05/run-p2-05.mjs`——
   这一步是整个流程里最容易被做错的地方，见 §4。
3. **断言本次产物的审计与探测都通过**（读刚刚写出的
   `package-audit.json` / `packaged-smoke.json` / `stage-result.json`），任一不过即中止。
4. **构建安装包** `npm run package:win`。
5. **收集证据并计算哈希**：安装包、blockmap、三份 P2-05 记录、`release-gate.json`，
   外加 `SHA256SUMS.txt`。
6. **生成 release notes** 并创建 **prerelease**（见 §5）。

## 4. 为什么必须在 release 机器上重新验证

仓库里的 `evidence/p2-05/package-audit.json` 与 `packaged-smoke.json` 是**作者本机某一次运行**的记录；
它们证明的是「当时那份产物在那台机器上是什么样」，不是「这次构建出来的二进制是什么样」。
发布门禁里那两条「已记录产物审计／探测通过」的检查读的是**记录**，不是重新运行。

因此发布流程**不**把那两条检查当成对本次产物的验证，而是重新跑一遍
`run-p2-05.mjs`：产物内容审计针对**正在发布的这个构建**重算，打包产物启动探测在这台 runner 上
真的把 `pi-orb.exe` 跑起来、通过 CDP 驱动它的 renderer，并调用一次真实桌面窗口枚举
（这也是 koffi 确实从 `app.asar.unpacked` 加载成功的唯一外部观测）。

`run-packaged-smoke.mjs` 会启动一个真实窗口并枚举真实桌面，因此该 job 必须跑在
Windows runner 上；runner 给不出可用会话时它会**失败**，不会静默跳过。

## 5. release notes 不能省略未验证清单

notes 由 `doc/support-matrix.md` 与 `doc/manual-acceptance.md` 现场生成，并带两条断言：

- support matrix 里必须仍含「未验证」字样，否则**直接抛错中止**；
- 人工验收里必须仍有安装包章节（E 组）。

也就是说，把未验证清单删掉之后，发布流程会失败而不是发一个看起来没问题的包。
notes 里同时保留：未签名提示与「不要为此关闭安全设置」、未验证项清单、以及指向 `SECURITY.md`
的授权说明（工作区不是沙箱、截图内容是未受信输入）。

未验证清单直接抽取本次提交的 support matrix §3，不再维护手写子集；另附本版改进、
同版本插件安装入口和新会话默认 Full Access 的说明。当前安装器分发 Electron 桌面壳和
独立 Pi 插件，通过已安装 Pi CLI 自动注册；Pi Web 和 Node 仍由用户安装。源码开发时才
通过 `pi install <repo>/pi-package` 注册源码插件。

## 6. 一次发布留下的东西

| 产物 | 用途 |
|---|---|
| `pi-orb-<version>-win-x64.exe` | 每用户 NSIS 安装包（未签名） |
| `*.blockmap` | electron-builder 默认产物；当前无更新源，仅随包保留 |
| `SHA256SUMS.txt` | 安装包哈希，供下载者校验 |
| `package-audit.json` / `packaged-smoke.json` / `stage-result.json` | **本次**产物的 P2-05 证据 |
| `release-gate.json` | 允许本次发布的门禁运行结果 |
| `release-notes.md` | 上面那份 notes 的原文 |

## 7. 发布之后不要做的事

- 不要因为「已经有 release 了」就把 `support-matrix.md` 里的未验证项挪到已验证表——
  发布预览版**不**产生任何新的验证结论。
- 不要为了让 notes 好看而改手动写的文案：notes 的内容由上面的断言约束。
- 正式发布的门槛仍是 [`pi-orb-development-goals.md`](./pi-orb-development-goals.md) 里那条
  「完整 v0.1 发布」：§3 的未验证项要有结论，结论由人工验收给出，不由发布行为给出。

## 8. CI 与发布的区别

| | CI（`ci.yml`） | 发布（`release-preview.yml`） |
|---|---|---|
| 触发 | 每个 PR 与 main push | 手动／tag |
| 权限 | `contents: read` | job 级 `contents: write` |
| 跑什么 | typecheck、lint、单测、发布门禁 | 上面全部 + 重建产物并重新验证 + 构建安装包 + 建 release |
| 是否会产出可下载文件 | 否（只上传门禁记录） | 是 |

发布 job 的 `contents: write` 只加在**该 job** 上，不放在 workflow 级别；CI 永远拿不到写权限。

## 9. 本机作为发布机器

GitHub runner 无法完成真实桌面验收时，可以在具有交互式桌面的 Windows 发布机器上执行同一组
门禁，构建并发布该机器验证的产物。不得使用 runner 上失败的二进制，也不得删除、跳过或放宽失败断言。
release notes 必须准确说明构建机器、runner 结果及本机验证结果。

执行顺序：

1. 确认待发布 tag 的源提交与本机源码一致，跑发布门禁和完整 `run-p2-05.mjs`。
2. 执行 `npm run package:win` 构建安装器。
3. 对安装器构建生成的解包目录再跑 `run-package-audit.mjs` 与 `run-packaged-smoke.mjs`。
4. 断言本次 JSON 全部通过、版本一致；收集 §6 的产物，计算 SHA-256，并记录源提交、构建环境和签名状态。
5. release notes 仍从本次提交的 support matrix §3 抽取完整未验证清单。先创建 draft，核对上传文件后再公开为 prerelease。

首个 `v0.1.0-preview.1` 的源提交为 `921350965e0502ea7435ac67344dd8758cdb7cb2`。
[首次 GitHub runner](https://github.com/rain-knows/pi-orb/actions/runs/36806936087) 通过发布门禁与包内容审计，
但停靠动画断言只采到 2 个位置，要求至少 4 个，流程在发布前失败；原因尚未确认。
本机完整 P2-05 通过；安装器构建后再审计 27/27、启动 22/22，停靠动画采到 9 个位置。
发布附带 `github-runner-failure.log` 和 `release-provenance.json`，不宣称 Actions 通过。
原生动作、人工安装和未验证项的边界保持不变。

## 10. preview.3（2026-10-05）

`v0.1.0-preview.3` 使用本机 Windows 发布流程（§9）。安装器包含当前参考工具集、独立
Pi 插件和启动改进；Pi Web/Node 不随包。发布门禁 66/66（无跳过），完整 P2-05 及安装器
构建后的内容审计/启动探测通过；原始记录、源提交和 SHA-256 随 Release 上传。
本次不以历史失败的 GitHub runner 产物发布，也不宣称本次 Actions runner 已通过。
后台及真实模型 GUI 有限样本验收见工具集迁移记录；完整未验证清单仍来自支持矩阵 §3。
