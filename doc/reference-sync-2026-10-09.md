# 2026-10-09 参考项目完整同步

> 阶段来源记录：保留实施时的事实与结果，不随当前版本同步。当前行为见参考手册与工具契约，支持结论只见支持矩阵。

## 固定来源与范围

插件参考从 `9cdc50302d202f4497569731be488a8afa500da7` 更新到原作者
[`mini-yifan/dsh-orb-cordis@aa79308e47265b7d4a774edb688de2bbd7dce66e`](https://github.com/mini-yifan/dsh-orb-cordis/commit/aa79308e47265b7d4a774edb688de2bbd7dce66e)。
rain-knows 镜像仍在旧提交。旧单体参考从 `72f1d738458a223696685a909e806b683eff5885`
到 `51f09764d7ff99947be08ebbb2ca2388faab3df4` 只有 Windows 发行身份修复。
旧检出保持原位；新检出只作为开发取材，不是运行时依赖。
本次逐文件覆盖插件 32 个提交／47 个文件、旧单体 1 个提交／9 个文件；
没有未分类差异。固定来源、每个文件的处置理由、13 个移植入口的源码及目标 SHA-256
见 [`reference-manifest.json`](../evidence/reference-sync/reference-manifest.json)。

## 全部差异处置

| 上游更新 | 来源文件 | Pi 处置 |
|---|---|---|
| 120%/150% 吸边、3 DIP 容差、请求位置判定、系统光标拖动、显示器接缝 | helper/src/geometry.ts、main.ts、preload.cjs、assets/shell.js | 直接移植最新 FloatingPlacement 和手势；以 Electron screen/IPC 替换 helper 传输，删除 renderer 屏幕坐标路径 |
| 点击输入固定 | helper/assets/shell.js | 移植幂等 pinBall；球点击取消固定 |
| 跨会话后台书签、计时、归属颜色、未读与主窗口跳转 | computer-use/src/code-agent-registry.ts、host/src/orb.ts、helper/assets/floating.{html,css}、shell.js | 复用 UI/几何；已有 Pi 管理器提供进程内书签，以 Pi Web 公开会话 URL 打开后台，不切换 Orb 前台 |
| 完成通知上屏、默认折叠、防压缩、只为 code_agent 通知建卡 | helper/assets/shell.js、chat.css、host/src/orb.ts | 复用折叠报告卡和 flex 规则；Pi SSE/历史提供内容，通知独立于流式回复 |
| 主窗口停止禁止自动重启、停止书签 | computer-use/src/code-agent-completion.ts、code-agent-registry.ts | Pi 最终 assistant stopReason: aborted 判定，通知保留禁止重启指令；产品工具 stop 仍撤销通知 |
| GUI 全局互斥和其他会话在场时文本通知 | computer-use/src/gui-lock.ts、plugin.ts、code-agent-completion.ts | Electron DesktopBroker 已全局独占输入与观察且只允许当前 session/generation；补共享锁及冲突提示，前台切换保留撤权；后台通知只向当前 idle owner 投递 |
| 输入路径在 realpath 前禁止系统路径 | computer-use/src/open.ts | 移植前置校验，保留 realpath 后校验防符号链接 |
| 观察框彩带开关 | host/src/preferences.ts、overlay-guard.ts、client-settings/client.js | 复用默认开启语义；Pi 没有插件设置页写入接口，以 Orb 原生菜单与自有配置实现 |
| 顶层 registry 挂载修复 | computer-use/src/code-agent.ts、bundle/cordis.patch.yml | Pi 管理器本来在 Electron 顶层唯一创建；不搬 Cordis realm/provider |
| npm 分发、自更新、发布年龄豁免、integrity 与 pnpm 失败显示 | host/src/update.ts、routes.ts、client-settings/client.js、bundle/scripts/pack.mjs | dsh 插件发行链，非 pi-orb NSIS 更新；按手册 §9.4 不搬，保持无自动更新源 |
| 首次下载运行时提示、重试与安装参数 | host/src/electron-runtime.ts、index.ts、bundle/tests/install.test.mjs | 参考动态下载 helper Electron；pi-orb 已随 NSIS 分发 Electron，无运行时下载阶段 |
| Windows 应用身份、图标一致、允许提权升级旧 per-machine 安装 | 单体 apps/desktop/scripts/electron-builder-config.mjs、src/main.ts | pi-orb 保持自己已经发布的 appId、π 图标与 HKCU 每用户身份；不存在 DeepSeek Program Files 安装，不搬提权 |
| LibreOffice 长路径 junction smoke | 单体 apps/desktop/scripts/smoke-packaged-runtime.ts | pi-orb 不含 LibreOffice/dsh runtime，现有 P2-05 审计及打包 smoke 继续执行 |
| 发布版本、README、忽略 RELEASE.md 和对应测试 | README*、package.json、tests/* | 来源版本只作为固定来源；测试移植适用判据，Pi 文档/许可证/证据同步，历史证据不改写 |

复用许可为 MIT（mini-yifan / DeepSeek），来源头与 THIRD_PARTY_NOTICES.md 同步。
自动更新与非 Windows 平台支持范围保持现有产品边界。

## 适配细节

- 书签沿用上游进程生命周期、运行任务优先、计时、四色会话归属和未读语义。
  Pi Web 的公开会话摘要提供来源标题，复用上游 10 秒缓存；已读的结束任务移除，
  运行任务仍显示。点击调用公开 `?session=<id>` URL，只有显式点击时打开一次，
  不在轮询中导航。后台管理器继续持久保存所有权和待投递通知。
- 仅识别 `code_agent` 完成／用户停止前缀为默认折叠的报告卡；普通用户消息、
  系统前台信息和模型回复保持现有渲染。复用披露组件/CSS，以 `textContent` 显示正文，
  不为此增加 Markdown 渲染依赖。禁止自动重启的指令传给模型，界面隐藏该指令。
- 上游通过跨会话自动唤醒补发通知；Pi 只向当前空闲 owner 投递，其他 owner 保留待投递。
  因此不新增上游的 screen-busy 文字后缀，当前 session/generation 授权边界继续有效。
- 旧 renderer 坐标移动和 clamp IPC 已删除。直接移植 FloatingPlacement，由主进程读取
  Electron OS 光标和显示器 DIP；仅添加已有系统减少动画偏好。实际视觉检查发现
  Pi 的 36px 停止按钮旧定位覆盖了书签定位，已按 strip 宽度修正，保留既有 caret 防重叠规则。
- 观察框开关默认开启，以原生菜单实现，持久保存到 Orb 自有 userData，关闭立即隐藏；
  不写 Pi Web 设置、模型、凭据或插件加载配置。

## 验证

| 检查 | 本轮结果 | 证据 |
|---|---|---|
| 类型／Lint／全量 Vitest | 通过，52 个文件／518 项测试 | `npm run typecheck`、`npm run lint`、`npm test` |
| 最新插件与单体差异覆盖、移植 SHA-256／许可 | 全部分类，13 个移植入口通过 | `evidence/reference-sync/reference-manifest.json` |
| 旧单体模块来源审计 | 11 个剩余模块，零缺失／零无来源头 | `evidence/p1-07/provenance.json` |
| Windows 解包构建 → 内容审计 → 真实 Pi 加载 → 启动 | 四步通过；内容审计 30/30、插件加载 15/15、打包 smoke 23/23 | `evidence/p2-05/stage-result.json`、`evidence/personal-startup/plugin-load.json` |
| 最新 UI 真实打包窗口探针 | 18/18；书签归属/标题、停止报告、折叠/展开、按钮定位、准确会话 URL、已读移除、开关保存 | `evidence/reference-sync/ui-probe.json` |

直接移植全部 21 条 FloatingPlacement 与 4 条 GUI 锁规格测试；新增 Pi broker 争用、
禁止路径前置校验、用户停止通知防重启、后台所有权/继续任务、菜单/偏好与 renderer 回归。
新版截图已人工目视检查，停止按钮位于输入条内，书签与报告没有遮挡。

本轮 UI 探针运行真实打包 Electron，但 Pi Web 使用确定性 HTTP/SSE 夹具，外部导航与
原生菜单在该独立进程中捕获；证明真实 IPC、布局、指定 URL 与偏好保存，不代表真实
模型任务或浏览器最终页面验证。既有 Computer Use 参数/原生后端未改变，本轮未重复
消耗真实模型执行桌面任务。120%/150% 量化和多屏接缝由上游规格模拟覆盖；
不据此扩大支持矩阵中的实际多屏/DPI、干净机安装、卸载、升级或非 Windows 验证范围。

复现入口见 [`evidence/reference-sync/README.md`](../evidence/reference-sync/README.md)。
