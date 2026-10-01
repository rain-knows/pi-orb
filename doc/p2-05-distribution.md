# P2-05 分发与打包（Windows x64）

本文件记录 P2-05 的阶段决策、参考项目来源与验收边界。结论的唯一来源仍是
[`support-matrix.md`](./support-matrix.md)；可复现证据在 [`../evidence/p2-05/`](../evidence/p2-05/README.md)。

## 1. 本阶段要解决的问题

在这个阶段之前，pi-orb 只有「源码 + `npm run dev`」这一种存在形式：没有任何可分发产物，
没有安装包，也没有任何证据说明「把构建结果真的打包起来之后还能跑」。P2-05 的目标就是把这个
缺口补上，并且**只**补这个缺口——让项目第一次拥有一个可以交给别人的 Windows 产物。

## 2. 参考项目来源与复用方式

| 项 | 值 |
|---|---|
| 来源仓库 | [`rain-knows/deepseek-harness-orb`](https://github.com/rain-knows/deepseek-harness-orb) |
| 固定提交 | `72f1d738458a223696685a909e806b683eff5885` |
| 主要参考文件 | `apps/desktop/scripts/electron-builder-config.mjs`、`apps/desktop/scripts/package-target.ts`、`apps/desktop/scripts/runtime-file-policy.ts`、`apps/desktop/tests/windows-installer-smoke.ps1` |
| 许可证 | MIT（`Copyright (c) 2026 DeepSeek`） |

**直接复用**（同形，非重写）：

| 复用项 | 参考位置 | pi-orb 落点 |
|---|---|---|
| electron-builder 作为打包器，配置用 JS 模块而不是 yml | `electron-builder.config.mjs` 再导出 `scripts/electron-builder-config.mjs` | 仓库根 `electron-builder.config.mjs` |
| Windows 目标只有 NSIS | `electron-builder-config.mjs:235` | 同 |
| 每用户安装、禁止自动提权 | `:245-247`（`perMachine: false`、`allowElevation: false`） | 同 |
| `asar: true` | `:112` | 同 |
| 原生模块解包 glob `**/*.{node,dll,exe}` | `:71-72` | 同 |
| 未签名产物不带更新源 | `publish: null`（`:253`）与 `--publish never` | 同 |
| 调用形状 `electron-builder --config <file> --win --x64 --publish never [--dir]` | `package-target.ts:267-283` | `package.json` 的 `package:win` / `package:win:dir` |
| 裁剪第三方包里的构建残留 | `runtime-file-policy.ts:42`（删除 koffi 的 import library） | `files` 排除段（见 §4） |
| 安装／卸载检查的调用配方 | `tests/windows-installer-smoke.ps1`（`/S`、`/D=`、`_?=`、HKCU `InstallLocation`） | 写入人工验收 §9 |

**明确不搬**（属于 dsh 单体仓库的发布管道，不是 pi-orb 的打包问题）：

- `DSH_DESKTOP_*` 环境契约与「`appId` 必须由环境提供」的强校验；
- 随包分发的 Node 运行时、`dsh/` 负载映射、`prepare:runtime`/`prepare:dsh`/`prepare:packages`；
- 自定义 NSIS 页面、`installer.nsh`、`window-frame.dll` 与 `installWindowsDirectoryInstaller()`
  （后者靠字符串替换 `app-builder-lib` 的固定模板，升级即碎）；
- SafeNet eToken 代码签名链、发布记录与上传流程、`nightly.yml` 自动更新源；
- macOS `dmg`/`zip` 与 Linux `AppImage` 目标。

原因不是「不想复用」，而是这些步骤的服务对象是「随包分发一整套 dsh 运行时」；pi-orb 连接的是
**用户已经在跑的 pi-web**，包里没有第二套运行时需要准备、签名和更新。

## 3. 产物

| 产物 | 路径 | 说明 |
|---|---|---|
| 解包目录 | `release/0.1.0/win-unpacked/` | `pi-orb.exe` + `resources/app.asar`，用于自动化探测 |
| NSIS 安装包 | `release/0.1.0/pi-orb-0.1.0-win-x64.exe` | 每用户安装，未签名 |
| 构建块映射 | `release/0.1.0/pi-orb-0.1.0-win-x64.exe.blockmap` | electron-builder 默认产物；v0.1 无更新源，仅随包保留 |

命令：

```powershell
npm run package:win:dir   # 只出解包目录（不下载 NSIS，用于探测）
npm run package:win       # 出 NSIS 安装包
node evidence/p2-05/run-p2-05.mjs   # 构建 + 内容审计 + 打包产物启动探测
```

## 4. 本阶段做出的三个非默认决定

这三个都不是「照抄参考」，而是本项目的具体条件下必须写下来的选择；改动它们会直接改变产物内容。

### 4.1 `npmRebuild: false`——不重新编译原生模块

electron-builder 默认调用 `@electron/rebuild` 从源码重建原生模块。本机没有 Visual Studio，
重建直接失败；更重要的是**重建会替换掉证据所描述的那个二进制**：`koffi` 与 `uiohook-napi`
都随包提供 win32-x64 预编译（Node-API）二进制，P1 阶段的真机证据正是在这些二进制上采集的。
关掉重建既让打包在没有 MSVC 的机器上可复现，也保证「测过的二进制」就是「发出去的二进制」。

### 4.2 裁剪第三方包内的构建残留

electron-builder 的「smart unpack」只要命中一个文件就会把**整个包目录**移出 asar。默认配置下
`app.asar.unpacked` 里因此出现了 koffi 的 C++ 源码、vendored 的 node-addon-api 头文件、文档，
以及 uiohook-napi 的 libuiohook C 源码和其它平台的预编译二进制。pi-orb 用 `files` 排除段把它们
去掉，只保留 win32-x64 的 `.node` 与包自身入口——这与参考项目 `runtime-file-policy.ts` 删除
koffi import library 的做法同类，只是范围更大。审计从 129 个解包文件降到 10 个。

### 4.3 应用图标由已批准的产品素材派生

`resources/icon.ico` 由 `src/renderer/orb-avatar.png`（仓库中被 release gate 显式批准的唯一
产品素材）居中裁方后生成 16–256 七档尺寸。**不引入新的品牌素材**，也不从参考项目搬图标。
源图 152×166，因此 256 那一档是放大结果——公开发布前应换更高分辨率的源图，这一点记录在此，
不掩盖。

## 5. 自动化证明了什么

`node evidence/p2-05/run-p2-05.mjs` 一次跑完三步，当前全部通过（详见
[`../evidence/p2-05/README.md`](../evidence/p2-05/README.md)）：

1. **构建**：`npm run build` + electron-builder 出解包目录；
2. **内容审计**（27 项）：产品文件在 asar 内的运行时路径上、许可证随包、仓库源码／测试／证据／
   凭据／密钥／其它平台二进制／构建残留一律不在包内、原生模块确实在 `app.asar.unpacked`，
   Koffi 版本与原生二进制匹配已验证的安装环境；
3. **打包产物启动探测**（22 项）：真实启动 `release/.../pi-orb.exe`，证明 preload 桥可用、
   renderer 无 Node 权限、构建后的 renderer 与其素材确实从 asar 里加载出来、参考壳层与
   session Access 合同已生效。桌面 native action 的真实闭环另由
   `evidence/p1-06/loop-verification-session-access.json` 观测，不再用旧选窗 API 作为证据。

该探测仍检查启动日志没有 native driver 失败和模块解析错误；桌面驱动的动作结果由 P1-06
真实 Electron/native backend 闭环单独验证。

## 6. 自动化没有证明什么（人工项）

以下**必须**由人在干净环境上执行，已登记到 [`manual-acceptance.md`](./manual-acceptance.md) §9：

| 项 | 为什么不能自动化 |
|---|---|
| 在干净目标机上安装、卸载、升级 | 本机已装过、且安装会写入 HKCU 与用户目录；在开发机上做不可复现 |
| 未签名安装包的 SmartScreen 提示与绕过 | 需要真实用户交互与网络判信 |
| 卸载后工作区与 pi-web 不被删除 | 需要一次真实的「安装 → 使用 → 卸载」全流程 |
| 安装后的浮球观感、真实按键、多屏 | 属于 P2-01/P1 的人工项，不因打包而改变 |

因此 P2-05 的当前结论是：**Windows x64 产物可构建、内容可审计、打包后可启动并通过 session
Access preload 合同探测；干净机安装／卸载／升级与 SmartScreen 体验未验证**。`support-matrix.md` 按此记录，
不提升为「已支持」。

## 7. 与发布门槛的关系

P1-07 的发布门禁新增了 P2-05 的检查：打包配置必须存在且保持每用户 NSIS／`asarUnpack` 原生模块／
`npmRebuild: false`，`release/` 必须被忽略，产物审计记录必须存在且通过。这样「打包配置被悄悄改回
默认值」或「审计记录被删掉」都会让门禁失败，而不是安静地发布一个内容不同、体积翻倍的包。
