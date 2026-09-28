# D 组前置落地证据（task-1）

记录时间：2026-09-28（本机交互式会话）
目的：证明 D 组（真实模型自主调用 orb 工具）的**四项前置**成立，使后面的链路复现不是空跑。

结论：**四项全部成立**，且**无需修改任何配置文件**（详见 §1）。

---

## 1. 全局 Pi 配置：未改动

任务契约要求「备份的全局 `~/.pi/agent/settings.json` 与改动 diff」。实测结果是**不需要改动**，
因此 diff 为空——这比「改完再回退」更好，故如实记录。

| 项 | 值 |
|---|---|
| 路径 | `C:\Users\JUSTLIKEZYP\.pi\agent\settings.json` |
| 备份 | `settings.json.pi-orb-backup-20260928-133254` |
| 源文件 sha256 | `F719BDCE09BC0404E29B613C3D51E1B676777F18C700E5473FD23B18263B818E` |
| 备份 sha256 | `F719BDCE09BC0404E29B613C3D51E1B676777F18C700E5473FD23B18263B818E` |
| 备份与当前是否一致 | **一致**（备份后文件未被修改） |
| 改动 diff | **无**（不需要改动） |

原因：文件中**早已存在**指向本仓库包的条目，且时间戳（10:19:02）早于本次备份（13:32:54）：

```json
"packages": [ ... , "D:\\workself\\pi-orb\\pi-package" ]
```

`pi list` 亦确认 CLI 认到该包：

```
User packages:
  D:\workself\pi-orb\pi-package
    D:\workself\pi-orb\pi-package

Project packages:
  ../pi-package
    D:\workself\pi-orb\pi-package
```

> 注：仓库级 `.pi/settings.json`（已入 git，内容 `{"packages": ["../pi-package"]}`）是**项目级**
> 声明，仅在授予项目信任后生效。它对 D 组的实际作用待定；全局条目已足够，故两者都记录。

**回退方式**（若日后需要）：`pi remove D:\workself\pi-orb\pi-package`，或用备份文件覆盖。

---

## 2. 扩展在真实会话内可见：四个工具全部注册

证据来自**真实 pi-web 会话的 JSONL**（不是测试桩）：
`%USERPROFILE%\.pi\agent\sessions\--D--workself-daily--\2026-09-28T04-09-51-328Z_01a0e634-6fe0-71a9-ba67-37668fe654f1.jsonl`

该会话的 system prompt（第 4 行）里，模型实际看到的工具清单含：

```
- orb_observe: Observe a desktop window (identity, geometry, elements)
- orb_click: Click once in the observed window
- orb_type: Type text into the observed window
- orb_scroll: Scroll inside the observed window
```

且该会话中模型**真实发起过**这两个调用（工具回复可在同一 JSONL 中读到）：

| 工具 | toolCallId | 真实返回（摘要） |
|---|---|---|
| `orb_observe` | `call_00_94hDAp3gLAlcCZdtqd003659` | `observation_id: obs-mukqbe1g-1` …（见 §4 诊断） |
| `orb_click` | `call_00_7Mwv2XzuWpgIp3GvzZSw3160` | `Refused (no-task-authorization): No desktop task is authorized for this session.` |

即：扩展不仅被加载，工具的**注册、调用、以及 shell 侧的策略拒绝**都已在真实链路上跑通过一遍。
`no-task-authorization` 是**正确的安全拒绝**（当时未授权），不是缺陷。

---

## 3. 浮窗配置与握手文件

| 文件 | 状态 | 关键字段 |
|---|---|---|
| `%APPDATA%\pi-orb\orb-config.json` | 存在 | `orbWorkspace: D:\workself\daily`，`shortcut: CommandOrControl+Shift+Space`，`version: 1` |
| `%APPDATA%\pi-orb\bridge-token.json` | 存在 | `version:1`，`token:<redacted len=64>`，`pid:30620`，`workspace:D:\workself\daily`，`pipePath:\\.\pipe\pi-orb-30620`，`generation:1`，`createdAt:2026-09-28 04:54:23` |

两点值得记下（否则 D 组会误判为“扩展坏了”）：

1. **`orb-config.json` 缺失时 `orb_observe` 不会报 `not-configured`，而是工具根本不注册** ——
   `pi-package/extensions/orb.ts` 的 `session_start` 处理器在
   `isOrbWorkspace(ctx.cwd, config.orbWorkspace)` 不成立时直接 `return`。
   所以“会话里没有 orb 工具”和“工具有但桥接不可用”是两种不同故障。
2. 只有落在**orb 工作区** `D:\workself\daily` 的会话才会注册工具。别的 cwd 没有。

---

## 4. 命名管道可连接

```
PIPE CONNECT OK  isConnected=True     (pi-orb-30620, 3000ms timeout)
```

现存管道清单（本次采样）：

```
\\.\pipe\pi-orb-30620
```

与 `bridge-token.json` 的 `pipePath` 一致。

---

## 5. 顺带确证的缺陷（供 task-2 使用，此处不改代码）

同一次真实 `orb_observe` 的返回暴露了两处**模型侧坐标信息缺陷**：

```
observation_id: obs-mukqbe1g-1
window: "P1-05 input target" (electron.exe, pid 4180, window id 1903206)
window size (screen DIP): 735x786 physical px; actions use screen DIP (see coordinate mapping)
coordinate space for actions: screen-dip
elements: unavailable for this window; address actions by explicit screen DIP coordinates
```

1. **标签与数值自相矛盾**：该行既称 `screen DIP`，值却是 `735x786 physical px`。
   该窗口在 scaleFactor 1.5 下 DIP 约为 `490x524`。模型由此推出 `(193,190)`，基础是错的。
   根因：`src/main/cua-adapter.ts:264` 的 `Math.round(target.bounds.width / 1)` 除以 1（空操作），
   从未做 DPI 换算。
2. **完全没有窗口屏幕原点**：`renderResult()`（`pi-package/extensions/orb.ts:359`）打印了
   `window.title/appName/pid/id` 与尺寸，却**丢弃**了 `observation.window.bounds`
   （`x/y/width/height`）。模型拿不到窗口在屏幕上的位置，就无法把“截图中某点”换算成动作坐标。

另有一条**测量顺序**事实：该会话中图片在**第 11 行**才作为用户消息到达，而模型在**第 6 行**
就已调用 `orb_observe`——截图与观测从不在同一条消息内。这属于发送顺序，不是 `observe` 的缺陷。

两处缺陷的修复与验证留给 task-2；本文件只记录现状。
