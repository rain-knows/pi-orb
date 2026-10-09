# 观察与坐标

适用于自动首帧、动作后观察和原生输入取点。

Pi before_agent_start 采集当前前台窗口首帧；选区问答和不支持图像的模型按各自边界处理。每个 GUI 动作保留观察边界，动作完成按参考等待后重拍。等待和尺寸限制直接见 [实现](../src/main/reference-windows/observation-limits.ts)。

模型坐标使用最新截图相对 0–1000 millifraction，经截图尺寸换算 HID；不提供 pixel 双模式。screen_index 的可用范围以 [schema](../src/shared/orb-tools.ts) 为准。窗口身份、generation 和 freshness token 只在 bridge 内部校验，拒绝过期输入。

观察框跟随同一目标矩形，与 work area 求交而不是位移；不抢焦点、不挡输入、不进入截图，撤权时隐藏。

来源：插件参考 `packages/computer-use/src/plugin.ts`、`observe.ts`；旧单体 `apps/desktop/src/observation-frame-window.ts` 与 renderer 同名文件。Pi 仅替换观察生命周期。实现：[坐标](../src/main/reference-windows/coordinates.ts)、[目标](../src/main/recorded-target.ts)、[观察框](../src/main/observation-frame.ts)。回归：[坐标映射](../tests/coordinate-mapping.test.ts)、[过期目标](../tests/recorded-target.test.ts)。支持见 [支持范围](support-matrix.md)。
