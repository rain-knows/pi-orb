# pi-orb 参考项目优先手册

本文件是 pi-orb 开发过程中**首先查阅**的参考索引与作业规程。任何 UI、交互、桌面能力、
工具协议或工程约定的改动，都先在本文件里定位参考项目的对应实现，再决定“直接移植／薄适配／
不适用”。本文件不替代 [`pi-orb-development-goals.md`](./pi-orb-development-goals.md)
（产品与不变量）和 [`support-matrix.md`](./support-matrix.md)（版本兼容性），只回答
“这一块该看参考项目的哪个文件、怎么搬、搬到哪、凭什么算完成”。

## 0. 30 秒定位表

先按下表找到本文件对应章节，再打开参考文件。不确定时按 §10 的作业流程走完整流程。

| 我要做的事 | 先看本文件 | 主要参考文件 | 主要落点 |
|---|---|---|---|
| 改浮球／面板的尺寸、停靠、hover、拖动 | §5.2–§5.5 | `apps/desktop/src/floating-window.ts`、`renderer/floating.{html,css,js}` | `src/main/floating-*.ts`、`src/renderer/*` |
| 新增或修改桌面工具 | §7.1–§7.3、§7.5、§10.2 | `tool-computer-use/src/plugin.ts`（同名工具） | `src/shared/orb-tools.ts`、`pi-package/extensions/orb.ts`、`src/main/desktop-*.ts` |
| 改坐标、DPI、滚轮/点击落点 | §6.3、§7.4、§10.3 | `coordinates.ts`、`coordinate-mode.ts`、`windows-native.ts` | `reference-windows-driver.ts`、`reference-windows/*` |
| 接入参考后端的未用方法或像素编码 | §6.2 | `backend.ts`、`coordinate-mode.ts`、`observe.ts` | `reference-windows-driver.ts`、`orb-tools.ts` |
| 改授权、撤权、取消、生命周期 | §8、§10.4 | `plugin.ts`（turn/end）、`overlay-guard.ts` | `src/main/index.ts`、`window-lifecycle.ts`、`desktop-broker.ts` |
| 补测试或判断“算不算通过” | §9.1、§13 | 参考同名 `*.spec.ts` | `tests/*`、`evidence/*` |
| 把参考代码搬进仓 | §10.5、§12 | 目标文件本体 | 对应目录 + `THIRD_PARTY_NOTICES.md` |
| 改打包／安装包／分发形态 | §9.4、§10.6 | `apps/desktop/scripts/electron-builder-config.mjs`、`package-target.ts`、`runtime-file-policy.ts` | `electron-builder.config.mjs`、`package.json`、`evidence/p2-05/` |
| 参考项目升级了新提交 | §11 | `git log`/`git diff` | `AGENTS.md`、本文件 §1／§6.1／§6.2、`support-matrix.md` |

## 1. 参考项目与本地检出

