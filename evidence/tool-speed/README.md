# 工具调用提速证据

本目录保存 2026-09-30 至 2026-10-01 的历史提速实验，显式 observe/batch 与 pixel 模式已经删除；这些结果不作为当前工具契约或性能承诺。本目录没有凭据或截图数据；原始图片只在隔离 Pi 会话中，模型报告只提取文字、大小和调用参数。

当前工具契约见 [参考工具集](../../doc/reference-toolset-transition.md)，坐标与来源见 [参考手册](../../doc/reference-playbook.md) §6.3。历史原生退出尚未确认根因，失败与中断记录保留；下表的结果不会因新实现而覆盖。

| 文件 | 含义 |
|---|---|
| `native-baseline.json` | 冷观察、10 组单击/输入/快捷键/三控件、20 次观察；真实原生驱动和目标读回，不含模型/管道/浮窗 |
| `native-batch.json` | 10 批 A→B→C 的真实输入读回 |
| `native-batch-safety.json` | 原生窗口变化中止、Stop 中断长按、无后续输入、按键释放 7/7 |
| `wait-experiment.json` | 600/400/200ms × 5 场景 × 100 次；选择保留 600ms |
| `real-model-initial.json` | 最初未完整结束的失败探针；不计入成功结果 |
| `real-model-foreground-refusal.json` | 已有开发版 Orb 成为前台时的拒绝记录；不计入对照性能 |
| `real-model.json` | 小控件真实模型对照，保留取点失败；不能以工具 completed 代替目标成功 |
| `real-model-large-controls.json` | 放大的固定目标布局，三对真实模型单步/批量和菜单依赖任务全部通过 |
| `model-summary.json` | 上一项的 p50/p95、成功率、模型响应和图片负载 |
| `real-model-long-20.json` | 真实模型连续 20 次观察；出站三图预算和完整结果历史 |
| `plugin-reference.json` | 新插件固定提交、检出状态、源文件/许可证和本地移植文件散列 |
| `real-model-pixels.json` | 原紧凑布局，像素坐标与最新一图，单步/批量各 3/3、菜单 1/1 |
| `real-model-pixels-tiny.json` | 28×24 DIP 控件，同样 7/7；包含原生分段耗时 |
| `pixel-summary.json` | 以上两轮的有限样本统计，由 `summarize-pixel-results.mjs` 重算 |
| `real-model-pixels-startup-*.json` | 初始未完成启动：缺少临时检出的 Next 入口/构建 |
| `real-model-pixels-shell-exit.json` | 第一轮四项通过后原生退出，未算完整验收 |
| `real-model-fraction-recheck*.json` | 旧扩展复跑发生原生退出，未算取点成功率/配对性能 |
| `real-model-fraction-crash-reporter.json` | 本地 crashReporter 诊断下的旧扩展完整轮：批量 2/3，含真实取点失败；没有证明退出已修复 |
| `real-model-fraction-crash-reporter-repeat.json` | 相同诊断再次单步 3/3、批量 2/3、菜单 1/1 |
| `native-callback-stress.json` | Koffi 2.16.3，1000 次实际窗口枚举 + 50 次 GDI/PNG 捕获；不保存像素 |
| `real-model-pixels-koffi-fixed.json` | 更新依赖后的生产入口整轮 7/7，无诊断 bootstrap；微小按钮批量中位 11.03s |
| `real-model-crash-probe.json` | 最初本地 crashReporter 单项成功探针，不混入完整性能对照 |
| `package-audit-koffi-before-trim.json` | 初次审计通过但人工发现新 lib/native 头文件残留；不是无残留证明 |
| `package-audit-koffi-headers-rejected.json` | 在修正产物放回 base.hh 的反证审计：明确失败，随后移除注入并完整重建 |

复现（须有可交互桌面，测试期间避免其他 Orb 实例抢前台）：

