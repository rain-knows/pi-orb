# 工具调用提速证据

参考源和结论见 [阶段记录](../../doc/tool-speed-optimization.md)。本目录没有凭据或截图数据；原始图片只在隔离 Pi 会话中，模型报告只提取文字、大小和调用参数。

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

复现（须有可交互桌面，测试期间避免其他 Orb 实例抢前台）：

```powershell
node evidence/tool-speed/run-native.mjs
node evidence/tool-speed/run-native.mjs --batch
node evidence/tool-speed/run-native.mjs --safety
node evidence/tool-speed/run-native.mjs --wait
node evidence/tool-speed/run-real-model.mjs
node evidence/tool-speed/run-real-model.mjs --large-controls
node evidence/tool-speed/run-real-model.mjs --large-controls --long-only
```

原生脚本使用本仓库现有 esbuild 将当前适配器打包给 Electron，唯一输入目标为自己创建的测试窗口。等待实验的 `--resume` 仅接续完整场景样本的进度文件，不重试原生操作。真实模型脚本需要 P0 准备的已构建 Pi Web 检出，以及本机 `TZcode/deepseek-v4.1-flash` 配置；通过硬链接/符号链接共享凭据文件，用独立 agent/workspace/userData，结束后移除已知链接。真实模型调用会消耗提供方额度；普通会话引擎和配置均未修改。
