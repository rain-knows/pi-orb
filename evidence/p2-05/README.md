# P2-05 分发与打包：证据

本目录回答两个不同的问题：

1. **产物里到底有什么**（`run-package-audit.mjs` → `package-audit.json`）；
2. **那个产物真的能跑吗**（`run-packaged-smoke.mjs` → `packaged-smoke.json`）。

「安装包构建成功」本身不是任何一个问题的答案，所以这里没有把它当成结果记录。

## 复现

```powershell
# 三步一起跑：构建解包产物 → 内容审计 → 启动打包后的产物并驱动其 renderer
node evidence/p2-05/run-p2-05.mjs

# 也可以分开跑（需要先有 release/<version>/win-unpacked）
node evidence/p2-05/run-package-audit.mjs
node evidence/p2-05/run-packaged-smoke.mjs
```

`run-p2-05.mjs` 写 `stage-result.json`（三步的合并结论），两个探针各自写自己的 JSON。

## 1. 内容审计：`package-audit.json`（25/25 通过）

审计读取 `release/<version>/win-unpacked`，不重新构建。

| 组 | 检查 | 结果 |
|---|---|---|
| 产物存在 | `win-unpacked/pi-orb.exe` 与 `resources/app.asar` | 通过 |
| 产品在包内 | `package.json`、`out/main/index.js`、`out/main/native/foreground-window.ps1`、`out/preload/index.js`、`out/renderer/index.html`、`out/renderer/assets/*` | 通过 |
| 不该在包内 | `src/`、`tests/`、`evidence/`、`doc/`、`pi-package/`、`release/`、`.tmp/` 全部为 0 命中；无 `auth.json`／`.env`／私钥／`.pem`／`.pfx` | 通过 |
| 原生模块 | `koffi/build/koffi/win32_x64/koffi.node` 与 `uiohook-napi/prebuilds/win32-x64/uiohook-napi.node` 已解包；**无其它平台**的 `.node`；无 C++ 源码、vendored 头文件、包文档、import library | 通过 |
| 随包许可 | `resources/LICENSE`、`resources/THIRD_PARTY_NOTICES.md`、`resources/CHANGELOG.md` | 通过 |
| 清单一致 | 包内 `package.json` 版本 = 仓库版本；`main` 指向构建入口 | 通过 |
| 内容泄漏 | 对 asar 内 11 个自建文本文件扫描本机用户路径、`PI_ORB_PI_WEB_PASSWORD`、`sk-` 形态密钥：0 命中 | 通过 |

体积记录（不是判据，是复核「某个包不再被裁剪」的事实）：`pi-orb.exe` 246 090 752 B、
`app.asar` 9 291 054 B、解包原生二进制合计 2 658 109 B、asar 条目 135。
未被裁剪时解包目录是 129 个文件（koffi/uiohook 的源码、文档与其它平台二进制），裁剪后 10 个。

## 2. 启动探测：`packaged-smoke.json`（13/13 通过）

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
| **`orb:list-desktop-windows` 返回真实窗口列表**（koffi 从 `app.asar.unpacked` 加载成功） | 通过（本次运行 8–11 个窗口） |
| 启动日志中没有 `desktop driver unavailable` | 通过 |
| 没有模块解析错误 | 通过 |

> 中间三条读的是**计算后的样式**与**真实 DOM**，而不是「样式表已加载」：这正是区分
> 「CSS 文件下载成功」与「移植的参考设计系统真的生效」的地方，也是本书开头那次前端漂移
> （自称复用参考、实为自创 `orb__*` 样式）能被发现的原因。
>
> 最后三项中的窗口枚举是这一阶段唯一能**从外部观测**「打包后原生模块仍然可用」的手段：
> `koffi` 由主进程懒加载，因此只有真的调用一次桌面枚举才能证明 asar 解包路径正确。
>
> 该检查做过反向对照：删除 `app.asar.unpacked/node_modules/koffi/build/koffi/win32_x64/koffi.node`
> 后，「窗口枚举」与「无桌面驱动失败」两项都失败（`The desktop driver is unavailable`），恢复文件后
> 重新通过。

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
