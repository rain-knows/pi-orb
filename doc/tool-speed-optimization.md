# 工具调用提速实施记录

参考：rain-knows/deepseek-harness-orb@72f1d738458a223696685a909e806b683eff5885，MIT。

## 来源与适配边界

- `packages/experimental/tool-computer-use/src/policy.ts:20-30`：批量规则、动作结果已有截图、bash 分工；直接复用提示语义。
- `src/plugin.ts:330-360`：GUI turn 中动作与重新截图；复用现有移植后端，不搬 Cordis 注册器。
- `src/config.ts:24`：600ms 默认等待；初始保留，使用测试目标读回决定候选。
- `packages/attachment/attachment-local/src/request-image.ts:172-197`：请求图片预算与变体缓存。Pi 已有工具图片缩放，本项目只通过公开 context 钩子控制最近三张 Orb 图片，不复制 dsh 附件存储。
- 请求计时与 `orb_batch` 是 Pi 接入的必要适配：Pi 工具参数在模型响应时已定，后续 observation_id 无法提前生成；宿主接收一批、内部推进新观察编号。参考项目没有这一协议。单步新鲜度检查不变。

## 阶段 1：计时基线

增加 request-scoped 单调时钟记录：窗口枚举、输入、等待、捕获和 PNG 编码、base64、命名管道往返和执行总时间。会话流记录模型响应间隔与工具开始到 SSE 完成的综合时间；后者不冒充纯压缩耗时。没有添加设置页或性能面板。

脚本和证据：`evidence/tool-speed/`。基线区分独立原生驱动与完整模型链路；原生结果不用于证明模型规划。

阶段 1 验证：68 项针对性测试、typecheck、lint 通过。原生基线单击 p50=845ms/p95=884ms，输入并提交 p50=1078ms，快捷键 p50=728ms，三控件原生操作 p50=2544ms，20 次热观察 p50=73ms。独立驱动不含浮窗 80ms、管道、Pi 或模型；不据此宣称整链路提速。初次探针默认应用菜单改变了 content origin，已固定关闭菜单后取得目标读回，不修改生产坐标规则。
