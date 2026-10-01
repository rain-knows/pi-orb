# 插件参考更新、小控件取点与调用耗时

## 参考核对（2026-10-01）

- 新插件：`rain-knows/dsh-orb-cordis@9cdc50302d202f4497569731be488a8afa500da7`，完整只读检出
  `D:\pi-orb-ref\dsh-orb-cordis`；无安装依赖、无执行参考项目。MIT，mini-yifan / DeepSeek 归属分别保留。
- 旧单体远端：`51f09764d7ff99947be08ebbb2ca2388faab3df4`；与现基线 `72f1d738` 比较，
  Computer Use 文件无变化。Windows 升级安装身份调整不适用于本轮，保留生产原生基线。
- 历史问题证据：`evidence/tool-speed/real-model.json` 的紧凑 A/B/C，单步 2/3、批量 0/3；
  `real-model-large-controls.json` 大控件两种模式均 3/3。工具完成不是业务任务成功。

## 实施边界与来源

| 来源（新插件同一固定提交） | 复用方式 | 必要适配 / 不复用原因 |
|---|---|---|
| `packages/computer-use/src/coordinates.ts:166-215` | 直接复用 pixel 校验及 pixel → HID 公式 | 模型侧统一像素；原生 HID 继续现有 millifraction；不保留模型双模式/设置或 dsh 日志迁移 |
| `packages/computer-use/src/raster.ts` | 直接移植头部解析 | 从 Pi 已归一化的 PNG/JPEG 读尺寸，不能用 Win32 窗口大小假冒 attachment 大小 |
| `coordinate-mode.ts` 的 `rememberObservation` / `firstFrameNotice`、`observe.ts:132-143`、`policy.ts` | 复用 attachment 尺寸绑定和像素提示语义 | 用公开 Pi context 钩子替代 Cordis projection；缓存须绑定 session、generation 和 observation_id，尺寸缺失或旧编号拒绝 |
| `policy.ts` 的顺序批量与最后图像语义 | 复用最后截图做下一步判断 | 本次请求只保留最新 Orb 图片；用户附件、其他工具、持久历史不变，不重复解码/压缩 |

Pi 0.87.1 的 `agent-session.js` 在 `tool_result` 后执行 `normalizeToolResultImages`，随后公开
context 收到归一化消息；默认上限 2000×2000，模型还可声明尺寸限制。因此在原始 capture
处固定像素宽高会漂移。本项目只在 context 投影中添加实际 `attached_size`，工具执行在扩展边界
映射到既有 HID 单位；主进程的授权、观察新鲜度、窗口区域变化、取消和串行锁照常校验。
不改 Pi/pi-web，不访问其内部图片处理入口，不增加压缩依赖。

600ms 保留：此前菜单/弹窗等待实验已证伪 400/200ms。速度优化优先减少重复图像与模型往返，
不跳过动作后观察，也不自动重试误点。

## 验证

本轮修复待执行；后续记录单测、原生小控件读回、真实模型紧凑布局对照和调用分段耗时。
未经真实模型验证不得声称小控件稳定；干净机器安装、多屏、高权限仍按支持矩阵未验证。
