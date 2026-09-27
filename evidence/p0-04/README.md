# P0-04 桌面驱动候选只读探针结果

> 运行方式：
> - 窗口/DPI：`powershell -File evidence/p0-04/window-probe.ps1`
> - 截图/解码/清理：`powershell -File evidence/p0-04/probe-capture.ps1 -AwarenessMode unaware|permonitorv2 -OutPath <file>`（两种模式各跑一次）
>
> 原始结果：`window-probe.json`、`capture-unaware.json`、`capture-permonitorv2.json`
> 状态：**只读验收项已覆盖**；用户已明确许可只读截图；驱动**未安装**（用户选择只记录候选事实）。

## 1. 本任务的硬边界

| 项目 | 实际 |
|---|---|
| 截图 | 2 次（每种 DPI 模式 1 次），经用户明确许可后执行 |
| 鼠标/键盘输入 | **0 次** |
| 驱动安装 | **未安装**（用户决定只记录候选事实） |
| 像素落盘 | **0 字节**——图像在内存中采集、编码、哈希后即释放 |
| 上传/外发 | 无 |
| 窗口标题 | 只持久化长度；标题原文从不落盘 |

因此：探针结果**不能当作输入能力验收**（doc §5 P0-04 风险栏）。

## 2. 候选驱动：Cua Driver（trycua/cua）