```powershell
node evidence/tool-speed/run-native.mjs
node evidence/tool-speed/run-native.mjs --batch
node evidence/tool-speed/run-native.mjs --safety
node evidence/tool-speed/run-native.mjs --wait
node evidence/tool-speed/run-native.mjs --callback-stress
$env:PI_ORB_EVIDENCE_PI_WEB='C:\Users\JUSTLIKEZYP\OneDrive\文档\daily\pi-web'
node evidence/tool-speed/run-real-model.mjs --output=.tmp/pixels-recheck.json
node evidence/tool-speed/run-real-model.mjs --tiny-controls --output=.tmp/pixels-tiny-recheck.json
node evidence/tool-speed/record-plugin-reference.mjs
node evidence/tool-speed/summarize-pixel-results.mjs
```

原生脚本使用本仓库现有 esbuild 将当前适配器打包给 Electron，唯一输入目标为自己创建的测试窗口。等待实验的 `--resume` 仅接续完整场景样本的进度文件，不重试原生操作。真实模型脚本需要 P0 准备的已构建 Pi Web 检出，以及本机 `TZcode/deepseek-v4.1-flash` 配置；通过硬链接/符号链接共享凭据文件，用独立 agent/workspace/userData，结束后移除已知链接。真实模型调用会消耗提供方额度；普通会话引擎和配置均未修改。

`--output` 用独立路径保留现有报告；未传时写当前 `real-model-pixels.json`。`--large-controls` /
`--tiny-controls` 只改变夹具；`--long-only` 验证当前一图预算。`PI_ORB_EVIDENCE_EXTENSION` 仅用于
指定已归档旧扩展，不是生产回退开关。原始诊断和崩溃转储只留在被忽略的 `.tmp`，不提交。
`--crash-reporter` 从诊断 bootstrap 启动同一构建，只将转储写入本轮隔离 userData，禁止上传；
已有两轮旧扩展诊断使用相同启动模式，转储路径是 `.tmp/plugin-pointing/crash-dumps`。

需要另建干净源码环境时，`prepare-pi-web.mjs` 仅导出固定 `95a5874` 到 `.tmp/plugin-pointing/pi-web`，
安装依赖并构建；Node 堆上限 4GiB。该构建尚未完成验收，不冒充本轮真实模型所用环境。

## 历史来源与适配

旧单体来源：`deepseek-harness-orb@72f1d738458a223696685a909e806b683eff5885` 的 `plugin.ts`、`windows.ts`、`policy.ts`；顺序调用、取消与 600ms 等待经 Pi/Electron 桥适配。后续 pixel 实验来源：`dsh-orb-cordis@9cdc50302d202f4497569731be488a8afa500da7`，MIT。源码与许可散列保存在 `plugin-reference.json`。

### 已删除的 pixel 实验

| 来源（新插件同一固定提交） | 复用方式 | 必要适配 / 不复用原因 |
|---|---|---|
| `packages/computer-use/src/coordinates.ts:166-215` | 直接复用 pixel 校验及 pixel → HID 公式 | 模型侧统一像素；原生 HID 继续现有 millifraction；不保留模型双模式/设置或 dsh 日志迁移 |
| `packages/computer-use/src/raster.ts` | 直接移植头部解析 | 从 Pi 已归一化的 PNG/JPEG 读尺寸，不能用 Win32 窗口大小假冒 attachment 大小 |
| `coordinate-mode.ts` 的 `rememberObservation` / `firstFrameNotice`、`observe.ts:132-143`、`policy.ts` | 复用 attachment 尺寸绑定和像素提示语义 | 用公开 Pi context 钩子替代 Cordis projection；缓存须绑定 session、generation 和 observation_id，尺寸缺失或旧编号拒绝 |
| `policy.ts` 的顺序批量与最后图像语义 | 复用最后截图做下一步判断 | 本次请求只保留最新 Orb 图片；用户附件、其他工具、持久历史不变，不重复解码/压缩 |


这些适配仅描述当时实验，当前生产使用 millifraction。Koffi 版本、包裁剪与许可的当前依据为 `package.json`、`electron-builder.config.mjs` 和 `THIRD_PARTY_NOTICES.md`。
