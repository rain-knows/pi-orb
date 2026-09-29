# P2-04 参考桌面动作扩展

## 范围

本阶段从固定参考提交 `deepseek-harness-orb@72f1d738458a223696685a909e806b683eff5885` 的
Windows desktop backend 接入热键、长按和拖拽。复用入口为参考项目
`packages/experimental/tool-computer-use/src/backend.ts`、`windows.ts`、`coordinates.ts`，以及
`packages/experimental/tool-computer-use/src/plugin.ts` 对应的 `hotkey`、`long_press`、`drag`
工具定义。pi-orb 只适配 Pi tool schema、命名管道 bridge、既有任务授权和单窗口坐标空间。

本批仍不接入 `open_app` 和跨屏拖拽：前者会启动或切换到用户未选定的应用，必须先定义目标重绑定和授权
边界。截图导出已按参考项目的用户显式操作语义接入：预览中的 **Save copy** 打开系统保存对话框，保存
当前预览的精确字节，并尽力复制到剪贴板；取消保存不会消费 pending 预览，也不会发送给模型。

## 实现边界

- 新动作只在 Orb workspace 注册；普通 pi-web 会话没有 Orb 工具。
- 所有动作经过同一 broker：必须有当前任务授权、当前 run generation 和新鲜 observation；一个 observation
  只允许一个动作；失败后停止任务。
- 未授权观察只返回窗口元数据；授权观察和成功动作后的新观察返回同一 HWND 的新截图，图片作为 Pi 原生
  `image` content block 发送，base64 不重复写入结构化 details。
- 热键限制为已知 Windows key token、最多四键，并拒绝参考项目列出的 Win/Cmd+Shift+3/4/5 截图组合键。
- 长按限制 1–10 秒。长按和拖拽坐标都是 0–1000 screenshot fraction。
- 拖拽的起点和终点映射到同一个已观察 HWND，不允许模型指定其它窗口或屏幕。
- 截图导出只接受当前 generation 和当前 preview observation；路径由用户在系统保存对话框中选择，写入使用
  `wx`，不会覆盖已有文件。
- broker 撤权通过 `AbortSignal` 传到 native backend；长按/拖拽的 native `finally` 会释放鼠标键，热键会释放已按下的键。

## 自动化证据

2026-09-29 本轮结果：类型检查通过；回图相关测试 92/92 通过；真实 pi-web 工具 schema 检查 7/7 通过；
发布质量门禁 32/32 通过（包含全量 typecheck、lint、test 和 production build）。新增 broker 未授权回归在全量测试中通过。

运行以下命令：

```powershell
npm run typecheck
npx vitest run tests/orb-tools.test.ts tests/desktop-broker.test.ts tests/reference-windows-driver.test.ts tests/reference-windows.test.ts
node evidence/p1-06/run-p1-06-tools.mjs
```

覆盖点：参数范围、禁止热键、解析拒绝、窗口和坐标映射、授权 broker 的既有统一链路、授权前元数据/授权后图像边界、
动作后新 observation、撤权信号传递，以及 native
backend 在长按/拖拽取消后松开鼠标、热键取消后释放已按下的键。工具暴露脚本用实际 pi-web 装配和假 provider
接收的 schema 判定：普通 cwd 不含 Orb 工具，Orb cwd 仅含七个当前受支持工具。

截图导出补充测试：`tests/screenshot-export.test.ts` 验证支持的媒体类型、精确 base64 解码和坏数据拒绝。

## 未完成验收

**真实桌面操作仍未验证。** 动作后回图的产品链路已实现并有自动化覆盖：授权后由 driver 捕获同一 HWND，broker
返回新 observation，Pi extension 以原生 image block 附加给模型；未授权路径不带图。仍需在 disposable target 上
验证热键、拖拽、长按真实落点，以及回图像素确实反映动作结果。

手工验收至少覆盖：

1. 在 Orb 任务授权后执行普通应用内热键，确认目标窗口收到键盘事件；尝试 Win/Cmd+Shift+3/4/5 并确认被拒且无输入。
2. 在 disposable target 上分别执行长按和拖拽，核对目标自身事件日志中的落点及按下/释放成对。
3. 取消长按/拖拽时核对目标不残留按键，并确认任务失败状态阻止后续动作。
4. 每个动作后检查 Pi tool result 的 image block，确认它来自同一目标 HWND 且反映动作后的画面。
5. 在截图预览中点击 **Save copy**，选择一个新文件名；确认文件字节与预览一致、剪贴板可粘贴；再次选择已有文件名时确认不会覆盖。

当前状态：协议、自动化、Pi image result 和动作后视觉回图链路已完成；真实桌面交互与目标像素验收未完成。