| 项目 | 事实 | 证据来源 |
|---|---|---|
| 许可证 | 仓库 MIT（`Copyright (c) 2025 Cua AI, Inc.`） | [LICENSE.md](https://github.com/trycua/cua/blob/main/LICENSE.md) |
| 需注意的许可边界 | 仓库 MIT，但 ClawHub 发布的 skill 副本为 MIT-0；Kasm(MIT)、OmniParser(CC-BY-4.0)；可选 `cua-agent[omni]` 含 ultralytics **AGPL-3.0** | [README](https://github.com/trycua/cua) |
| 平台 | macOS / Windows / Linux；Windows 走 **UIA** 元素树 | [Windows 工具文档](https://cua.ai/docs/reference/cua-driver/mcp-tools-windows) |
| 工具目录 | 单 stdio MCP server，约 56–60 个工具（各平台不同）；可用 `cua-driver list-tools` 枚举 | [CLI 参考](https://cua.ai/docs/reference/cua-driver/cli-reference) |
| 权限模型 | 显式权限组：`computer:readonly` **仅含 `computer:screenshot`**；`computer:all` 才含 click/type/key/scroll/drag/hotkey | [MCP server 参考](https://cua.ai/docs/reference/cua-cli/mcp-server) |
| 输入投递语义 | `delivery_mode` 默认 `"background"`，尝试不抢焦点注入；`target` 为 `{kind:"window",pid,window_id}` 或 `{kind:"desktop",display_id}` | [MCP Tool Notes](https://cua.ai/docs/reference/cua-driver/mcp-tool-notes) |
| 本机安装状态 | `cua` 命令不存在；无本地包；未写入任何 node_modules | 本机检查 |
| **已锁定版本** | `@trycua/cua-driver@0.30.1`（wrapper，MIT）；`@trycua/cua-driver-win32-x64-msvc@0.30.1` | `npm pack` 制品（已下载，未安装） |
| 制品哈希清单 | `evidence/p0-04/cua-artifact-manifest.json` | 本任务 |
| **平台包许可差异（重要）** | wrapper `MIT`；Windows 平台包 **`MIT AND MPL-2.0`**，因其内一个 `.node` 文件是 MPL-2.0 派生构建，上游自带 `node-runtime-NOTICE.md` 合规章节 | 制品内含的 NOTICE |

**许可结论**：真正交付给用户的是平台包里的原生二进制（一个 26.8 MB `cua_driver_sdk.dll` 与一个 `cua_driver_node_runtime.node`）。平台包许可为 `MIT AND MPL-2.0`，**不是纯 MIT**。

- MPL-2.0 是**文件级弱 copyleft**：分发未修改的制品需附 NOTICE 并告知如何取得对应源码（上游已给出路径），不会传染整个 pi-Orb。
- **残留不确定项**：NOTICE 只点名了 `.node` 文件，而包许可字段是 `MIT AND MPL-2.0`；26.8 MB 的 DLL 未被 NOTICE 明确点名。发布打包前（P1-07）必须核实 DLL 是否承担 MPL 义务，**不得自行假定任意一侧**。
- 其它许可边界：ClawHub 的 skill 副本为 MIT-0；Kasm(MIT)、OmniParser(CC-BY-4.0)；可选 `cua-agent[omni]` 含 ultralytics **AGPL-3.0**，不引入。

### 2.1 从制品实际枚举的能力契约（非引用文档）

依据下载包内的 `cua_driver_contract.d.ts`（118 KB）与 `cua_driver_sdk.d.ts`（141 KB）符号枚举（**未启动驱动进程**）：

| 类别 | 符号 | 对 P1 的意义 |
|---|---|---|
| 动作 | `ClickInput`、`DragInput`、`MoveCursorInput`、`TypeTextInput`、`PressKeyInput`、`HotkeyInput`、`ScrollInput`、`InvokeMenuInput` | 覆盖 MVP 所需的观察／点击／输入／滚动 |
| 观察 | `ListWindowsInput`、`ListAppsInput`、`GetWindowStateInput`、`GetDesktopStateInput`、`GetScreenSizeInput`、`SnapshotImage`、`ParseVisualRegionsInput` | 元素级优先、图像降级 |
| 坐标 | `VisualActionCoordinateSpace`、`ClickPosition`、`CursorPointOutput` | **坐标空间是显式一等概念**，恰好对应本任务实测的 1.5 倍虚拟化/物理差异 |
| 验证 | `ActionEvidence`、`VerifyStateInput/Output`、`BoundsExpectation`、`StatePredicate`、`ActionEscalation` | P1-06 的“一动作一观察”与失败后阻止同批后续动作应走这里，而非自写状态比较 |
| 授权 | `StartSessionInput`、`EndSessionInput`、`EscalateSessionInput`、`DriverAuthorizationRequest/Decision/Host`、`RuntimeAuthorizationOptions` | 支持把桌面授权绑定到运行实例（N7），而非持久化开关 |
| 其它 | 剪贴板读／写、agent 光标可视化与主题 | P2-04 范围，非 MVP |

**平台权限不对称**：SDK 内含 `currentMacOsPermissionStatus`、`requestMacOsPermissions`、`openMacOsScreenRecordingSettings` 等 **macOS 专属**权限 API，未发现 Windows 对应符号。因此不能用一个跨平台形状去建模权限状态。

参考：DeepSeek Orb 的 Windows 后端（koffi/GDI/SendInput）**部分取消路径缺少可靠的按键/鼠标释放**，移植必须补测。

## 3. 实测结果（本机 Windows 11 x64 / 2560×1600@120 / 150% 缩放）

### 3.1 窗口身份发现

| 指标 | 值 |
|---|---|
| 顶层窗口数 | 298 |
| 可见窗口数 | 23 |
| 枚举耗时 | 约 11 ms |
| 后台窗口可识别性 | **可以**——`EnumWindows` 独立于前台状态，无需激活即可识别窗口身份 |

这支撑 doc §4.4「先记录用户原目标窗口再唤醒」：窗口身份可在不抢焦点的情况下取得。

### 3.2 坐标约定风险（关键发现）

| 指标 | DPI-unaware 模式 | Per-monitor-v2 模式 |
|---|---|---|
| 线程 awareness 值 | 0（UNAWARE） | 2（PER_MONITOR_AWARE） |
| 虚拟屏幕 | 1707×1067 | **2560×1600** |
| 全屏截图尺寸 | 1707×1067 | 2560×1600 |
| `GetDpiForWindow`（前台窗口） | 144 | 144 |
| 缩放比例 | 约 150% | 约 150% |
| 本机 DPI 分布 | `dpi=96`：42 个窗口；`dpi=144`：256 个窗口 | 同 |

**后果**：unaware 模式下截图尺寸是虚拟化坐标（1707×1067），与物理分辨率（2560×1600）相差 **1.5 倍**。若把该截图上的像素位置直接当输入坐标，点击会落到错误位置。

结论：桌面 helper **必须显式声明 per-monitor-v2 DPI awareness**，使截图与输入处于同一坐标空间；若做不到，必须显式按显示器换算，不能假设全局单一比例（本机同时存在 96 与 144 两种窗口 DPI）。

### 3.3 截图、编码与解码

| 指标 | unaware | permonitorv2 |
|---|---|---|
| 捕获耗时 | 34 ms | 51 ms |
| PNG 编码耗时 | 34 ms | 63 ms |
| PNG 字节数 | 339 KB | 574 KB |
| 解码成功 | 是 | 是 |
| 解码尺寸 == 捕获尺寸 | 是（1707×1067） | 是（2560×1600） |
| 格式 | PNG | PNG |
| 解码耗时 | 13 ms | 14 ms |
| 像素落盘 | 0 字节 | 0 字节 |

### 3.4 前台 vs 后台捕获语义（明确差异）

对 4 个可见但**非前台**的窗口尝试 `PrintWindow`，全程未提升/聚焦任何窗口（前台窗口在测试前后保持一致）：

| 目标进程 | unaware 结果 | permonitorv2 结果 |
|---|---|---|
| Weixin | 后台捕获成功（flag=2） | 成功（flag=2） |
| Notion | 后台捕获成功（flag=2） | 成功（flag=2） |
| SystemSettings | 后台捕获成功（flag=2） | 成功（flag=2） |
| TabTip（触摸键盘） | **失败** | **失败** |

结论：普通应用窗口可在**不抢焦点**下捕获（3/4）；DirectComposition 类表面（TabTip）两种 flag 都失败，说明窗口定向捕获需要合成器感知的回退方案。前台/后台语义差异是**真实存在的**，不是理论担忧。

### 3.5 取消与清理

| 指标 | unaware | permonitorv2 |
|---|---|---|
| 只读取消执行 | 是 | 是 |
| 取消前迭代数 | 14 | 15 |
| 迭代中 GDI 计数（每 5 次采样） | 4,4,4 | 4,4,4 |
| 重复 8 次捕获周期的 GDI 计数 | 4,4,4,4,4,4,4,4 | 同 |
| 重复周期增长量 | **0** | **0** |
| 进程退出前 GC 后 GDI 差值 | +3（固定残余） | +3 |

结论：**重复捕获与取消路径均无 GDI 句柄增长**（growth=0），不存在随使用时间累积的泄漏；+3 为单次性进程内的固定残余，随进程退出释放。

> 探针自身的修正记录：第一版在窗口捕获前提前 `ReleaseDC` 了屏幕 DC 后又复用该句柄，导致 `PrintWindow` 失败并虚增 GDI 残留。修正句柄生命周期后 `PrintWindow` 成功、逐周期计数变为恒定——这本身就是「清理必须显式验证」的一个实例。

### 3.6 OS 权限状态

Windows 不设 macOS 式的屏幕录制／辅助功能授权弹窗，本机探针在无额外授权提示的情况下完成了枚举与截图。因此：**macOS 权限行为在本机未验证**，不得由 Windows 结果外推。

## 4. 未验证项（必须在 P0-05 记为未通过/未验证）

- **Cua 候选版本与许可已锁定，但未经本机运行验证**：`@trycua/cua-driver@0.30.1` + `@trycua/cua-driver-win32-x64-msvc@0.30.1`（`MIT AND MPL-2.0`）。tarball 与二进制哈希、文件清单、能力符号已记录（`cua-artifact-manifest.json`）。用户选择暂不安装，因此：**版本、许可、能力面已取证；驱动进程行为、真实工具目录输出、权限交互未在本机验证**。
- **原生二进制许可义务**：已识别（含 NOTICE），但 DLL 是否承担 MPL 义务**待 P1-07 前核实**。
- **未验证真实输入**：点击/输入/滚动/取消释放全部未测（属 P1-05，需真机人工授权）。
- 未验证 macOS/Linux 权限与捕获行为。
- 未验证多显示器（本机仅 1 个显示器）。
- 未验证 elevated（高权限）窗口捕获行为。

## 5. 对合同的贡献

| 条款 | 本任务证据 | 状态 |
|---|---|---|
| N4 所有权 | 未安装驱动、未启动常驻服务 | 已保持 |
| N6 不删除用户数据 | 仅写 `evidence/`；像素零落盘 | 已保持 |
| P0-04 只读要求 | 无鼠标键盘输入；截图经明确许可 | 已遵守 |
| 版本与许可可识别性 | 版本 + tarball/二进制哈希 + 文件清单 + 能力符号已记录 | 已覆盖 |
| 坐标约定记录 | 1.5 倍空间差异 + 混合 DPI 事实 | 已覆盖 |
| 前台/后台语义差异 | 4 窗口实测，3 成功 1 失败 | 已覆盖 |
| 取消与清理 | 逐周期计数恒定，无累积泄漏 | 已覆盖 |
