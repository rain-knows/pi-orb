# P2-05 分发与打包：证据

本目录回答两个不同的问题：

1. **产物里到底有什么**（`run-package-audit.mjs` → `package-audit.json`）；
2. **那个产物真的能跑吗**（`run-packaged-smoke.mjs` → `packaged-smoke.json`）。

「安装包构建成功」本身不是任何一个问题的答案，所以这里没有把它当成结果记录。

## 复现

```powershell
# 四步一起跑：构建 → 内容审计 → 真实 Pi 加载插件 → 启动并驱动 renderer
node evidence/p2-05/run-p2-05.mjs

# 也可以分开跑（需要先有 release/<version>/win-unpacked）
node evidence/p2-05/run-package-audit.mjs
node evidence/p2-05/run-packaged-smoke.mjs
```

`run-p2-05.mjs` 写 `stage-result.json`（四步合并结论），插件加载记录在 `../personal-startup/plugin-load.json`。

## 1. 内容审计：`package-audit.json`（30/30 通过）

审计读取 `release/<version>/win-unpacked`，不重新构建。

| 组 | 检查 | 结果 |
|---|---|---|
| 产物存在 | `win-unpacked/pi-orb.exe` 与 `resources/app.asar` | 通过 |
| 产品在包内 | `package.json`、`out/main/index.js`、`out/main/native/foreground-window.ps1`、`out/preload/index.js`、`out/renderer/index.html`、`out/renderer/assets/*` | 通过 |
| 不该在包内 | `src/`、`tests/`、`evidence/`、`doc/`、`pi-package/`、`release/`、`.tmp/` 全部为 0 命中；无 `auth.json`／`.env`／私钥／`.pem`／`.pfx` | 通过 |
| 原生模块 | `koffi/build/koffi/win32_x64/koffi.node` 与 `uiohook-napi/prebuilds/win32-x64/uiohook-napi.node` 已解包；**无其它平台**的 `.node`；无 C++ 源码、vendored 头文件、包文档、import library | 通过 |
| 随包许可 | `resources/LICENSE`、`resources/THIRD_PARTY_NOTICES.md`、`resources/CHANGELOG.md` | 通过 |
| 清单一致 | 包内 `package.json` 版本 = 仓库版本；`main` 指向构建入口；Koffi 2.16.3 与精确锁定一致，.node SHA-256 与验证环境一致 | 通过 |
| 内容泄漏 | 对 asar 内自建文本文件扫描本机用户路径、`PI_ORB_PI_WEB_PASSWORD`、`sk-` 形态密钥：0 命中；当前文件数见 JSON | 通过 |

此前基线体积记录（本次同步的当前体积见 `package-audit.json` 的 `sizes`）：`pi-orb.exe` 246 090 752 B、
`app.asar` 8 085 800 B、解包原生二进制合计 1 834 010 B、asar 条目 49。
未被裁剪时解包目录是 129 个文件（koffi/uiohook 的源码、文档与其它平台二进制），裁剪后 10 个。

2026-10-01 更新 Koffi 后发现新增 `lib/native` 头文件目录，按参考的最小运行文件策略排除；
新审计对放回 `base.hh` 的产物确实失败。依赖来源、反证和完整重建记录见
[历史取点与包裁剪证据](../tool-speed/README.md)。

## 2. 启动探测：`packaged-smoke.json`（23/23 通过）

以真实 `release/<version>/win-unpacked/pi-orb.exe` 启动，独立 `--user-data-dir` 与
`PI_ORB_CONFIG`，指向一个未使用的 pi-web 端口，通过 Chrome DevTools Protocol 驱动 renderer。
不截图、不落盘像素、不发送任何桌面输入。

