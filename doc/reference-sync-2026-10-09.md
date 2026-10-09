# 2026-10-09 参考项目完整同步

## 固定来源与范围

插件参考从 `9cdc50302d202f4497569731be488a8afa500da7` 更新到原作者
`mini-yifan/dsh-orb-cordis@aa79308e47265b7d4a774edb688de2bbd7dce66e`。
rain-knows 镜像仍在旧提交。旧单体参考从 `72f1d738458a223696685a909e806b683eff5885`
到 `51f09764d7ff99947be08ebbb2ca2388faab3df4` 只有 Windows 发行身份修复。
旧检出保持原位；新检出只作为开发取材，不是运行时依赖。

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

## 验证

实施中。完成时记录类型、Lint、全量单测、来源覆盖及打包运行结果。
