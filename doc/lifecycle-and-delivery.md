# Stage 6：生命周期与交付

本阶段对照参考项目固定提交 `72f1d738458a223696685a909e806b683eff5885` 收口 pi-orb 的
撤权、取消、断连和 Windows 交付证据。参考项目来源和移植边界见
[`reference-playbook.md`](./reference-playbook.md) §8、§9.4；本阶段只复用它的
Electron 打包形态和桌面动作等待语义，不引入 dsh 会话运行时或自动授权。

动作等待的来源为参考 `packages/experimental/tool-computer-use/src/plugin.ts` 的
`open_app` 执行器（约 1055–1062 行）和 `src/config.ts` 的 `postActionWaitMs` 默认值 600ms。
pi-orb 在 `ReferenceWindowsDriver.#openApp()` 激活已运行应用后等待同一时长，再验证前台身份并捕获
新观察；不复用会启动新进程的 backend `openApp`。点击修饰键校验沿用参考
`packages/experimental/tool-computer-use/src/coordinates.ts` 的大小写归一和 token 规则，Windows
backend 按虚拟键去重别名；pi-orb 仅补充空白修剪，不增加新修饰键。

## 生命周期合同

`src/main/index.ts` 的 `revokeDesktopOperations()` 是唯一撤权出口。它由以下路径调用：

- 浮球收起、关闭按钮和托盘 Hide；
- 用户停止当前回复；
- pi-web 断连、切换工作区、切换历史会话或开始新会话；
- shell 退出。

撤权同时清除 broker 授权、记录的桌面目标、driver 的 observation/action context，并通过
`AbortSignal` 释放正在进行的 native 鼠标或键盘动作。普通 turn 完成、模型回复结束或队列进入 idle
不会撤权；同一个 Orb session 的后续 turn 继续使用用户选定的 Access。撤权不结束 Pi 会话，也不改变
run generation；workspace/session 切换按各自生命周期建立新 session 或 generation，并要求重新选择 Access。

### 自动化结果

`evidence/p1-07/lifecycle-regression.json` 的 10/10 是旧 per-task API 的历史记录，不代表当前
session Access 生命周期。当前探针 `evidence/p1-07/run-lifecycle-regression.mjs` 输出到
`session-access-regression.json`，本轮为 **12/12**，覆盖：

- 一个 session grant 跨三条排队 prompt 与 turn idle 保留；
- Stop、收起、workspace 切换、新建 session 和 pi-web 断连撤权；
- Stop 不结束 Pi session，workspace/session 切换不会继承旧 grant。

这份记录来自真实 Electron 壳、真实 pi-web 隔离实例和 disposable target。它证明撤权边界，
不等同于真实键盘、锁屏、休眠或多显示器人工验收。

## 真实模型闭环状态

真实模型脚本 `evidence/p1-06/run-real-model-c7.mjs` 使用隔离 pi-web、真实模型、真实 Electron、
参考 Windows backend 和 disposable target。仓库中此前保存的 2026-09-29 运行记录通过了 C7/D6/D8，
但 2026-09-30 的重新运行必须按本次结果记录：

| 场景 | 最新记录 | 事实 |
|---|---:|---|
| C7 观察→点击→再观察 | **失败（截图前）** | 唤醒快捷键未触发目标记录，因此截图拒绝，未产生 Orb 工具调用 |
| D6 观察→滚动 | **环境中止** | 前台为 `LockApp`/不可交互桌面，未向模型发送动作 |
| D8 点击→观察→输入 | **本轮未完成** | 没有生成新的 session-access JSON；旧记录仅作历史 |

新合同结果原样保留在 `evidence/p1-06/real-model-c7-session-access.json` 和
`real-model-d6-scroll-session-access.json`；旧的 `real-model-*-reference-backend.json` 仍作为
历史记录保留，不被覆盖。C7 本轮在截图前因唤醒快捷键未触发目标记录而失败；D6 在
`LockApp`/不可交互桌面环境中止，未向模型发送动作；D8 本轮未完成，也没有新的 JSON。
这些结果不能被一次成功动作或打包成功替代，支持矩阵因此继续把 C7/D6/D8 标为未验证，直到
同一版本、同一脚本在真实模型上稳定通过。

## 打包与产物

`node evidence/p2-05/run-p2-05.mjs` 于 2026-09-30 通过：

- Windows x64 解包产物构建成功；
- 包内容审计 25/25：运行时文件、许可证和原生模块路径正确，无源码、测试、证据或凭据；
- 打包启动探测 22/22：preload 桥、无 Node renderer、参考前端 DOM/令牌、停靠滑动和 session Access 合同均通过。

形态沿用参考项目的 electron-builder、每用户 NSIS、`asarUnpack` 原生模块和 `publish: null`；
dsh 的随包 Node、发布上传、自动更新、签名链和自定义安装器没有移植。安装包仍为未签名产物。

## 尚未完成的交付验证

以下结论保持“未验证”，不能由构建成功或单元测试推断：

- 干净账户/机器上的安装、覆盖升级、卸载和用户数据保留；
- 未签名安装包的 SmartScreen 首次运行体验；
- 多显示器、DPI 变化、锁屏/休眠后的真实键盘和浮球体验；
- 高权限窗口、Chromium 内容输入和 `orb_open_app` 的真实桌面效果。

人工步骤集中在 [`manual-acceptance.md`](./manual-acceptance.md) §3、§4、§5、§9、§10，
版本兼容性唯一记录在 [`support-matrix.md`](./support-matrix.md)。