| 检查 | 结果 |
|---|---|
| 打包产物启动后保持存活 | 通过 |
| 建立窗口（page target） | 通过 |
| preload 桥到达 renderer（`typeof window.orb === 'object'`） | 通过 |
| renderer 仍然没有 Node 权限（`require`/`process`/`module` 均 `undefined`） | 通过 |
| IPC 状态往返可用 | 通过 |
| 隔离的未配置初始态（`configured=false`、pi-web 不可达） | 通过 |
| 构建后的 renderer 与其素材从 asar 加载（root 已挂载、球元素存在、头像 `naturalWidth > 0`、样式表已加载） | 通过 |
| **参考壳层已挂载**（`#panel`、`#ball`、`#dock-tab` 存在，`body` 带参考状态类） | 通过 |
| **参考设计令牌解析为参考值**（`--ball: 72px`、`--chrome: 12px`、`--panel-radius: 36px`、`--composer-height` 解析为 `72px`） | 通过 |
| **球按参考尺寸与形状渲染**（`72px`、`border-radius: 50%`） | 通过 |
| **观察框按参考几何渲染**（glow `28px`、stroke `8px`、圆角 `16px`、渐变 + drop-shadow、遮罩挖空） | 通过 |
| **观察框不挡输入、不动画**（`pointer-events: none`、`animation: none`） | 通过（改回 `auto` 即失败） |
| **观察框窗口无脚本**（独立入口，不带壳的 bridge） | 通过（`scriptCount: 0`） |
| **停靠滑动真的在动**（主进程 OS 光标边界使用隔离夹具，真实拖动 IPC；从屏外 `x=-52` 滑到 tab `x=0,width=34`，多帧位置见 JSON） | 通过（强制瞬移的反向对照下 2 帧即失败） |
| **系统光标手势和后台书签 bridge**（旧 renderer 坐标移动 API 已删除） | 通过 |
| **取消停靠恢复球并清除 dock 状态** | 通过 |
 | **session Access bridge 存在且初始未授权**（`setOrbAccess`/`revokeOrbAccess` 可用） | 通过 |
 | **旧选窗和逐任务授权 API 不存在**（`listDesktopWindows`/`setDesktopTarget`/`authorizeDesktopTask` 均未暴露） | 通过 |
| 启动日志中没有 `desktop driver unavailable` | 通过 |
| 没有模块解析错误 | 通过 |

> 滑动那条采样的是 renderer 自己的 `screenX`/`outerWidth`（跟随 OS 窗口），并且**先**把球拖到屏幕
> 边缘——当前通过 `dragPress`／`dragBegin`／`dragMove`／`dragEnd` 触发真实 IPC。第一次写旧版检查时正是
> 漏了这个前置条件，于是采到 1 帧、误报失败；记录在此以免重犯。
>
> 中间几条读的是**计算后的样式**与**真实 DOM**，而不是「样式表已加载」：这正是区分
> 「CSS 文件下载成功」与「移植的参考设计系统真的生效」的地方，也是本书开头那次前端漂移
> （自称复用参考、实为自创 `orb__*` 样式）能被发现的原因。
>
 > 打包探针不再通过选窗 API 验证 native backend；实际桌面闭环由
 > `evidence/p1-06/loop-verification-session-access.json` 证明，打包探针只验证安装产物的
 > preload 合同、参考壳层和启动时无 native driver 失败。

## 3. 明确未验证

| 项 | 原因 |
|---|---|
| 干净目标机安装／卸载／升级 | 本机已装过，且安装写 HKCU 与用户目录；开发机上的结果不可复现。步骤见 `doc/manual-acceptance.md` §9 |
| 未签名安装包的 SmartScreen 提示 | 需要真实用户交互与网络判信 |
| 卸载不删除用户工作区与 pi-web | 需要一次真实的安装→使用→卸载流程 |
| 安装后的浮球观感、真实按键唤醒、多显示器、DPI | 属于 P2-01/P1 的人工项，打包不改变其状态 |
| macOS / Linux 产物 | 未构建、未验证；Windows 结果不外推 |

结论：**Windows x64 产物可构建、内容可审计、打包后可启动并完成一次真实桌面枚举；干净机安装、
卸载、升级与 SmartScreen 体验未验证**。见 [`../../doc/p2-05-distribution.md`](../../doc/p2-05-distribution.md)

## 4. 环境事实（复现时的坑）

| 事实 | 后果 |
|---|---|
| `ELECTRON_RUN_AS_NODE=1` 在部分 agent 环境里被全局导出 | 打包后的 Electron 会退化成纯 Node，报 `bad option: --user-data-dir=…` 并以退出码 9 结束、不建窗口。探测脚本显式从子进程环境删除该变量，避免把 shell 配置误报成产品缺陷 |
| 窗口 target 出现早于 React 挂载 | 首次 `Runtime.evaluate` 可能看到空的 `#root`。探测改为轮询到「root 有子节点」，而不是一次性断言 |
| 本机无 Visual Studio | electron-builder 默认的原生模块重建必然失败，见 `electron-builder.config.mjs` 的 `npmRebuild: false` |