| 项 | 值 |
|---|---|
| 仓库 | [`rain-knows/deepseek-harness-orb`](https://github.com/rain-knows/deepseek-harness-orb)（产品名 DeepSeek Orb） |
| 固定提交 | `72f1d738458a223696685a909e806b683eff5885`（提交标题：`fix(orb): default millifraction coordinates by operating system`） |
| **本机优选检出** | `D:\pi-orb-ref\deepseek-harness-orb` |
| 备用检出 | `C:\Users\JUSTLIKEZYP\AppData\Local\Temp\deepseek-harness-orb-pi-orb`（早期文档记录的路径，同提交） |
| 只读研究检出 | `C:\Users\JUSTLIKEZYP\AppData\Local\Temp\deepseek-harness-orb-research`（同提交） |
| 许可证 | MIT（`LICENSE`，`Copyright (c) 2026 DeepSeek`）；第三方清单见其 `THIRD_PARTY_NOTICES.md` |
| 上游基线 | 参考项目自身是 `deepseek-ai/deepseek-harness`（dsh 0.1.7）的非官方衍生，桌面壳位于 `apps/desktop` |

约定：

- 三个检出**都是只读**参考源，都不是 pi-orb 的运行时依赖；不得写入、不得 `pnpm install` 后当作依赖使用。
- pi-orb 引用参考项目时必须写明**提交 + 文件路径**，不能只写“参考项目”。
- 检出目录丢失或换机时，按 §11 重新获取并核对提交，再继续开发。

### 1.1 当前检出核对命令

```powershell
git -C D:\pi-orb-ref\deepseek-harness-orb rev-parse HEAD
# 期望：72f1d738458a223696685a909e806b683eff5885
git -C D:\pi-orb-ref\deepseek-harness-orb status --porcelain   # 期望：无输出
```

## 2. 取材优先级

参考项目内部本身有权威等级，**冲突时按下列顺序取值**，不要用 pi-orb 现有代码反过来“证明”参考项目的行为：

| 顺位 | 取材面 | 位置 | 用途 |
|---|---|---|---|
| 1 | 许可证与提交 | `<REF>/LICENSE`、`git rev-parse HEAD` | 复用前提与来源记录 |
| 2 | 文档与合同 | `<REF>/packages/experimental/tool-computer-use/README.md`、`<REF>/docs/user/guide/desktop.md`、`<REF>/apps/desktop/README.md` | 工具语义、权限、坐标编码、桌面壳行为的书面定义 |
| 3 | 可执行实现 | `<REF>/packages/experimental/tool-computer-use/src/*`、`<REF>/apps/desktop/src/*`、`<REF>/apps/desktop/renderer/*` | 唯一的行为真相；常量、状态机、DOM/CSS 从这里抄 |
| 4 | 规格测试 | `<REF>/packages/experimental/tool-computer-use/tests/*.spec.ts`、`<REF>/apps/desktop/tests/*.spec.ts` | 参考项目自己认定的不变量；移植时逐条对照 |
| 5 | 工程约定 | `<REF>/AGENTS.md`、`<REF>/docs/AGENTS.md`、`<REF>/docs/testing.md`、`<REF>/docs/defensive-patterns.md` | 测试、文档、生命周期与并发写法 |

> pi-orb 自己的实现（`src/shared/orb-tools.ts`、`src/main/*`、`pi-package/extensions/orb.ts`）
> **不属于取材面**。它与参考项目不一致时，先判定是“pi-web 接入必需差异”还是“本项目漂移”；
> 后者按参考项目修正，不得以“已经实现了”为由保留。

## 3. 参考项目可被借鉴的六个方面

参考项目是一个“浮球 + Computer Use + 后台 code_agent”的桌面产品。pi-orb 只取其中与
“pi-web 非破坏式扩展”相容的部分，下表是六个方面的总览：

| 方面 | 参考项目承载 | pi-orb 的取法 | 详细章节 |
|---|---|---|---|
| A 产品壳与交互 | 浮球窗口、展开面板、右键菜单、停靠、观察框、选区工具栏 | 直接复用几何／DOM／CSS／状态机，只替换会话与宿主调用 | §5 |
| B 桌面能力后端 | `windows.ts` / `windows-native.ts` / `windows-foreground.ts` / `coordinates.ts` / `capture-exclude.ts` | 已移植为 `src/main/reference-windows/`，作为唯一生产 backend | §6 |
| C 工具契约与提示 | `plugin.ts` 的 13 个工具、`policy.ts`、`config.ts` | 工具名与语义按参考对齐，改用 Pi 扩展注册；仅保留 pi-orb 授权边界 | §7 |
| D 授权与生命周期 | `overlay-guard.ts`、`policy.ts`、宿主 overlay 排除、turn 结束隐藏观察框 | 原则复用；授权主体换成 pi-orb 的任务授权与代次 | §8 |
| E 工程与验证资产 | 测试规格、`vi`/`tsdown` 配置、Windows 打包与签名脚本 | 测试不变量与失败模式优先移植；打包链路在 P2-05 评估 | §9 |
| F 文档与流程约定 | `AGENTS.md` 系列、`docs/testing.md`、`docs/agent-lifecycle.md` | 取写法与门禁思路，落到 pi-orb 的 `doc/` 与 `evidence/` | §9.3 |

### 3.1 借鉴优先级（缺一不可的顺序）

1. **能直接搬的代码/常量/CSS 一律搬**，包括参考项目自己的测试断言；重写等价实现视为缺陷。
2. 不能直接搬时，**先写清阻塞符号**（哪个 import、哪个 RPC、哪个协议），再写最小适配层。
3. 适配层只允许 5 类差异：`会话/事件来源`、`用户授权与代次`、`窗口所有权`、`平台入口`、
   `构建与打包`。超出这 5 类的差异要先回到本文档补记录，再动代码。
4. 参考项目没有而 pi-orb 必需的内容（例如 Pi 工具注册、命名管道桥、截图确认流程），
   必须在 `evidence/` 或阶段文档中说明“为何参考项目没有、为何不能用别的方式满足”，避免
   以接入为名扩张产品概念。

### 3.2 明确不可搬的部分

| 参考项目内容 | 阻塞符号／机制 | 处理 |
|---|---|---|
| Cordis 装配与 `ctx.*` 服务模型 | `@deepseek-ai/cordis` `Context`、`ctx.tools.register`、`ctx.on('agent/pre-step')` | 换成 Pi 扩展的 `pi.registerTool` / `pi.on('session_start' \| 'before_agent_start')` |
| dsh 会话、事件、附件持久化 | `@deepseek-ai/dsh-session`、`dsh/session` 事件映射、`@deepseek-ai/dsh-attachment` | 换成 pi-web HTTP + SSE 与 Pi `ImageContent` |
| 自动前置观察与自动附图 | `plugin.ts` 的 `agent/pre-step` 瀑布、`observeDesktop` 自动附图 | pi-orb 由模型显式 `orb_observe`；不自动截屏、不自动上传 |
| 自动选择“最前台窗口”作为目标 | `backend.listScreens()` 自动选窗 + overlay 排除 | pi-orb 目标由用户记录并授权，驱动不猜目标 |
| 后台 `code_agent` 双轨 | `code-agent.ts`、`presets/computer-use/agent.cordis.yml` | 属于 dsh 编排；pi-orb 用 Pi 会话／子代理另行评估（P2-07） |
| 私有工作区包依赖 | `package.json` 的 `peerDependencies: @deepseek-ai/dsh-*@workspace:^`、`"private": true`；`paths.ts:4` 的 `@deepseek-ai/dsh-home-paths`、`project-manager.ts` 的 `@deepseek-ai/dsh-app-boot` | 不能作为 npm 依赖安装；只能移植源码 + 保留 MIT 通知 |
| 浮球 renderer 的宿主协议 | `dsh-app://app/api/<method>` 的 `client-request`/`server-response` RPC（`floating.js:15-31`）、`dsh-app://app/.dsh/remote-stream` NDJSON（`floating.js:7`、`:1046-1062`）、历史面板 iframe `dsh-app://app/index.html?surface=overlay` + `postMessage`（`floating.js:34-37`、`main.ts:786-788`）、模型目录 `/api/session/modelCatalog`（`main.ts:750-770`） | pi-orb 只移植 DOM/CSS/交互层；会话、历史、模型全部走 pi-web 公开 API |
| 宿主子进程 IPC | `DesktopHostOrbCommand`（`host-process.ts:58-66`、`main.ts:964`）、overlay/observation-frame/sck 事件（`host-process.ts:28-48`、`main.ts:867-902`） | pi-orb 用 Electron 主进程 + 命名管道桥替代 |
| macOS 专属实现 | `macos.ts`、`macos-sck-capture.swift`、`tcc.ts` | 首发 Windows 不需要；移植前必须真机验收，禁止外推 |
| 完整 Web UI、插件市场、多语言字典 | `apps/web`、`website/`、`docs/i18n/`、locale 校验 | 与 pi-orb 产品边界无关，不引入 |
| 更新／签名／公证体系 | `apps/desktop/src/update-*.ts`、`mandatory-update-*`、`windows-sign*` | v0.1 不做自动更新；打包相关在 P2-05 单独评估 |

## 4. 参考项目结构速查

```text
<REF>/
  apps/
    desktop/                     Electron 桌面壳（浮球产品本体）
      src/                       主进程：floating-window.ts、observation-frame-window.ts、
                                 selection-monitor.ts、windows-selection*.ts、orb-avatar.ts、
                                 orb-permission.ts、main.ts、preload*.ts
      renderer/                  floating.html/.css/.js、observation-frame.*、selection-toolbar.*
      tests/                     桌面壳规格测试（floating-window.spec.ts 等）
    desktop-host/                桌面宿主运行时装配
    web/ cli/                    Web/CLI 入口（pi-orb 不复制）
  packages/
    experimental/tool-computer-use/   ★ 桌面能力与工具契约主参考包
      src/                      backend/windows*/coordinates/coordinate-mode/plugin/policy/
                                overlay-guard/observe/screenshot/等
      tests/                    工具、坐标、overlay、平台规格测试
      README.md                 工具、坐标编码与权限的书面定义
    computer-use/                非 experimental 的 computer-use 相关包（对照用）
    host/ session/ attachment/ preset/ interaction/    dsh 宿主与会话层（仅理解边界）
  docs/
    user/guide/desktop.md        浮球产品用户手册（交互语义的书面来源）
    cookbook/adding-a-tool.md    工具接入写法
    testing.md defensive-patterns.md agent-lifecycle.md   工程约定
  AGENTS.md docs/AGENTS.md       仓库级开发约定
```

pi-orb 侧的对应关系：

```text
D:\workself\pi-orb\
  src/main/reference-windows/      ← <REF>/packages/experimental/tool-computer-use/src/
  src/main/reference-windows-driver.ts  ← 适配层（唯一允许的差异集中点之一）
  src/shared/orb-tools.ts         ← 工具契约（对应 <REF>/plugin.ts 的 schema，但换 Pi 语义）
  pi-package/extensions/orb.ts    ← 工具注册与提示（对应 <REF>/plugin.ts 的注册部分）
  src/main/floating-*.ts          ← <REF>/apps/desktop/src/floating-window.ts
  src/renderer/index.html floating.css floating.js ← <REF>/apps/desktop/renderer/floating.{html,css,js}
```

## 5. A 面：产品壳与交互

### 5.1 参考文件清单

| 参考文件 | 作用 | pi-orb 对应 | 状态 |
|---|---|---|---|
| `apps/desktop/src/floating-window.ts` | 浮球窗口几何、停靠、拖动、多屏、overlay guard | `src/main/floating-geometry.ts`、`floating-window-controller.ts` | 已移植几何子集 **+ 停靠滑动动画**（250/300ms 缓动、`prefersReducedMotion`、动画取消）；48 个导出中 30 个保持参考名，未移植项见文件头的 overlay guard / 菜单 / 观察框 |
| `apps/desktop/renderer/floating.html` | 浮球/面板 DOM 结构 | `src/renderer/index.html` | **直接移植**参考结构与 id；删除 macOS TCC gate，增补 Pi 必需的工作区、桌面授权和截图预览 |
| `apps/desktop/renderer/floating.css` | 面板、圆角、停靠 tab、暗色主题 | `src/renderer/floating.css` | **直接移植**布局、设计令牌、交互状态、暗色及动效；删除 DSH iframe/TCC 专用选择器；Pi 表面补丁在 `orb-surface.css` |
| `apps/desktop/renderer/floating.js` | hover 展开、pin、历史/权限浮层、键盘焦点 | `src/renderer/floating.js` | **移植状态机**及输入行为；`window.dshDesktop`、RPC、NDJSON 和 iframe 转为现有 `window.orb` 及 Pi Web 会话事件，无 dsh 兼容层 |
| `apps/desktop/src/floating-agent-menu.ts` | 右键菜单模型（主窗、设置、轨道模型、退出） | `src/main/shell-menu.ts` | **部分移植**：结构取自参考的 `floatingContextMenuTemplate`（`floating-window.ts:55-129`）——可编辑时置顶 `cut/copy/paste/selectAll` 角色块（由焦点字段的 `editFlags` 逐项 `enabled`），其下是壳层动作。参考的「打开主窗口」换成「隐藏浮球」（pi-orb 无自有主窗，pi-web 才是会话 UI），Quit 保留。**不移植**：Agent 模型设置（pi-orb 不另立模型配置）、选区工具栏开关与毫坐标开关（无对应物） |
| `apps/desktop/src/orb-permission.ts` | 浮球权限模型（只读/编辑/完全访问） | 未移植 | 不适用：pi-orb 用 pi-web 自身权限与会话模型 |
| `apps/desktop/src/orb-agent-models.ts` | 浮球轨道模型选择与思考档 | 未移植 | 不适用：pi-orb 不另立模型配置 |
| `apps/desktop/src/orb-avatar.ts` | 自定义头像（GIF/PNG/WebP，2 MB 上限） | `src/renderer/orb-avatar.png` 静态资源 | 未移植；如需自定义再按此实现 |
| `apps/desktop/src/observation-frame-window.ts` | 观察框原生 overlay（点透、不进截图） | `src/main/observation-frame.ts`、`src/renderer/observation-frame.{html,css}` | **已移植**：几何（stroke 8 / glow 28 / outset 36、work-area 裁剪不位移、DIP 换算）、窗口构造（`setIgnoreMouseEvents(true,{forward:true})` 点透、`contentProtection` 不进截图、`showInactive` 不抢焦点、`roundedCorners:false`）、renderer 渐变遮罩挖空。宿主调用面不同：pi-orb 在 `withGuiTurn` 里画、在统一撤权出口隐藏，参考由 dsh 的 observation lifecycle 驱动 |
| `apps/desktop/src/selection-monitor.ts`、`selection-toolbar-*.ts`、`windows-selection*.ts` | 选区读取与原生工具栏 | `src/main/selection-monitor.ts`、`windows-selection*.ts` | 已移植读取路径；原生工具栏未移植 |
| `apps/desktop/src/windows-layout.ts`、`owned-directory.ts` | 窗口布局常量、专属目录归属 | 无对应 | `owned-directory.ts` 的“专属目录”思路可对照 pi-orb 的 Orb workspace |

### 5.2 必须逐字一致的量（来自 `floating-window.ts`）

改动浮球几何前先核对这些值；`floating-geometry.test.ts` 是 pi-orb 侧的看门测试。

| 名称 | 值 | 位置 |
|---|---|---|
| `FLOATING_BALL_SIZE` | `72` | `floating-window.ts:132` |
| `FLOATING_PANEL_SIZE` | `{ width: 320, height: 420 }` | `floating-window.ts:135` |
| `FLOATING_CHROME_INSET` | `12` | `floating-window.ts:141` |
| `FLOATING_BALL_WINDOW_SIZE` | `72 + 2×12 = 96` | `floating-window.ts:144` |
| `FLOATING_PANEL_WINDOW_SIZE` | `344 × 444` | `floating-window.ts:150-153` |
| `FLOATING_BALL_DEFAULT_BELOW_CENTER` | `0.08` | `floating-window.ts:147` |
| `FLOATING_DOCK_OVERLAP` | `round(72/5) = 14` | `floating-window.ts:177` |
| `FLOATING_DOCK_DRAG_OFF` | `round(72/3) = 24` | `floating-window.ts:180` |
| `FLOATING_DOCK_TAB_WIDTH` / `HEIGHT` | `6` / `72` | `floating-window.ts:183-186` |
| `FLOATING_DOCK_GLOW` / `HOVER_MARGIN` | `8` / `20` | `floating-window.ts:189-192` |
| `FLOATING_DOCK_HIT_WIDTH` / `HIT_HEIGHT` | `6+8+20 = 34` / `72+2×8 = 88` | `floating-window.ts:195-199` |
| `FLOATING_DOCK_OFF_GAP` / `IN_PAD` | `2` / `5` | `floating-window.ts:202-205` |
| `FLOATING_DOCK_SLIDE_OFF_MS` / `IN_MS` | `250` / `300` | `floating-window.ts:208-211` |
| `FLOATING_DOCK_TAB_FILL` | `#75757F` | `floating-window.ts:214` |
| `OVERLAY_GUARD_INPUT_APPLY_MS` | `80` | `floating-window.ts:907` |

### 5.3 渲染层时间与尺寸（`renderer/floating.js` + `floating.css`）

| 名称 | 值 | 位置 |
|---|---|---|
| `COLLAPSE_MS` | `180` | `floating.js:3` |
| `ANIMATION_MS` | `300` | `floating.js:4` |
| `DOCK_HOVER_DELAY_MS` | `800` | `floating.js:5` |
| `DOCK_DRAG_OFF_PX` | `24`（与主进程 `FLOATING_DOCK_DRAG_OFF` 一致） | `floating.js:6` |
| 拖动判定阈值 | `4px` | `floating.js:1181` |
| 收起守卫集合 | 命中任一则**不排**收起定时器：`pinned \|\| running \|\| asking() \|\| gatingTcc() \|\| dragging \|\| hasSelectionChip()`；`setExpanded(false)` 另有一份少 `dragging` 的同集，并接受 `force` 绕过 | `floating.js:528`、`:504` |
| 展开保持集合 | `play = expanded \|\| running \|\| asking() \|\| gatingTcc() \|\| hasSelectionChip()`（头像动效只在此时播） | `floating.js:397` |
| 停靠 tab 悬停 | `DOCK_HOVER_DELAY_MS` 后才 unsnap，指针离开即取消——扫过 tab 不会把球拉出来 | `floating.js:440-455` |
| 收起时序 | 指针离开后等 `COLLAPSE_MS` 才收起；面板真正 `hidden` 再等 `ANIMATION_MS` | `floating.js:509-528` |
| composer 高度 | `72 + 20×3 = 132px` | `floating.js:158-161` |
| 会话/列表轮询 | `1500ms` | `floating.js:1445` |
| 事件重连退避 | `500 → 8000ms` | `floating.js:327`、`:1074-1075` |
| CSS `--ball` / `--chrome` / `--panel-radius` | `72px` / `12px` / `36px` | `floating.css:4`、`:9`、`:10` |
| `#panel` 过渡 | `300ms ease-in-out`，`transform: scale(0.18→1)`，`transform-origin: var(--origin-x) var(--origin-y)` | `floating.css:37-59` |
| 展开方向原点 | `body.expand-left/right/up/down` 各自设置 `--origin-x`/`--origin-y` | `floating.css:64-80` |
| 面板常驻与切换 | `#panel` 始终在 DOM；展开先 `hidden=false` 再加 `body.expanded`，收起先移除类、动画后再 `hidden` | `floating.html:11`、`floating.js` 的 `applyExpanded` |
| 暗色主题 | `html[data-ds-dark-theme]`（宿主决定并写入，**不是** `prefers-color-scheme`） | `floating.css:22-34` |
| 停靠 tab 呼吸动画 | `1800ms`，`prefers-reduced-motion` 时关闭 | `floating.css:715`、`:723-728` |
| 观察框几何 | stroke `8px`、glow `28px`、outset `36px`；窗口 = 区域外扩 outset 后与 work area 求交；内孔 = 外扩减去实际每边 inset；**贴边被裁时 stroke 画在边内侧**（`edgePadding` 先扣 stroke，余量为 glow） | `observation-frame-window.ts:5-15`、`:73-91`、`:117-139` |
| 观察框窗口属性 | 点击穿透 `setIgnoreMouseEvents(true, { forward: true })`；不进用户截图 `setContentProtection(true)`（win32）；`focusable:false` + `showInactive()` 不抢焦点；`roundedCorners:false` 防止贴边描边被圆角裁掉 | `observation-frame-window.ts:213-244`、`:252-262` |
| 观察框不得有动画 | 参考的 `observation-frame-window.spec.ts` 断言该 CSS 无 `animation`/`@keyframes`——它标记的是**区域**而不是活动，闪烁会被读成「正在工作」 | `apps/desktop/tests/observation-frame-window.spec.ts` |
| 右键菜单结构 | 可编辑时：`cut/copy/paste` 角色 + 分隔 + `selectAll` + 分隔 + 壳层动作；每项 `enabled` 取自焦点字段 `editFlags`；不可编辑时只有壳层动作。**Electron 窗口没有默认右键菜单**，所以不接这条就等于输入框无法用鼠标剪切/复制/粘贴 | `floating-window.ts:55-129`、`:122-128` |
| 弹出菜单不得叠加 | `Menu.popup` 不会替换已显示的菜单；Windows 在菜单打开期间占用该窗口的消息泵，叠加会卡住壳。pi-orb 因此加了「已有菜单打开时拒绝再开」的守卫（参考由 dsh 更外层的窗口生命周期避免） | pi-orb `src/main/shell-menu.ts` |
| 停靠滑出／滑回时长 | 滑出 `FLOATING_DOCK_SLIDE_OFF_MS = 250` + `easeInOutCubic`；滑回 `FLOATING_DOCK_SLIDE_IN_MS = 300` + `easeOutCubic` | `floating-window.ts:207-213`、`:461-471`、`:836-845` |
| 减少动效 | `systemPreferences.getAnimationSettings().prefersReducedMotion`；测试模式（`VITEST`）与窗口已销毁时同样直接落位 | `floating-window.ts:376-381`、`:407-420` |

### 5.4 球的窗口标志（必须一致，`floating-window.ts:641-666`）

`frame:false`、`transparent:true`、`alwaysOnTop:true`、`skipTaskbar:true`、`show:true`、
`hasShadow:false`、`resizable/fullscreenable/minimizable/maximizable:false`、
`roundedCorners:false`、`type:'panel'`（**仅非 Windows**）、
`webPreferences: { preload, nodeIntegration:false, contextIsolation:true, sandbox:true, webSecurity:true }`。

置顶层级：macOS `'floating'` + `relativeLevel 1`；Windows `'screen-saver'`（`floating-window.ts:611-617`）。

### 5.5 交互语义与激活方式

- 球常驻，**hover 展开、点击 pin、指针离开收起**；收起不等于退出。
- **参考项目没有任何全局快捷键或双 Alt 激活**：激活完全来自指针
  （`body pointerenter` 展开 `floating.js:1128-1137`；球点击切换 pin `floating.js:1230-1232`）。
  pi-orb 的 `globalShortcut` 与双 Alt 手势是本项目为 Product 目标新增的能力
  （`doc/pi-orb-development-goals.md` P1-03/P2-02 已声明它不是参考项目功能），
  因此它**没有参考实现可抄**，必须独立验收，也不得反过来声称“参考项目就是这样”。
- 拖动即移动；拖到屏幕左右边缘约五分之一球宽之外再松开 → 收成细灰 tab；再次 hover 滑回。
- 展开面板 = 顶部三控件（历史／权限／新建）+ 中部会话区 + 底部 72px 输入胶囊；
  浮层之间互斥，历史浮层打开时不被根节点的离开收起计时器关闭。
- 键盘可达：`:focus-visible` 轮廓、暗色主题下空态与占位文本颜色。
- 参考项目**没有**锁屏／休眠／显示器变更监听：多屏与 DPI 只靠每次操作时
  `screen.getDisplayNearestPoint` 计算（`grep powerMonitor|display-metrics-changed|display-added|
  display-removed|lock-screen|unlock-screen|suspend` 在参考 `apps/desktop/src` 仅命中
  `main.ts:1325` 的更新检查）。pi-orb 若声明“锁屏恢复”能力，属自研行为，必须单独验收。
- 点击穿透只在 Computer-Use overlay guard 路径启用（`setIgnoreMouseEvents(true,{forward:false})`
  + `blur`，按 capture/input 引用计数，`floating-window.ts:909-924`）；`setContentProtection`
  仅 Windows（同段）。观察框是常驻点透（`forward:true`，`:234`、`:251`）。
- pi-orb 差异：历史数据来自 pi-web 公开 session API，不复制参考项目的 DSH overlay history RPC；
  权限浮层内容改为 pi-orb 自己的桌面授权，不搬参考项目的 Access 三档语义。

## 6. B 面：桌面能力后端（当前复用最成熟的部分）

### 6.1 已移植清单与漂移检查

下表的“参考行数”供快速判断是否有被删减的实现。

| 参考文件 | 参考行数 | pi-orb 文件 | pi-orb 行数 | 判定 |
|---|---|---|---|---|
| `src/capture-exclude.ts` | 31 | `src/main/reference-windows/capture-exclude.ts` | 39 | 一致；`activeCaptureExcludeWindowIds` 被 `windows.ts` 读取，但**写入方无调用方**（见 §6.2） |
| `src/coordinates.ts` | 211 | `src/main/reference-windows/coordinates.ts` | 48 | **裁剪**：只保留 `mapNormalizedToGlobal` 及其私有分数换算。参考的 11 个导出里 9 个在 pi-orb 无调用方（校验职责由 `src/shared/orb-tools.ts` 的 `validateAction` 唯一承担），按 N8 删除；需要 pixel 编码时按固定提交恢复 |
| `src/wait.ts` | 34 | `src/main/reference-windows/wait.ts` | 38 | 逻辑一致（`delay` 供驱动使用，见 `windows.ts` 的指针/长按/双击/粘贴时序；`wait`/`long_wait` 工具未移植）。文件本身是 **adapted** 而非 unmodified：多出的 3 行是来源提交与许可证头，由 `evidence/p1-07/check-provenance.mjs` 逐行核对 |
| `src/observation-limits.ts` | 13 | `src/main/reference-windows/observation-limits.ts` | 16 | 一致 |
| `src/windows-foreground.ts` | 187 | `src/main/reference-windows/windows-foreground.ts` | 190 | 一致；参考自带的 10 条不变量已移植到 `tests/reference-windows-foreground.test.ts` |
| `src/windows.ts` | 494 | `src/main/reference-windows/windows.ts` | 513 | **优于参考**：补了 `try/finally` 释放已按下的键与鼠标键（参考在 20ms 修饰键间隔或 80ms 长按期间被 abort 会留下卡键）。这是本项目刻意改进，不得“还原”成参考写法 |
| `src/windows-native.ts` | 826 | `src/main/reference-windows/windows-native.ts` | 843 | **koffi 2.x 适配**：`INPUT.size` → `koffi.sizeof(INPUT)`（`:448`、`:466`、`:571`）、`EnumWindows` 句柄改用 `koffi.address()`（`:151-153`），并补 x64 `INPUT` 结构体大小校验（`:571-572`）。参考包声明 `koffi@^3.1.0`，本项目锁 `koffi@^2.14.1`：**升级 koffi 时必须重看这几处** |
| `src/backend.ts` | 277 | `src/main/reference-windows/backend.ts` | 100 | **裁剪**：删除 `createPlatformBackend` 平台工厂、macOS/unsupported 分支与 `ImageMediaType` 的 dsh 依赖；接口收窄为 Windows。`UNFOCUSED_WINDOW_NOTE` 已恢复参考原句 |
| `src/coordinate-mode.ts` | 346 | *（已删除）* | — | **删除**：只留两个类型且无调用方等于死文件；像素模式未实现，类型随死函数一并去掉 |

**参考测试的移植状态**：`windows-foreground.spec.ts` 的 10 条不变量与 `windows.spec.ts` 的 13 条
（键映射、UIPI 拒绝、Explorer 文件夹、空标题省略、剪贴板顺序、滚轮档位、focus 恢复、取消与 PNG
头）现在都在 `tests/reference-windows-foreground.test.ts` 与 `tests/reference-windows-input.test.ts`
里逐条对应，且断言文本与参考一致（只去掉了 `.ts` 扩展名差异）。

**当前可执行的收敛动作（按优先级）**：

1. `windows.ts`/`windows-native.ts` 的行数差异必须能逐行说明（是平台裁剪、pi-orb 适配，
   还是无记录漂移）。核对方法见 §11.2；当前差异均已在文件头注明来源与改动点。
2. `backend.ts` 7 个只声明未调用的方法（见 §6.2）在决定接入哪几个之前保持声明状态，
   但不得在文档里说成“已支持”。

### 6.2 已核实的移植缺口（2026 本轮审计结论）

这些是**逐条核对过源码**的现状，不是推测；每一条都应作为下一阶段的收敛项或明确“保留理由”：

| 缺口 | 事实 | 影响 | 建议动作 |
|---|---|---|---|
| `coordinate-mode.ts` 只剩类型 | **已处理**：文件删除，像素模式未实现这一事实现在写在 `coordinates.ts` 的文件头里 | 像素编码（pixel 模式）在 pi-orb 不可表达 | 需要 pixel 时按固定提交恢复该文件与 `modelPositionToHid` 调用方，不要重新推导 |
| 后端 7 个方法只声明未调用 | `inspectForeground`、`listApps`、`openApp`、`openInBrowser`、`openInFinder`、`copyImageToClipboard`、`backend.withGuiTurn` 无调用方（`ReferenceWindowsDriver` 只用 `listWindows`/`focusWindow` + `listScreens`/`capture`/`click`/`typeText`/`hotkey`/`longPress`/`drag`/`scroll`） | 模型拿不到 `inspectForeground` 的前台元数据（前台／非前台提示）；`list_apps`/`open_app`/`open_in_browser`/`open_in_finder`/`screenshot` 语义无落点 | 与 §7.1 的工具补齐一起做：先接进驱动与 Pi 工具，再接授权边界。`open_app` 另受 P2-04 的“目标重绑定规则确定后才开放”约束 |
| 捕获排除列表恒为空 | `runWithCaptureExcludeWindowIds`（`capture-exclude.ts:26`）在 pi-orb **无任何调用方**，因此 `activeCaptureExcludeWindowIds()` 永远是 `[]`（读取方 `windows.ts:325` 是活的） | GDI 截图无法排除 Orb 自己；当前靠 `withGuiTurn` 隐藏窗口（`src/main/index.ts:358`）替代 | 保留现状但写清理由；若要恢复参考的 contentProtection/排除机制，按 `floating-window.ts:909-924` 与 `overlay-guard.ts` 接入 |
| 前台提示文案被截断 | **已修复**：`UNFOCUSED_WINDOW_NOTE` 已恢复参考原句，并由 `tests/reference-windows-input.test.ts` 钉住字面量 | — | 保持；该测试就是防止再次被简写的绊线 |
| 观察新鲜度的实现方式不同 | 参考**没有** observation id／陈旧校验／限流（`grep observationId\|stale\|throttle` 无命中），靠“工具互斥 + 每次动作后重拍 + 策略禁止批式依赖动作”保证 | pi-orb 的 `observationId` + 拒绝原因 + 12 动作/5 分钟预算是**本项目新增**，不是参考语义 | 保留（这是授权边界所需），但文档里必须继续标注为 pi-orb 新增，不得说成“参考项目语义” |
| 参考测试未移植 | **已处理**：`windows-foreground.spec.ts` 10 条与 `windows.spec.ts` 13 条全部移植（`tests/reference-windows-foreground.test.ts`、`tests/reference-windows-input.test.ts`），并做过变异反证 | — | 参考升级后按 §11 对比这两个 spec 的新增用例 |
| `coordinates.ts` 有死导出 | **已处理**：11 个导出删除 9 个，只留 `mapNormalizedToGlobal`；唯一校验实现是 `src/shared/orb-tools.ts` 的 `validateAction`。`COORDINATE_SPACE = 1000` 仍在 `orb-tools.ts` 单独声明（共享层不能依赖主进程模块，且扩展包会独立打包） | 曾经同一规则两套实现 | 需要 `button`/`count`/`modifiers` 时，先在 `orb-tools.ts` 扩 schema，不要恢复参考的第二套校验 |
| 逐文件归属不完整 | **已处理**：`src/main/reference-windows/` 每个文件都有“仓库 + 提交 + 原路径 + MIT”来源头；`floating-window-controller.ts`、`floating-geometry.ts`、`src/renderer/index.html`、`floating.css`、`floating.js` 也已补头；`THIRD_PARTY_NOTICES.md` §3.5 逐文件列全 | — | 新增移植文件时同步补头与清单 |
| 存在虚假归属表述 | `src/main/double-alt.ts` 原头注释写“adapted to the reference interaction contract”，但参考项目**没有**全局快捷键与双 Alt 手势 | 把本项目新增能力说成参考项目能力，违反“不得把复用内容描述为原创”的对称要求（也不得把原创描述为复用） | 已改为明确“pi-orb 新增、无参考对应物”；审查其它头注释是否有同类表述 |

### 6.3 必须保持的坐标语义

- 模型给出的位置是 **0–1000 的截图分数**，不是屏幕坐标（`<REF>/src/backend.ts:200` 注释、
  `<REF>/src/plugin.ts:289`）。
- 换算链：`0–1000 → 分数 → screen.bounds + 分数 × bounds 尺寸`（`<REF>/src/coordinates.ts:100-123`）。
- 点击编码有两种：`millifraction`（0–1000，Windows 默认）与 `pixel`（附加截图栅格像素），
  切换逻辑在 `coordinate-mode.ts`；pixel 模式会把工具描述改写成像素语义
  （`toolsForCoordinateMode`，`<REF>/src/coordinate-mode.ts:246-304`）。
- pi-orb 现状：驱动把 `coordinateSpace.windowRect` 固定为 `{x:0, y:0, width, height}`
  （`src/main/reference-windows-driver.ts:221-225`），后端的 `mapNormalizedToGlobal` 再加回
  `screen.bounds` 原点，因此整链等价于“窗口相对分数”。**这个等价关系是当前实现的正确性依据，
  改动任一侧都会产生混合单位缺陷**（`doc/cua-driver-integration.md` 与 `evidence/p1-06/` 记录过同类缺陷）。
- 因此：**不要**新增第三套坐标约定；需要 pixel 编码时，直接用 `coordinate-mode.ts` 的参考实现。

## 7. C 面：工具契约与提示

### 7.1 参考工具面与 pi-orb 现状

参考项目注册 13 个工具（`<REF>/src/plugin.ts:278-1013`），pi-orb 注册 7 个
（`pi-package/extensions/orb.ts`）。下表按“可复用程度”排序：

| 参考工具 | 参考参数要点 | pi-orb 对应 | 差距与建议 |
|---|---|---|---|
| `click` | `screen_index`、`position [x,y]`、`button(left/right)`、`count(1\|2)`、`modifiers` | `orb_click`（元素 token 或 position） | 缺 `button`/`count`/`modifiers`；后端已支持（`ClickInput`），建议按参考补齐参数 |
| `input_text` | `screen_index`、`position`、`text`、`replace`、`submit` | `orb_type`（`text`、`element_token`） | 缺 `replace`/`submit`；后端 `TypeInput` 已支持 |
| `scroll` | `position`、`direction(up/down)`、`scroll_level` | `orb_scroll`（`direction` 含 left/right、`amount`） | 参考仅纵向；pi-orb schema 允许横向而 backend 拒绝。建议收窄 schema 与参考一致 |
| `hotkey` | `keys[]` | `orb_hotkey` | 一致；禁用组合校验来自 `coordinates.ts:47-64` |
| `long_press` | `position`、`duration_seconds` | `orb_long_press` | 一致（1–10 秒区间） |
| `drag` | `start/end position`（可跨屏） | `orb_drag`（同窗口） | pi-orb 明确不支持跨屏；保持现状并在 schema 描述中写明 |
| `wait` | 无参数，固定 1 秒后重新观察 | 无 | **建议移植**：等待后必须给新观察，是“一动作一观察”的组成部分 |
| `long_wait` | `wait_seconds ∈ {10,30,60,120}` | 无 | **建议移植**：给长耗时可见任务一个受限等待面 |
| `list_apps` | 无参数 | 无 | 可选；pi-orb 的驱动器内部用 `ops.listWindowApps()` 做 open-app 的运行前置检查，不单独暴露工具 |
| `open_app` | `name`（参考：显示名或 bundle id；**激活或启动**） | `orb_open_app`（`name`；**只激活**） | **已开放，但按用户决定收窄**：参考的 `activateApp` 失败后会 `launch`，pi-orb 只保留前半段。规则见 §7.5 |
| `open_in_browser` | 可选 `url`（仅 http(s)） | 无 | 可选；移植时必须保留 URL 校验 |
| `open_in_finder` | `path`、`reveal_only` | `orb` 无；仅有 `screenshot-export.ts` 的保存对话框 | Windows 对应 `open_in_explorer`；移植时必须保留路径解析与 realpath 校验 |
| `screenshot` | 保存到 Desktop + 写剪贴板，返回路径 | `src/main/screenshot-export.ts`（显式用户导出） | pi-orb 的产品规则是“用户确认后导出”，**不照搬自动写桌面+剪贴板**；仅复用其文件命名/像素校验思路 |

### 7.2 工具行为契约（参考项目已认定，pi-orb 应保持一致）

| 契约 | 参考位置 | 含义 |
|---|---|---|
| 一动作一观察 | `<REF>/src/plugin.ts`（每个工具 `execute` 末尾 `recapture`） | 动作后必须重新截图；实现方式是**结构性**的：全部工具 `isConcurrencySafe: () => false`，策略禁止把“依赖前一步结果”的动作批量放进同一步 |
| 动作后等待 | `<REF>/src/config.ts:14`（`postActionWaitMs` 默认 600） | 展开的菜单需要等一拍才能被枚举；pi-orb 的等价常量在 `src/main/reference-windows/windows.ts` |
| 截图快捷键禁用 | `<REF>/src/coordinates.ts:47-64` | `Win/Cmd + Shift + 3/4/5` 一律拒绝 |
| 点击修饰键白名单 | `<REF>/src/coordinates.ts:73-92` | 只允许 shift/cmd/option/control，同族去重，字母与 `fn` 拒绝 |
| 高权限窗口拒绝 | `<REF>/src/windows.ts:98`（`ELEVATED_WINDOW`） | 管理员窗口直接拒绝，不自动提权；UIPI 判定用当前进程与目标的完整性 RID 比较（`windows-native.ts:710-715`） |
| 横向滚动无实现 | `<REF>/src/backend.ts:115`（`direction: 'up' \| 'down'`） | 参考项目只有纵向滚动；滚轮每档一个 120 刻度（`windows.ts:426-430`） |
| 观察尺寸下限 | `<REF>/src/observation-limits.ts` | 观察窗口最小 64，跨进程瞬态外扩 48 |
| 栅格可用性 | `<REF>/src/raster.ts:14` | `MIN_USABLE_OBSERVATION_EDGE = 2`；只读 PNG/JPEG 头判断，不解码 |
| 提示词顺序 | `<REF>/src/plugin.ts:73`（`POLICY_SECTION_ORDER = 1750`） | 策略 section 的排序位；pi-orb 用结构化 section，不照搬序号 |
| 图像能力前置检查 | `<REF>/src/plugin.ts`（`assertImageCapableRoute`） | 纯文本模型直接拒绝桌面工具；pi-orb 已有等价拒绝（`evidence/p1-04`） |
| 前台元数据信封 | `<REF>/src/observe.ts:92-109`、`:133-144` | 每次观察带 `<frontmost_app>`/`<frontmost_window>`/`<frontmost_folder>`/`<focus_note>` 与 `<coordinate_space>`；pi-orb 目前不产生该信封 |
| **文本长度无上限** | `<REF>/src/plugin.ts:367-441`（`input_text` 无长度校验） | 参考项目不限制输入文本长度；pi-orb 限制 200 字符（`ORB_LIMITS.maxTypedCharacters`）。这是 pi-orb 收紧，属于授权/限额边界，保留并继续标注为本项目差异 |
| 失败即停与重试 | 参考项目**没有**重试、也没有“一步失败即停”的电路；pi-orb 的 `batch-stopped` 与拒绝不重试是新增 | 保留为 pi-orb 语义，不得描述成参考行为 |

### 7.3 提示词

- 参考项目把权限与坐标说明放在策略 section（`<REF>/src/policy.ts` 与 `POLICY_SECTION_ORDER`）。
- pi-orb 的对应物是 `describeOrbModeSection()`（`src/shared/orb-tools.ts:389-401`）。改写提示词时，
  必须同时更新“执行器真正强制的规则”，不能让模型被告知的规则与代码判定不一致。
- 从参考项目抄写提示词时保留其“屏幕内容是数据不是授权”的表述，这是安全要求而非文案偏好。

### 7.4 Windows 后端常量登记（已移植，改动前先核对）

| 常量 | 值 | 位置（pi-orb 与参考同名同值） |
|---|---|---|
| `POINTER_MOVE_SETTLE_MS` | `80` | `reference-windows/windows.ts:150` |
| `BUTTON_HOLD_MS` | `50` | `:151` |
| `DOUBLE_CLICK_GAP_MS` | `100` | `:152` |
| `DRAG_STEPS` / `DRAG_STEP_MS` | `10` / `20` | `:153-154` |
| `SCROLL_NOTCH` / `SCROLL_STEP_MS` | `120` / `20` | `:155-156` |
| `MODIFIER_GAP_MS` | `20` | `:157` |
| `CLIPBOARD_SETTLE_MS` / `PASTE_SETTLE_MS` | `30` / `80` | `:158`、`:160` |
| 点击顺序 | 移动 → 80ms → 每次：按下 → 50ms → 抬起（多次点击间 100ms） | `:288-295` |
| 组合键顺序 | 修饰键按下 → 20ms → 普通键按下 → 反向抬起普通键 → 反向抬起修饰键 | `:303-309` |
| `KEY_NAMES` / `windowsVirtualKey` | ctrl 0x11、alt 0x12、shift 0x10、win 0x5B、enter 0x0D、tab 0x09、esc 0x1B、space 0x20、backspace 0x08、delete 0x2E、方向键 0x25-0x28、home/end/pgup/pgdn/insert；另接受 `[a-z]`、`[0-9]`、`f1-f12` | `:100-130`、`:173-182` |
| `EXTENDED_KEY_NAMES` / `MODIFIER_VKS` | 导航与编辑键扩展；修饰键集合 `{0x10,0x11,0x12,0x5B,0x5C}` | `:133-145`、`:147` |
| UIPI 判定 | 目标完整性 RID > 自身 RID 才拒绝；任何查询异常按“不阻止”处理 | `windows-native.ts:710-715`、`:361-396` |
| 前台激活顺序 | `SW_RESTORE`（最小化时）→ 发 `VK_MENU` 按下 → `SetForegroundWindow` → 50ms 重试一次 → `finally` 发 `VK_MENU` 抬起 | `windows-native.ts:654-667`、`:53` |
| 剪贴板 | 读 `CF_UNICODETEXT(13)` 并在 `finally` 恢复；`typeText` 结束后必须还原用户剪贴板 | `windows.ts:400-419`、`:734-767` |
| DPI | `DPI_PER_MONITOR_V2 = -4`，回退 `-3`；上下文在 `finally` 还原；`GetDpiForMonitor(MDT_EFFECTIVE_DPI)` | `windows-native.ts:51-52`、`:226-232` |
| 绝对指针 | `dx = round((x - SM_XVIRTUALSCREEN) * 65535 / max(1, SM_CXVIRTUALSCREEN - 1))` | `windows-native.ts:421-443` |
| GDI 截图 | `GetDC(null)` → `CreateCompatibleBitmap` → `BitBlt(SRCCOPY=0x00CC0020)` → `GetDIBits`（32 位、`biCompression 0`），`finally` 释放 | `windows-native.ts:671-709` |
| PNG 编码 | RGBA（alpha 固定 255）、可选 bottom-up 翻转、`deflateSync` IDAT、`crc32` chunk | `windows.ts:209-246` |
| 窗口选择算法 | 壳类 `Shell_TrayWnd/Shell_SecondaryTrayWnd/Progman/WorkerW`、瞬态类 `#32768/ComboLBox`、owner 链循环安全遍历、瞬态必须同监视器 | `windows-foreground.ts` |
| 观察栅格下限 | `MIN_USABLE_OBSERVATION_EDGE = 2`（参考 `raster.ts:14`，pi-orb 未移植） | `<REF>/src/raster.ts` |
| 文本输入替换 | `replace` 走 `Ctrl+A`，`submit` 走 `Enter`；全程剪贴板粘贴 | `<REF>/src/windows.ts:400-419` |
| URL 与路径校验 | 空串拒绝、CJK 百分号编码拒绝、非 http(s) 拒绝、带 userinfo 拒绝、自动补 `https://`；POSIX 黑名单 `/System /private /etc /var /usr /sbin /bin /dev /proc /sys` | `<REF>/src/open.ts:19-42`、`:87-110` |
| 幂等启动参数 | `long_press` 默认 3 秒、范围 1–10；`wait` 固定 1 秒；`long_wait ∈ {10,30,60,120}` | `<REF>/src/open.ts:11-17`、`wait-args.ts:7`、`:10` |

未移植但已具备实现条件的（按需要取用）：`raster.ts`（头部校验）、`screenshot.ts`（`Desktop/Screenshot YYYY-MM-DD at HH.MM.SS.png`，冲突后缀 2–100 后报错）、`open.ts`（URL/路径校验）、`wait-args.ts`（等待取值）。

### 7.5 `orb_open_app` 的目标重绑定规则（pi-orb 收窄，非参考语义）

参考工具的语义是“把正在运行的应用前置，**或者启动它**”（`<REF>/src/windows.ts:398-404`：
`activateApp` 失败即 `launch`）。pi-orb 只保留前半段：当用户记录了一个窗口并授权一次任务时，
“启动一个新进程”是用户没有授予的原生权限，因此这条路径上 `launch` 必须不可达。

判定顺序（三步全过才重绑定，任一步失败都保留原目标并使动作失败）：

1. **运行前置检查**：`ops.listWindowApps()` 里必须出现匹配项。比较是**基名相等**（
   `Notepad` == `notepad.exe`，忽略大小写与 `.exe` 后缀），**不是子串匹配**——子串会让
   “标题里含 notepad 的浏览器窗口”被选中，正是本项目禁止的错目标类型。
2. **激活**：调用 `ops.activateApp(match)`（返回 `false` 不启动任何东西，与 `backend.openApp`
   不同）。失败即动作失败。
3. **前台验证**：激活后前台窗口的应用必须仍等于请求的应用；否则说明前置的不是它，
   动作失败且**不采纳**前台窗口——驱动绝不“顺手采用当前前台”，那是被禁止的驱动自选目标。

通过后的行为：adopted 窗口成为该任务的新目标，并通过 `onTargetChanged` 上报壳层，面板显示
新目标标题，用户可随时 Revoke；用户重新选择或记录窗口、以及任何撤权路径都会清掉这个覆盖。
模型侧 `name` 参数在 `validateAction` 里已拒绝路径、参数样片段、shell 元字符与控制字符，
`src/main/reference-windows-driver.ts` 的 `#openApp` 是唯一实现点，单测为
`tests/reference-windows-open-app.test.ts`（含“未运行必须失败且不调用 launch”）。

## 8. D 面：授权与生命周期

| 参考机制 | 参考位置 | pi-orb 的处理 |
|---|---|---|
| overlay 隐藏/点透（capture 期间排除自身，HID 期间点透） | `floating-window.ts` 的 `applyFloatingOverlayGuard`（`:938`）、`overlayWindowExcludeIds`（`:897`） | 已用等价机制接入（`withGuiTurn`）；改动浮球时必须回归 overlay 排除 |
| overlay 包裹后端调用 | `<REF>/src/overlay-guard.ts:102-153`（`wrapDesktopBackend`） | 参考实现把 `capture/listScreens/inspectForeground/HID/openApp/withGuiTurn` 统一包裹；pi-orb 目前只包裹 `withGuiTurn`，如需更细粒度按此扩展 |
| 观察框显示/隐藏并在 turn 结束时收起 | `<REF>/src/plugin.ts:268-275`（`turn/end` → `setObservationFrame(null)`） | pi-orb 无观察框；若 P2 接入，必须同样在 turn 结束与异常路径收起 |
| 用户批准／提问 | `<REF>` 的 user-approval / user-questions 相关包 | pi-orb 用自有授权（任务、代次、目标、限额），**不搬自动审批** |
| 取消传播 | 参考 backend 的 `AbortSignal` 语义 | pi-orb 已接通 broker → driver → backend；C6 取消探针见 `evidence/p1-05/reference-cancel.json` |

**不可让步的三条**（与参考项目的最大产品差异，任何“参考项目就是这样”都不能推翻）：

1. 目标窗口必须由用户记录并授权，驱动不得自动选择前台窗口。
2. 截图与桌面操作必须显式授权；唤醒、cwd 匹配、`/orb` 字符串都不构成授权。
3. 断连、重载、换会话、锁屏、收起、退出都必须撤权并释放按键／鼠标／监听器。

## 9. E/F 面：工程、验证与文档约定

### 9.1 测试不变量优先移植

参考测试按主题分布（`<REF>/packages/experimental/tool-computer-use/tests/`）：

| 参考规格测试 | 钉住的不变量 | pi-orb 对应测试 |
|---|---|---|
| `coordinates.spec.ts`（10） | 坐标校验、两种编码等价、禁用快捷键、点击修饰键别名与去重 | `tests/coordinate-mapping.test.ts`、`tests/orb-tools.test.ts`；**缺** pixel 模式与 `requireClickModifiers` 别名用例 |
| `coordinate-mode.spec.ts`（9） | 两种编码切换、栅格缓存与日志重建、pixel 工具描述改写、投影折叠 | 无（像素模式未接入） |
| `tools.spec.ts`（26） | 13 个工具的往返、`postActionWaitMs` 结算、GUI turn 包裹范围、截图落盘与剪贴板 | `tests/desktop-broker.test.ts`、`orb-tools.test.ts`、`reference-windows-driver.test.ts`、`screenshot-export.test.ts`、`reference-windows-open-app.test.ts`（open-app 的前置检查／激活／前台验证三步）；**缺** 结算时序、GUI turn 范围、Desktop 落盘/剪贴板 |
| `observe.spec.ts`（9） | 观察信封与前台标签、`settleMs`、`persistCapture` 过滤、abort 重抛 | `tests/screenshot-flow.test.ts`；**缺** 信封/标签格式与 `requireScreen` 越界文案 |
| `overlay-guard.spec.ts`（17） | 包裹范围、overlay id 传递、观察框显示/隐藏与 abort、turn 结束收起 | 无；`withGuiTurn` 的窗口隐藏也未测 |
| `windows-foreground.spec.ts`（10） | 壳类/瞬态过滤、owner 链、同监视器并集、监视器分离 | `tests/reference-windows-foreground.test.ts`（10/10，逐条对应） |
| `windows.spec.ts`（13） | 键名映射、扩展键、剪贴板恢复、焦点恢复时序、UIPI 拒绝、截图失败包装 | `tests/reference-windows-input.test.ts`（13/13，逐条对应） |
| `wait.spec.ts`（5）、`wait-args.spec.ts`（2） | `delay` 的取消语义与等待取值 | 无（`wait.ts` 已移植但无测试、无工具） |
| `raster.spec.ts`（3）、`screenshot.spec.ts`（11） | 栅格可用性、Desktop 落盘命名与去重 | 无（对应模块未移植） |
| `open.spec.ts`（6） | 长按时长、URL 校验、路径黑名单 | 部分：`orb_open_app` 的 name 校验与激活规则见 `tests/reference-windows-open-app.test.ts`、`tests/orb-tools.test.ts`；URL/path 模块未移植 |
| `unsupported.spec.ts`（4）、`loader-composition.spec.ts`（3）、`preset*.spec.ts`、`macos.spec.ts`（40） | 平台回退、Cordis 装配、preset 目录、macOS | 不适用 |
| `code-agent.spec.ts`（28）、`pre-step.spec.ts`（4） | 后台代理编排、自动前置观察 | 不适用（pi-orb 不自动观察、无 code_agent） |
| `apps/desktop/tests/floating-window.spec.ts` | 停靠、拖动、多屏、展开几何；并断言 CSS `--chrome:12px` 与 tab `6px/72px/#75757F` 与主进程常量一致 | `tests/floating-geometry.test.ts`；**CSS 与主进程常量的一致性**由 `tests/renderer-reference-parity.test.ts` 补上 |
| `apps/desktop/tests/floating-renderer.spec.ts`（104 KB） | renderer DOM 状态机与交互（JSDOM 跑真实 `floating.html`+`floating.js`，只 fake `fetch` 与 `window.dshDesktop`） | 部分：`tests/renderer-reference-parity.test.ts` 钉住令牌/状态/id 与参考一致；**交互时序本身**仍靠打包探测（`evidence/p2-05/packaged-smoke.json`）与人工验收，没有 JSDOM 状态机测试 |
| `apps/desktop/tests/observation-frame-window.spec.ts` | 观察框 CSS 不得含 `animation`/`@keyframes`，stroke/glow 回退值同步 | 不适用（无观察框） |
| `apps/desktop/tests/selection-*.spec.ts`、`windows-selection.spec.ts` | 选区读取与工具栏行为 | `tests/windows-selection.test.ts`（读取路径） |

移植测试时保留参考项目的**判定依据**（目标自身日志、栅格尺寸、事件序列），不要退化成
“函数返回成功即通过”——`CHANGELOG.md` 里记录的多起缺陷正是这样产生的。

### 9.2 工程约定

- 参考项目要求每个模块与导出有 JSDoc（`<REF>/AGENTS.md:170-172`）。pi-orb 已在关键模块
  （`orb-tools.ts`、`reference-windows-driver.ts`）执行；新增模块沿用。
- 参考项目“注册即副作用、返回 disposer”“配置项必须可配置、常量只留协议/安全不变量”
  （`<REF>/AGENTS.md:131-142`）可直接用于 pi-orb 的工具注册与限额设计。
- `docs/defensive-patterns.md`、`docs/agent-lifecycle.md` 是生命周期、并发、子进程与清理
  写法的参考读物；pi-orb 的窗口生命周期与撤权路径应先对照再改。
- Windows 打包/签名/安装器脚本（`apps/desktop/tests/windows-*.ps1`、`windows-sign*.spec.ts`）
  属发布基础设施，不属于运行时行为；P2-05 的结论见 §9.4，不要凭印象提前引入别的形态。

- 来源记录现状：`src/main/reference-windows/*`、`floating-*.ts`、`src/renderer/index.html`、`floating.css`、`floating.js` 均有
  “仓库 + 提交 + 原路径 + MIT”来源头，并同时登记在 `THIRD_PARTY_NOTICES.md` §3.5。
  **新增移植文件时必须两处都补**，否则来源不可追溯。
- 参考项目的依赖版本差异必须跟：参考包声明 `koffi@^3.1.0`，本项目锁 `koffi@^2.14.1`；
  移植时的 `koffi.sizeof`/`koffi.address` 适配就是为此。升级 koffi 时重看
  `windows-native.ts:148-156`、`:448`、`:466`、`:571-572`。
- 参考项目“文档伴随代码改动”“当前状态陈述、一个事实只有一个归属”的写法
  （`<REF>/AGENTS.md:174`、`docs/AGENTS.md`）与 pi-orb 现有约定一致，继续沿用。

### 9.3 文档与证据

- 每次 UI 或架构改动都要在阶段文档中写明：参考文件（含行号）、源提交、复用方式、
  未复用原因——格式见 `doc/p2-01-reference-reuse.md`。
- 可复现验证写入 `evidence/<阶段>/`，并在 `evidence/README.md` 建索引。
- 事实只写一处：版本兼容性只在 `support-matrix.md`；产品不变量只在
  `pi-orb-development-goals.md`；本文件只负责“参考索引 + 取材规程”。

### 9.4 F 面：打包与分发（P2-05 已落实的形态）

参考项目的发布管道服务于“随包分发一整套 dsh 运行时”，pi-orb 连接用户自己的 pi-web，
因此**只复用形态，不复用管道**。已确定的复用与不搬边界：

| 复用（同形） | 参考位置 | pi-orb 落点 |
|---|---|---|
| electron-builder + JS 配置模块（不用 yml） | `apps/desktop/scripts/electron-builder-config.mjs` | `electron-builder.config.mjs` |
| Windows 只有 NSIS，每用户安装、禁止提权 | `:235`、`:245-247` | `win.target`、`nsis.perMachine/allowElevation` |
| `asar: true` + 原生模块解包 `**/*.{node,dll,exe}` | `:112`、`:71-72` | 同名键 |
| 未签名产物不带更新源（`publish: null`） | `:253` | `publish: null` |
| 裁剪第三方包内的构建残留 | `scripts/runtime-file-policy.ts:42` | `files` 排除段 |
| 调用形状 `--config <file> --win --x64 --publish never [--dir]` | `scripts/package-target.ts:267-283` | `package:win` / `package:win:dir` |

| 不搬 | 原因 |
|---|---|
| `DSH_DESKTOP_*` 环境契约（含必需的 `appId` 校验） | 那是 dsh 发行身份，不是 pi-orb 的 |
| 随包 Node 运行时、`dsh/` 负载、`prepare:*` 系列 | pi-orb 包里没有第二套运行时 |
| 自定义 NSIS 页面 / `installer.nsh` / `window-frame.dll` / `installWindowsDirectoryInstaller()` | 靠字符串替换 `app-builder-lib` 固定模板，升级即碎 |
| eToken 签名链、发布记录、上传与 `nightly.yml` 更新源 | v0.1 不签名、不发布自动更新 |
| macOS `dmg`/`zip`、Linux `AppImage` 目标 | 未验证的平台不得声明支持 |

**改动打包配置前必须先看的三个非默认决定**（理由写在 `electron-builder.config.mjs` 与
`doc/p2-05-distribution.md` §4）：`npmRebuild: false`（发出去的必须是证据测过的预编译二进制）、
`files` 排除段（否则 smart unpack 会把 C++ 源码与其它平台二进制打进包）、
图标由已批准的 `orb-avatar.png` 派生（不新增品牌素材）。

验证一律走 `node evidence/p2-05/run-p2-05.mjs`（构建 → 内容审计 → 启动打包产物），
不要用“安装包构建成功”代替内容与运行证据。

## 10. 常见开发任务的作业流程

### 10.1 改浮球窗口或面板

1. 查 `<REF>/apps/desktop/src/floating-window.ts` 的常量与状态机（§5.2）。
2. 查 `<REF>/apps/desktop/renderer/floating.css` / `floating.html` 的 DOM 与样式规格。
3. 改 pi-orb：`src/main/floating-geometry.ts`、`floating-window-controller.ts`、
   `src/renderer/index.html`、`src/renderer/floating.css`、`src/renderer/floating.js`。
4. 更新 `tests/floating-geometry.test.ts`；人工项写入 `doc/manual-acceptance.md`。
5. 在阶段文档记录参考行号与差异。

### 10.2 新增或修改桌面工具

1. 在 `<REF>/src/plugin.ts` 找到同名工具，抄下参数、描述、返回结构与错误语义。
2. 在 `src/shared/orb-tools.ts` 定义/更新 Pi 侧参数与拒绝原因（`ActionRefusal`）。
3. 在 `pi-package/extensions/orb.ts` 注册工具，保持描述与执行器一致。
4. 在 `src/main/desktop-broker.ts` / `desktop-task.ts` 补授权、预算、新鲜度校验。
5. 在 `src/main/reference-windows-driver.ts` 映射到参考 backend 方法（缺方法先去
   `<REF>/src/backend.ts` 看参考如何定义）。
6. 补测试：`tests/orb-tools.test.ts`（schema/拒绝）、`tests/desktop-broker.test.ts`（授权与一步一观察）、
   `tests/reference-windows-driver.test.ts`（驱动映射）。
7. 需要真机验证的（真实按键、目标像素）登记到 `doc/manual-acceptance.md`，不得用 mock 代替。

### 10.3 改坐标或 DPI 行为

1. 先读 `<REF>/src/coordinates.ts` 与 `<REF>/src/coordinate-mode.ts` 全文。
2. 对照 pi-orb 的等价链路：`orb-tools.ts` 的 `positionToRequest` 与
   `reference-windows-driver.ts` 的 `windowRect`、`windows.ts` 的 `mapNormalizedToGlobal`。
3. 任何改动都必须同时更新 `tests/coordinate-mapping.test.ts` 和
   `tests/reference-windows-driver.test.ts`，并在 disposable target 上重跑 C7/D6/D8 类证据。
4. 有疑义时以目标自身日志与真实模型整链路实测为准（`evidence/p1-06/`），不以直调探针裁决。

### 10.4 改授权、撤权或生命周期

1. 读 `<REF>/src/plugin.ts` 的 turn 结束处理与 `<REF>/src/overlay-guard.ts` 的 abort 语义。
2. 对照 pi-orb 的单一撤权出口（`src/main/index.ts`、`src/main/window-lifecycle.ts`）。
3. 必须覆盖：折叠、停止、turn 完成/失败、断连、换工作区、退出。
4. 回归 `tests/window-lifecycle.test.ts`、`tests/desktop-broker.test.ts`，并更新
   `evidence/p1-07/lifecycle-regression.json` 类记录。

### 10.5 参考项目代码如何进仓

1. 复制最小必要文件到 pi-orb 的对应目录，保留原文件头注释与 `@module` 标识。
2. 顶部补一段来源说明：参考仓库、提交、原路径、许可证、本文件改动点。
3. 相对导入按 pi-orb 的 `tsconfig` 路径风格调整（参考项目用 `.ts` 后缀，pi-orb 用无后缀）。
4. 不修改参考项目算法去“适配”pi-orb 的偏好；需要差异时改适配层。
5. 同批提交测试；`THIRD_PARTY_NOTICES.md` 与 `CHANGELOG.md` 同步更新。

### 10.6 改打包、安装包或分发形态

1. 先在 §9.4 的复用／不搬表里定位这一改动属于哪一类；涉及签名、自动更新、多平台时先停（§15）。
2. 只改 `electron-builder.config.mjs` 与 `package.json` 的脚本；不要把 dsh 的 `prepare:*`
   管道搬进来。
3. 改动原生模块解包、`files` 裁剪或 `npmRebuild` 前，先回答“这会不会改变发出去的二进制”；
   会的话必须重新跑全量原生证据，而不是只看打包是否成功。
4. 跑 `node evidence/p2-05/run-p2-05.mjs`（构建 → 内容审计 → 打包产物启动探测），
   两个 JSON 都要通过；只通过其中一个不算完成。
5. 安装、卸载、升级、SmartScreen 的结论只能来自 `manual-acceptance.md` §9 的人工执行。
6. `CHANGELOG.md`、`support-matrix.md`（保持“未验证”直到 §9 有结论）、`doc/p2-05-distribution.md`
   三处同步；门禁会检查打包配置与审计记录是否仍在。

## 11. 与参考项目同步

### 11.1 重新获取检出

```powershell
New-Item -ItemType Directory -Force D:\pi-orb-ref | Out-Null
git clone https://github.com/rain-knows/deepseek-harness-orb.git D:\pi-orb-ref\deepseek-harness-orb
git -C D:\pi-orb-ref\deepseek-harness-orb checkout 72f1d738458a223696685a909e806b683eff5885
```

### 11.2 核对提交与差异

1. `git -C <检出> rev-parse HEAD` 必须等于固定提交；不等时先停下核对，不直接照搬新代码。
2. 对 `src/main/reference-windows/` 的每个文件与参考同名文件做行级差异（`diff` 或编辑器对比），
   把差异归类为：平台裁剪 / pi-orb 适配 / 无记录漂移。无记录漂移必须补齐说明或还原。
3. 参考项目更新后，先跑 pi-orb 的 backend 合同测试与 disposable 目标验收，再决定是否升级固定提交。
4. 升级固定提交需要同步更新：`AGENTS.md`、本文件 §1／§6.1／§6.2、`doc/support-matrix.md` §1、
   `CHANGELOG.md`、相关 evidence 记录。

### 11.3 固定提交的边界

- 固定提交是**可复现的复用基线**，不是“只要上游变了就跟着变”。
- 未经验收的新提交不得直接进入生产路径；新平台实现（如 macOS）必须在真机验证后单独记录。

## 12. 许可证与归属

| 义务 | 做法 |
|---|---|
| 保留版权与许可 | 复用文件保留 MIT 声明；仓库根 `LICENSE`、`THIRD_PARTY_NOTICES.md` 记录来源提交与路径 |
| 来源可追溯 | 每批复用在本文件或阶段文档登记“参考路径 → pi-orb 路径 → 提交 → 改动点” |
| 不冒充原创 | 文档与提交信息中把复用内容描述为“移植自参考项目”，不写成本项目设计 |
| 不默认背书 | 不把 pi-orb 描述为 DeepSeek 或参考项目的官方产品；不使用其商标做背书 |
| 第三方素材 | 参考项目的品牌素材、GIF 头像、图标不直接搬；使用前单独核对许可 |

## 13. 验证与证据要求

| 类型 | 要求 |
|---|---|
| 单元/协议测试 | 新增或修改的工具、坐标、授权逻辑必须有 `tests/` 覆盖；拒绝路径与正常路径同等对待 |
| 参考一致性 | 移植的常量、schema、状态机要有对照记录（参考行号 + pi-orb 行号）。**文档里写下的常量必须有测试同时断言代码值**——本手册 §5.2/§5.3 的 `COLLAPSE_MS = 180` 曾长期与代码里的 `480` 并存（手册对、代码错、无人比对），现由 `tests/playbook-constants.test.ts` 双向钉住：代码改了会失败，手册改了也会失败 |
| 真机证据 | 真实按键、多屏、DPI、高权限窗口、真实模型只能由 `doc/manual-acceptance.md` 的人工步骤判定 |
| 反向对照 | 门禁类检查必须能证伪（参考 `evidence/p1-07/` 的“注入后必须失败”做法） |
| 未验证标注 | 未取得结论的能力一律写“未验证”，不得用删除记录、放宽断言或 mock 变绿 |
| 打包产物 | 不得用“安装包构建成功”代替证据：必须分别证明**包内有什么**（内容审计）与**它能不能跑**（启动打包产物并驱动 renderer / 调用一次真实桌面枚举） |
| 人工边界 | 安装、卸载、升级、SmartScreen 属于干净环境人工项，登记在 `manual-acceptance.md` §9，不得在开发机上冒充已验证 |

## 14. 提交前检查清单

- [ ] 是否已在 §4／§5／§6／§7 里定位到参考文件与行号？
- [ ] 能直接移植的部分是否真的移植了（而不是重写）？
- [ ] 适配差异是否落在 §3.1 允许的 5 类内，并在阶段文档写明？
- [ ] 常量、schema、DOM/CSS、状态机是否与参考一致；不一致处是否有测量或产品理由？
- [ ] 若改动 renderer：是否仍通过 `tests/renderer-reference-parity.test.ts`（令牌名、`body.<state>` 词表、参考 id、无残留 `orb__*`），以及打包探测里的「参考壳层已挂载／令牌解析为参考值」两条？
- [ ] 是否误引入了 §3.2 的不可搬内容（Cordis/dsh 会话/自动观察/自动审批）？
- [ ] 目标窗口授权、截图授权、撤权路径是否仍然成立？
- [ ] 测试是否覆盖拒绝路径与取消路径？真机项是否登记到 `manual-acceptance.md`？
- [ ] 来源提交、许可证、`THIRD_PARTY_NOTICES.md`、`CHANGELOG.md` 是否同步？
- [ ] `support-matrix.md` 是否需要按“已验证/未验证”更新（不得两处并存）？
- [ ] 若改动打包配置：是否仍保持 `npmRebuild: false`、`asarUnpack` 原生模块、每用户 NSIS，
      并跑过 `node evidence/p2-05/run-p2-05.mjs`？

## 15. 阻塞与停止规则

- 参考实现与 pi-orb 现状冲突：先记录**具体符号、实际行为、复现步骤、替代方案**，再决定改动。
- 需要改上游（pi-web/Pi）才能继续：停下询问用户，不采用 monkey patch、不改 `node_modules`、
  不维护整仓 fork。
- 需要扩大原生权限（自动提权、后台自动批准、跨屏拖拽、任意路径打开）：
  属于产品边界变更，必须先经用户确认。
- 参考项目缺少 pi-orb 必需能力：先在本文件补一节“参考项目没有此能力”的记录，
  再写最小实现，并在证据中说明为何不能复用。
