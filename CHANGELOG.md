# Changelog

All notable changes to pi-orb are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Version numbers are meaningful only together with a row in
[`doc/support-matrix.md`](./doc/support-matrix.md). A combination that has not been
verified is recorded as *unverified* and is not claimed as compatible.

## [Unreleased]

- 同步 `mini-yifan/dsh-orb-cordis@aa79308` 的全部适用增量：系统光标拖动、Windows 缩放吸边及显示器接缝、输入框固定、后台书签和折叠报告、用户停止后的禁止自动重启、GUI 共享互斥、系统路径前置拒绝与观察框彩带开关。
- 删除 renderer 屏幕坐标移动接口；复用参考状态模型和测试，Pi 会话/API 边界保留。dsh 运行时下载、自更新、系统级安装身份和 Cordis 挂载改动不适用于 Pi 分发；完整逐文件处置见 `evidence/reference-sync/reference-manifest.json` 和 `doc/reference-playbook.md`。

## [0.1.0-preview.3] - 2026-10-05

Windows x64 未签名预览版。包含此前未发布的 Pi Web 0.10 / Pi 1.0、个人安装与启动改进，
并全面切换到固定插件参考 `dsh-orb-cordis@9cdc503` 的工具设计。

### 参考工具集替换与后台任务

- 使用 13 个直接 GUI 工具和 3 个后台工具；首帧自动附加，动作后返回新截图，坐标统一为截图相对 0–1000 millifraction。
- 删除 `orb_observe`、`orb_batch`、`orb_browser`、DOM/Playwright 网关及旧浏览器扩展；不保留兼容层或静默回退。
- `code_agent` 通过独立 Pi Web session 执行，支持继续任务、归属隔离、状态查询和停止；前后台均空闲后单次通知结果。
- 直接移植完整前台策略和 8192/4096/1024 字符结果预算；只保留最新 Orb 观察图作为模型上下文，完整持久历史不变。普通 Pi Web 与后台 worker 不获得 GUI 工具。
- 修正后台 provider 失败只发 settled 时误报成功的问题，回读公开会话接口的最终助手错误。
- `open_app` 直接复用参考 backend 激活或启动，600ms 后返回实际前台截图；慢启动不再因重复前台匹配误报失败。
- 483 项单测通过；真实模型点击 20/20、滚动 21/21、输入 22/22、可见浏览器 22/22、应用冷启动 22/22；后台完成 8/8、产品桥停止 10/10、真实 provider 失败回读 12/12。均为有限样本，不构成长期成功率承诺。

### Windows 启动与工作区

- 直接隐藏运行 Pi Web 包的 Next.js 正式生产入口，消除启动器二次 spawn 的黑窗口；保留日志与后端复用。
- 安装器、快捷方式、窗口与托盘统一使用参考图标底板加 Pi 标识，移除蓝色方块托盘。
- 悬浮球右键和托盘增加工作区切换；取消/选择当前目录不改变会话，切换前停止旧任务并清理旧上下文。
- Full Access 默认授权变更实时同步到界面，Stop、隐藏、断连等撤权仍有效。

### Windows 个人安装与启动（包含未发布的 preview.2 改进）

- 每用户安装后支持 Win+R `pi-orb`；第二实例唤回已有浮窗，不覆盖握手与快捷键。
- 独立 Pi 插件随包；首次备份设置后通过官方 CLI 注册，移除旧同名本地包。无需克隆 Orb 源码；本版不再携带浏览器 DOM 网关依赖。
- 已有 Pi Web 直接复用，未运行从确认的官方入口隐藏启动；不打开浏览器、不重启已有服务，退出 Orb 保留共享后端。
- 卸载经 Pi CLI 移除随包登记，清理本安装 Win+R 登记，保留用户数据。
- 打包门禁加入真实 Pi 独立插件加载；干净机器安装/升级与 SmartScreen 仍未验证。

### Pi Web 0.10 / Pi 1.0

- 开发 SDK 锁定 1.0.0，与 Pi Web 0.10 宿主一致。Orb 以 `prompt_done` / `agent_settled`
  识别逻辑完成，避免重试、压缩或 follow-up 的中间 `agent_end` 提前推进队列；停止后拒绝旧流事件。
- 桌面观察/输入工具声明 model-only，Code mode only 下保留直接模型声明与图片上下文。
  Orb 专用工作区在 session_start 关闭 advisor，普通会话保持原有插件行为。
- 本机全局 Prompt Architect 改为命名策略段追加，删除复制 Pi 主提示词和旧 MCP gateway 路由；
  本机迁入原生 MCP 并移除旧 adapter。全局配置改动为本机升级，不作为 Orb 通用策略依赖。
- 482 单测、29 项 provider 提示词审计、5 个原生 MCP 连接、真实模型搜索、21 项生命周期、
  7 个真实桌面任务、打包审计 27/27 与启动 22/22 通过；Pi Web 全量测试限制及详细来源见
  [升级记录](./doc/workspaces-sessions.md)。这是该次升级的历史记录，当前验证见工具集迁移记录和支持矩阵。

## [0.1.0-preview.1] - 2026-10-01

首个 Windows x64 未签名预览版，标为 GitHub prerelease；未验证项与完整 v0.1 门槛仍以
[`doc/support-matrix.md`](./doc/support-matrix.md) 为准。README 更新为中文使用入口，补充
安装器与独立 Pi 插件的安装、启动、Access 默认值、最新像素取点结果及验证边界。

### 插件参考更新

- 本地检出并固定 `dsh-orb-cordis@9cdc503`，加入参考手册与阶段文档。旧单体远端
  `51f0976` 仅 Windows 发布身份调整，Computer Use 无差异，生产原生后端保留现基线。
- 直接移植插件的图片尺寸解析及 pixel → HID 校验/换算；模型按实际附件像素取点，缓存绑定
  会话、generation 与 observation_id，整批预检后才发送输入。模型不再使用 0–1000 坐标。
- context 预算由三图缩为最新一图，保留完整持久历史。紧凑与 28×24 DIP 夹具各 7/7 任务通过；
  批量三控件中位耗时分别 12.38s/11.68s，单步约 18.42s；有限样本不外推到任意应用。
- 保留启动失败与原生退出证据；复跑旧分数版本遇到 `0x80000003`，当前未确认退出根因。
  来源、实验环境和验证边界见 `evidence/tool-speed/README.md`。
- Koffi 精确更新至 `2.16.3`，采用官方 Node/Windows 回调崩溃修复，现有 native 适配接口不变；
  实际 Electron 1000 次枚举 + 50 次捕获压力探针通过。不把有限无崩溃样本当成精确根因证明。
- 更新依赖后微小控件真实模型再跑 7/7，批量中位 11.03s、单步 18.99s；累计三个完整轮次 21/21。
- 排除 Koffi 新增 lib/native 头文件，并补审计反证、版本/二进制一致性检查；修正后的解包产物
  内容审计 27/27、实际启动 22/22，通过完整 P2-05 runner；未重建历史安装器。

### 工具调用提速（此前四阶段）

- 请求关联计时、串行批量工具、协议 v2、取消与按动作数/声明等待计算的超时。
- context 仅保留最近三张 Orb 工具截图；用户附件和持久历史保持不变。
- 1500 次等待对照不满足缩短条件，保留 600ms。真实模型大控件对照中响应次数从 5 降至 3；小控件误点记录保留，不宣称普遍提速。
- 453 测试、权限生命周期、原生 Stop/窗口变化及打包审计/启动通过。来源、原始数据和限制见 `evidence/tool-speed/README.md`。

### Fixed

- **通用桌面操作与浮球体验收敛。** 截图按请求选择非 Orb 原生窗口，移除唤醒快捷键锁定依赖；
  桌面动作后接收新原生窗口的观察。直接移植参考 `floating-window.ts` 的计数式截图排除／
  点击穿透，工具调用期间不再隐藏整个面板。输入焦点、草稿和问题阻止自动收起；工具过程
  使用紧凑中文状态行；运行中空输入框隐藏光标，停止按钮改为方形图标。新 Orb 会话默认
  完全访问，停止、隐藏及断连仍撤权；文件和后台任务使用 Pi 原有工具。参考提交、差异和
  验证边界见 [`evidence/frontend-port/visual-review.md`](./evidence/frontend-port/visual-review.md)。

- **Aligned `orb_open_app` with the reference action timing.** The Windows driver now waits the
  reference `POST_ACTION_WAIT_MS` settle period after activation and before foreground inspection
  and recapture, so a slow window switch cannot be reported as a fresh observation of the old target.
  Stage 6 lifecycle, packaging and the latest real-model rerun results are recorded in
  [`evidence/p1-07/CONTRACT-MATRIX.md`](./evidence/p1-07/CONTRACT-MATRIX.md); the failed C7/D6/D8 rerun JSON is
  retained and the support matrix leaves those model-side contracts unverified.

- **An orb left on a disconnected monitor could not be brought back.** P2-01's criterion is that the
  floating orb "stays findable" across multi-display, DPI and work-area changes, and the wake paths
  violated it: `showOrb` and the `WakeController` callback both called `window.show()` without
  re-clamping first. Unplug the display the orb was parked on — or shrink the work area, or change the
  DPI — and it returned at coordinates that exist on no screen: invisible, unclickable, and impossible
  to summon again because the tray, the global shortcut and the double-Alt gesture all lead there.

  The reference has no display-change handling either, so this was not a reuse gap but pi-orb's own
  requirement unmet, which is why the fix lives in the shell's show path rather than in the ported
  geometry. Both routes now call one shared `presentOrb`, which re-clamps into the current layout
  before showing. That sharing is the point: the two paths had already diverged on exactly this step,
  and the file's own comments record an earlier instance of the same problem with two hide paths.

  Two details worth stating: the clamp is awaited, because it can animate a dock slide and showing
  first would park the orb at the old coordinates and then jump it; and a clamp failure is caught and
  logged, because a shell that cannot reposition itself must still appear — refusing to show is worse
  than showing in the wrong place.

  Verified in the packaged app: parked at `x=8988` (beyond every display), the clamp returns it to
  `x=1673,y=971` inside the real `1707×1067` work area. Pinned by `tests/floating-recovery.test.ts`
  (removed display, surviving second display, shrunk work area, and a property check over hostile
  coordinates) plus a packaged-probe check.

  A correction to that probe check, worth recording: my first version claimed "an orb parked off every
  display comes back **on wake**" while calling `clampFloatingBall` directly. Disabling the wake path's
  clamp left it passing — it was testing the IPC handler, not the wake. The probe cannot press the
  tray, the shortcut or the double-Alt gesture, and adding a bridge method purely to be testable would
  be a product surface that exists for tests. The check is renamed to say what it actually covers
  (the shared geometry), and the wake sequence itself is documented as covered by the unit test.

- **Three interaction behaviours in the floating shell had drifted from the reference's state
  machine**, found by comparing the renderer against `floating.js` the way the stylesheet and the
  window geometry were compared:

  - **The collapse delay was 480ms; the reference's is 180ms** (`COLLAPSE_MS`, `floating.js:3`). A
    pointer leaving the panel took almost three times as long to close it, which reads as the panel
    sticking open. The timings now live under the reference's names — `COLLAPSE_MS` (180),
    `ANIMATION_MS` (300), `DOCK_HOVER_DELAY_MS` (800) — and the panel's `hidden` is applied after
    `ANIMATION_MS` rather than a repeated literal.
  - **Two of the reference's collapse guards were missing** (`floating.js:528`:
    `pinned || running || asking() || gatingTcc() || dragging || hasSelectionChip()`). pi-orb had
    `pinned`/`busy` but not `dragging` or the selection chip's, so a pointer leaving during a drag
    could collapse the panel under the pointer, and a panel holding attached context could close
    while the user was reviewing it. `dragging` is now render state rather than only a ref, because
    the guard is evaluated during render.
  - **The dock tab had no hover delay.** The reference waits `DOCK_HOVER_DELAY_MS` on the tab and
    only unsnaps if the pointer is still there when it fires (`floating.js:440-455`), so a pointer
    crossing the tab does not pull the orb back out. Clicking the tab remains immediate.

  Both timers are now cleared on unmount: a pending collapse would call into a disposed bridge, and
  a pending unsnap would move a window the renderer no longer owns.

  Guarded by extending `tests/renderer-reference-parity.test.ts` to 17 cases, which pin the three
  timing constants, that they are *used* rather than restated, the full guard set, that `dragging` is
  state, the dock hover arm/cancel pair, and the theme attribute's `toggleAttribute` + `colorScheme`
  form. Falsified by setting `COLLAPSE_MS` back to the previous 480 — the check fails and passes
  again when restored.

Defects found by driving the real product instead of the internal APIs, with a real foreground window
available:

- Foreground scroll now demonstrably reaches and moves the target. The background→foreground escalation
  the driver's own refusal prescribes delivered a real `wheel` event that the target logged over its
  scrollable strip, and the strip's `scrollTop` actually changed. Previously this could not be shown at
  all: see the three measurement defects below, each of which made a reachable action look like a refusal.
- Three defects in the stage's own measurement, which are recorded because all three produced a
  false "delivery refused" reading from a working path: Notepad's scroll point was hardcoded to a screen
  coordinate *outside* its window, so nothing was ever aimed at it; the wheel counter read the `scroll`
  event while the target logs wheels as `wheel`, so a delivered wheel counted as zero; and the target's
  scroll strip hung past the window's bottom edge, so its centre resolved to no element and the wheel
  landed on the window without being able to scroll anything. The target now reports its own hit-test
  reachability and the runner asserts it, so this cannot recur silently.
- Key residue is no longer judged from the target's event log. That proxy reported 34 unmatched
  `key-down`s while no key was held: the foreground unlock deliberately taps ALT and Windows swallows
  the matching standalone release. Residue is now measured from the OS's own global key state, sampled
  before and after, and compared as a set difference — which also keeps a key the user happens to be
  holding from being attributed to the product.
- The native helper script was never copied into the build, so `out/main/native/foreground-window.ps1`
  did not exist and every attempt to record the target window failed in a built app — reported as "no
  foreground window", i.e. a missing build artifact disguised as an environment fact.
- A failed record left the previous one in place, so after that failure the orb kept pointing at
  whatever was in front when it launched (on the test machine, the user's own browser window) and a
  capture would have silently uploaded a window the user had moved away from. Collapse also left the
  record alive, and collapse is the route users actually take.
- The adapter discarded the driver's action results. The driver reports a refusal as a *normal return
  value* (`effect: Refused` for `click`, `isError: true` for `scroll`/`typeText`), so every refused
  action was reported to the model as a success.
- The adapter could never escalate a scroll. `ScrollInput` has no `delivery_mode` field at the locked
  version, so the `foreground` retry the driver's own refusal asks for was unexpressible through the
  typed API. The documented background→foreground protocol now goes through `callTool` when — and only
  when — the driver reports `background_unavailable`.
- Scroll coordinates were not converted like click coordinates, so the wheel was aimed at the wrong
  place while the driver still reported success. Both actions now share one conversion.
- The model was asked for a screen coordinate it could not know, and the observation did not tell it.
  `renderResult()` printed the window's title, app and size but dropped `window.bounds`, so the window's
  position on screen never reached the model; and the adapter built the size string with
  `Math.round(target.bounds.width / 1)` — a no-op division — so no DPI conversion happened while the
  label claimed "screen DIP". A position is now a **fraction of the screenshot the model is looking at**
  (0–1000 on each axis), which it can read off the image, and the host maps it onto the window rect.
  The first attempt at that mapping mixed units (a physical origin subtracted from a DIP point) and the
  click landed one cell away; the request space was settled by measurement to
  `request = fraction x driverReportedWindowSize`.
- `run-real-model-c7.mjs` read `toolName` from a session's `toolCall` block; the real field is `name`, so
  a successful real-model run would have been reported as "the model never called the tool".

Also fixed earlier in this cycle: the Pi extension sent run generation `0` while the shell's live
  generation starts at `1`, so every desktop request was refused as stale, and the bridge called an
  unknown session `stale-generation` too.

- `src/main/double-alt.ts` claimed to be "adapted to the reference interaction contract", but
  deepseek-harness-orb has no global shortcut and no double-Alt gesture at all. The gesture is a
  pi-orb capability, so the header now says so instead of borrowing the reference project's
  authority for a behaviour it does not have. The playbook audit that found this is described under
  *Added*.

### Fixed

- **The floating shell's front end was not actually reusing the reference, and the documents said it
  was.** Comparing `src/renderer/styles.css` against the pinned reference's `floating.css` found the
  renderer had **zero** shared class names, **0 of 18** reference design tokens, **no** element ids,
  its own palette and radii, and none of the reference's signature reveal. The reuse record called
  this "converged on the reference shell's structure"; it was a rewrite, and the wording made it look
  like a port. This is the reuse rule the project is built on (AGENTS.md: port rather than rewrite an
  equivalent), so the front end is now an actual port:

  - the 18 reference tokens under their own names — `--ball: 72px`, `--chrome: 12px`,
    `--panel-radius: 36px`, `--composer-height: var(--ball)`, `--prompt-line/-pad`, `--composer-max`,
    `--selection-chip: 28px`, the `--black/--white/--input-bg/--border/--pin/--error` palette, both
    shadows, and `--origin-x/--origin-y`;
  - the same layout state vocabulary driven from `body` — `expanded`, `pinned`, `running`,
    `has-selection-chip`, `docked`, `docked-left/right`, `expand-up/down/left/right` — with one
    mechanism per state (an earlier draft in this change had put `expanded`/`pinned` on `<html>` data
    attributes, and the new test caught it);
  - the reference ids for the shell elements (`#panel`, `#ball`, `#composer`, `#dock-tab`, `#prompt`,
    `#selection-chip`, `#history`, `#new-conversation`, `#transcript`, `#send`), with `#panel`
    mounted unconditionally and toggled by `hidden`, as the reference does;
  - the panel reveal itself: `opacity` plus `scale(0.18) -> scale(1)` over 300ms from
    `transform-origin: var(--origin-x) var(--origin-y)`, with each expand direction setting its
    origin, and the reference's ordering (unhide then add `expanded`; on collapse remove the class,
    then hide after the transition) so the animation is not cut short;
  - hover expansion wired on `document.body`, because the ball and panel are siblings and the
    pointer crosses the gap between them;
  - dark mode switched from a `prefers-color-scheme` media query to the reference's
    `html[data-ds-dark-theme]`, which the host can drive from an explicit choice rather than a guess.

  What is deliberately still not ported is now listed with reasons in
  `doc/floating-interaction.md`: the reference's `#question*` question cards, `#tcc-*` macOS
  permission gate, `#ball-gif` avatar, update/welcome frames and selection toolbar have no pi-orb
  counterpart (the project does not invent product concepts the reference does not have), the
  transcript is pi-orb's own React tree rather than the reference's iframe, the native observation
  frame has no lifecycle contract yet, and no composer is rendered while the workspace is
  unconfigured because Orb mode cannot exist before a workspace does.

  Guarded so it cannot drift back: `tests/renderer-reference-parity.test.ts` (11 cases) pins the
  token names, the state vocabulary, the reference ids and the absence of the abandoned `orb__*`
  scheme, and the packaged probe gained four checks that read *computed* values from the running
  packaged app — the shell elements mounted, the tokens resolved to `72px`/`12px`/`36px`, and the
  ball rendering at `72px` with a `50%` radius. Reading computed style is the difference between "the
  stylesheet loaded" and "the ported system is in effect", which is what the rule is about.

### Fixed

- **The dock gesture jumped instead of sliding, and the reference's animation was never ported.** The
  floating window is docked by dragging the ball past a screen edge; the reference animates that
  (a 250ms `easeInOutCubic` slide off-screen, then the dock tab takes the ball's place, and a 300ms
  `easeOutCubic` slide back on unsnap, moving the window with `setBounds(lerpRect(...))` every frame).
  pi-orb called `setBounds` once per transition, so the ball vanished at the pointer and reappeared at
  the tab — the gesture read as a jump. Ported from `floating-window.ts:407-441`, with the three
  guards the reference applies: no animation under test, no animation once the window is destroyed,
  and none when the OS asks for reduced motion (`systemPreferences.getAnimationSettings()
  .prefersReducedMotion`). `easeInOutCubic`, `easeOutCubic`, `lerpRect`, `FLOATING_DOCK_SLIDE_OFF_MS`
  (250), `FLOATING_DOCK_SLIDE_IN_MS` (300), `FLOATING_DOCK_TAB_FILL` (`#75757F`) and the
  `FloatingDockState`/`FloatingExpandState` types keep their reference names.

  The order matters and is the reference's: docking slides the ball *off* the edge first and only then
  places the tab, and unsnapping puts the window at the tab's off-screen position before sliding it
  back — placing the tab first would make the ball disappear at the pointer rather than travel past
  the edge. `clampFloatingWindow` and `unsnapDockedBall` are therefore `async` now, and the two IPC
  handlers await the slide so the renderer receives the settled state rather than a frame mid-flight.

  Observed end to end rather than asserted: driving the packaged app — drag the ball past the edge,
  dock, and sample the window position every 16ms — records **9 distinct frames** sliding from `x=-52`
  off-screen to the settled tab at `x=0, width=34`. Falsified by forcing the animation's guard to
  always snap: the same probe then sees 2 distinct frames and fails.

  Reading the reference export by export also corrected a claim: **30 of its 48 exports** in
  `floating-window.ts` are in pi-orb under the reference name with the pinned geometry constants all
  matching, so this module was a genuine port — unlike the stylesheet, which was not. The remaining
  18 are the overlay guard (pi-orb uses `withGuiTurn`), the context menu, the observation frame and
  `createFloatingWindow`, each with a recorded reason.

- **The theme attribute was set the wrong way.** The renderer now matches the reference's
  `applyColorScheme` (`floating.js:42-47`) exactly: `toggleAttribute` rather than
  `setAttribute`/`removeAttribute`, and `documentElement.style.colorScheme` set alongside it so the
  browser's own widgets (scrollbars, form controls) follow the theme instead of only our palette. The
  previous comment also mis-described the source — the reference *does* seed the value from
  `matchMedia`, which is what pi-orb does; the corrected comment says which part the reference drives
  from its host and why pi-orb has no equivalent channel.

### Added

- `evidence/p1-07/check-provenance.mjs`: the reuse rule is the first rule in `AGENTS.md`, and it runs
  **both ways** — reused code must record its source commit and licence, and original work must never
  be described as reused. Both claims lived only in prose file headers, and a header can say
  "unmodified" while the file has drifted, which is the same defect as a documented constant with no
  test.

  The check compares every file pi-orb states it ported against the pinned upstream checkout, line by
  line, and classifies it: `unmodified` (every non-blank pi-orb line appears verbatim upstream),
  `adapted` (pi-orb-only lines exist, so the header **must** state commit, licence and reason), or
  `missing`. It is a report rather than a hard gate, because `adapted` is legitimate when the
  difference is recorded; what it removes is the ability to claim `unmodified` without it being true.
  With no reference checkout present it reports `skipped` and exits 0, and is not counted as passed.

  It found two real problems on its first run:

  - **Three files reused reference code with no provenance at all** —
    `src/main/windows-selection.ts`, `windows-selection-native.ts` and `selection-monitor.ts` carried
    no source commit or licence, which `AGENTS.md` requires. All three now have proper headers naming
    the upstream file, the pinned commit `72f1d73` and the MIT notice, plus what was adapted.
  - **A claim that was subtly wrong.** The playbook recorded `wait.ts` as "一致/unmodified"; it
    actually differs by a 3-line provenance header. It is now recorded as `adapted`, and the honest
    result of the whole audit is **`unmodified 0`** — every ported file differs from upstream, which
    is what the report now says instead of a table of "一致".

  Also verified by the same method: `windows.ts`'s 11 timing constants match the reference exactly
  and in order, and its single deliberate divergence is documented and real — the input paths release
  held keys and mouse buttons in a `finally` block, where the reference only releases them on the
  normal path and would leave a key stuck if a cancel landed mid-chord.

  Falsified by replacing the pinned commit hash in `selection-monitor.ts` with zeros: the check
  reports `adapted-without-provenance 1` and fails, and passes again when restored. The release gate
  grows 64 → 66 to require both the checker and its report.

- **The shell has a context menu, which fixes a real editing defect rather than adding polish.**
  Electron windows have no default context menu, so before this there was **no way to cut, copy or
  paste in the composer with the mouse** — right-clicking the field did nothing at all. The playbook
  had carried the reference's `floatingContextMenuTemplate` as "pending evaluation", which is how a
  missing capability sat unnoticed behind a product-sounding note.

  Ported the reference's structure (`floating-window.ts:55-129`):

  - the edit block on top — `cut`/`copy`/`paste`/`selectAll` as platform **roles**, so labels,
    accelerators and behaviour come from Electron rather than being re-spelled and re-localised;
  - each role's `enabled` from the focused field's own command flags, so a Paste with an empty
    clipboard is visibly unavailable instead of silently doing nothing. The flags are read in the
    renderer (`document.queryCommandEnabled`, the only place Chromium reports them) and narrowed with
    `=== true` in the main process, so a malformed payload disables an item rather than reaching the
    menu template as a truthy string;
  - the shell actions the reference keeps: `Hide orb` in place of `Open Main Window` (pi-orb has no
    main window of its own, and this still routes through the lifecycle call so it revokes desktop
    authority), `Remove attached selection` only while context is attached, and `Quit pi-orb`.

  Deliberately not ported, per AGENTS.md: the Agent model settings and the selection-toolbar and
  millifraction toggles. pi-orb does not own model configuration and has neither surface, so there is
  no counterpart to adapt.

  One difference from the reference that had to be handled: **`Menu.popup` does not replace a visible
  popup**, and on Windows an open native menu holds the window's message pump. This was found by
  hitting it — three `openShellMenu` calls left the window stalled and the *dock slide* probe then
  failed with the ball only reaching `x=-12` instead of `-52`. Stacking is not merely untidy, it
  wedges the shell behind the first menu. The reference avoids it through dsh's outer window
  lifecycle; pi-orb refuses to open a menu while one is open, resetting via `popup`'s callback.

  Verified: 7 unit tests cover the template (edit block only when editable, per-role enabling, roles
  rather than labels, the selection item's condition, the action set, no stacking, and a destroyed
  window); the packaged probe gains 2 checks (20/20) driving the real IPC path. Falsified by forcing
  the request validation to throw — the probe then fails with
  `ERR:Error invoking remote method 'orb:shell-menu'`. The first falsification attempt silently did
  not apply (shell escaping), which is why the injection was checked before the result was believed.

- **The observation frame — P2-01's "observation border" — is now implemented instead of being
  recorded as a design choice.** Once the Orb hides for a desktop task, nothing on screen said which
  window the next action would land on; the panel named the target, but a name is not a place. The
  record had justified the omission as "no lifecycle contract yet, so we will not draw a fake border
  that would end up in screenshots" — true at the time, but it described unfinished work as a
  decision, which is the same failure this file already documents for the front end.

  Ported from `observation-frame-window.ts` and `renderer/observation-frame.{html,css}`
  (commit `72f1d73`):

  - the geometry as pure functions — stroke 8px, glow 28px, outset 36px, the window intersected with
    the work area (clipped, **not** translated, since a translated ribbon points at the wrong
    pixels), and the inner hole derived from the *actual* per-edge insets. A flushed edge keeps its
    stroke just inside that edge, as the reference documents: pushing the ribbon off-screen would lose
    the mark entirely;
  - the two window properties that *are* the acceptance criterion — `setIgnoreMouseEvents(true,
    { forward: true })` so the action reaches the target app rather than this chrome, and
    `setContentProtection(true)` so the ribbon stays out of the user's own screenshots. Plus
    `focusable: false` with `showInactive()`, so showing it never steals focus from the window being
    worked in;
  - the renderer: gradient, drop-shadow and a `mask-composite: exclude` hole, so the ribbon outlines
    the region without tinting it. It is a second build entry with **no script**, because it must
    never carry the shell's bridge.

  No animation, matching the reference's own rule and test: the ribbon marks a *region*, not an
  activity, and a pulsing border would read as "working".

  Wired into the host where the boundary already exists — shown inside `withGuiTurn` (the single entry
  point for desktop actions) and hidden in `revokeDesktopOperations` (the single revoke exit), so the
  ribbon cannot outlive the grant. The rectangle comes from the driver's own `TargetWindow.bounds`,
  the same rectangle actions are mapped on, so the ribbon cannot drift from where input actually goes.

  Verified: 7 unit tests pin the hole against the region, the clipping rule, integer pixels and the
  DIP branch; the packaged probe gains three checks (18/18) that measure the rendered ribbon's
  computed padding, `pointer-events`, `mask-composite` and script count in the built artifact.
  Falsified by setting `pointer-events: auto` — the probe then fails with
  `{"pointerEvents":"auto"}`.

- `tests/documented-counts.test.ts`: the same protection for evidence counts that
  `playbook-constants.test.ts` gives constants. Documents quote probe results as `25/25` and `15/15`,
  and those numbers rot — the P2-05 line still said `10/10` several rounds after the packaged probe
  reached 15/15, and `verification.md` carried the same stale pair. Every count is now read from
  the recorded JSON and compared against what the documents state next to the matching phrase.

  The first version of this check was wrong in a way worth recording: it searched for the *recorded*
  denominator (`\d+/15`) and so passed against the very drift it existed for, because the stale text
  read `10/10` and contained no `15`. It now scans the number following each claim's own phrase, and a
  test pins that exact case so the guard cannot quietly regress to the weaker form.

  The release gate grows 63 → 64 to require both document-checking suites to exist.

- `tests/playbook-constants.test.ts`: the loop that was missing when the collapse timing drifted.
  `doc/reference-playbook.md` §5.2/§5.3 pin the values that must match the reference project, and
  those tables were *correct* while the code said otherwise for several stages — the delay sat at
  480ms against a documented 180ms because nothing compared the two; the drift was found by reading
  source, not by a test. Every pinned value is now asserted against the implementation **and** against
  a mention in the playbook, so the two cannot disagree in either direction: the code drifting from
  the document fails, and the document drifting from the code fails too. Both directions were
  falsified. It also checks the derivations that hold the shell together rather than repeating a
  literal — `--composer-height: var(--ball)`, the CSS panel transition against `ANIMATION_MS`, and the
  dock tab fill agreeing between the main-process constant and the stylesheet, where a mismatch would
  be silent because the two copies exist for different reasons.

- **Continuous integration** (`.github/workflows/ci.yml`): a pull-request and `main`-push workflow on
  a Windows runner with a read-only token, running the same gates a contributor runs locally —
  typecheck, lint, unit tests and the release gate — and uploading the gate record. Its shape
  (trigger, `contents: read`, concurrency cancel, `persist-credentials: false`, pinned Node) is taken
  from the reference project's `.github/workflows/ci.yml`; its enterprise machinery (self-hosted and
  Blacksmith runner failover, telemetry switches, monorepo gate fan-out, issue-lifecycle and
  weighted-approval workflows) is deliberately not copied. It runs on Windows because Windows is the
  only supported platform — a green Linux run would verify nothing about the shipped product.
- **`CONTRIBUTING.md` / `CONTRIBUTING.zh.md`**: the contribution contract in one place — the
  reuse-first rule (port from the reference rather than rewriting an equivalent, and attribute it
  correctly in both directions), the non-destructive N1–N8 rules, the setup notes that actually cost
  time (npm 11 blocking Electron's install script), and the table of which evidence a change must
  carry in the same commit. It states the two rules that keep the evidence honest: never weaken an
  assertion to make a check pass, and never move a row out of the unverified table without
  reproducible evidence. Bilingual because this repository's own documents are Chinese-first.
- **`SECURITY.md`**: what counts as a security report here and what counts as a safety defect. The
  in-scope list is specific to this product: authority that outlives its grant, a path from a non-Orb
  session to a desktop capability, credentials reaching an artifact, and — as safety defects — an
  action landing on a different window than the user authorized and a key or button left held after a
  cancellation. It also states the boundaries rather than only a contact route, because they are part
  of the product: the Orb workspace is **not** a filesystem sandbox, an approved task is a real grant
  of input authority, and captured screen content is untrusted data that can never extend authority.

### Changed

- **The release gate is now usable by someone who is not on the author's machine.** The pi-web
  baseline comparison runs against a developer-local checkout at an absolute path recorded in
  `evidence/p0-01/changed-files-baseline.json`, so on any other machine — a contributor's clone, a CI
  runner — it threw and was reported as a **failed** check, and the gate could never go green for
  anyone else. `verify-baseline.mjs` now reports `skipped: true` with a reason and exits 0 when no
  checkout is present (still doing the real comparison when one is), and the gate records that as a
  *skipped* check: shown in the output and counted separately, never as passed. `passed` and
  `skipped` are different facts and the summary now keeps them apart. On this machine the check still
  performs the real comparison (6 files, HEAD unchanged); with the path unset the gate reports 46
  passed + 1 skipped instead of failing. The `PI_ORB_P0_PI_WEB` override and the recorded path are
  both honoured.
- The gate grows 47 → 55 checks: it now also holds the CI workflow to running the documented gates
  with read-only permissions on a supported platform, and requires the contribution and security
  documents to keep their load-bearing content (the playbook pointer, the no-weakened-assertions and
  unverified rules, the stated boundary, and the two defect classes this product exists to avoid).
  Falsified by removing the security policy's boundary statement: the gate drops to 54/55 with that
  check named, and returns to 55/55 when restored.

- **Preview release path** (`.github/workflows/release-preview.yml`, `doc/release-process.md`):
  the project can now hand someone a built installer, which it previously could not — the README
  explained how to build one, and there was no way to obtain one. It is triggered by hand (with a
  typed `confirm_unsigned=unsigned` confirmation) or by a `v*` tag, never automatically, because
  publishing an unsigned binary should be a decision rather than a side effect of a push.

  Three properties matter more than the publishing itself. First, it **re-verifies the artifact it
  publishes**: the committed `package-audit.json` and `packaged-smoke.json` record the author's
  machine, so they prove the code was sound there and not that this build is — the workflow runs
  `run-p2-05.mjs` on the release runner and asserts those fresh results before anything is uploaded.
  Second, it publishes as a **prerelease** and the notes say so, because the gate for a complete v0.1
  is not satisfied (`doc/support-matrix.md` §3 still lists multi-display, elevated windows, Chromium
  content, clean-machine install and the SmartScreen prompt as unverified). Third, the notes are
  assembled from the support matrix and the manual-acceptance steps **with assertions**: if the
  matrix stops declaring unverified items, or the installer acceptance steps disappear, the release
  step throws instead of publishing a package that looks finished. The notes also carry the
  unsigned-build warning and the `SECURITY.md` boundary, so a downloader learns what they are getting
  without reading the repository.

  The gate grows 55 → 59 to hold this: the workflow must be manually triggered, must re-verify on the
  release machine, must publish as a prerelease without dropping the unverified list, must gate on
  the release gate, and must require the explicit unsigned confirmation. Falsified by replacing
  `--prerelease` with `--latest`: the gate drops to 58/59 with that check named, and returns to 59/59
  when restored. The workflow's PowerShell steps were syntax-checked with a real parser after GitHub
  expression expansion (including the here-string terminator that must sit at column 0), and the
  artifact-collection, hashing and notes-assembly steps were executed locally against the real build.

- **`orb_open_app` (P2-04), narrowed on the user's decision: activation only, never launch.** The
  reference tool brings a running application forward *or starts it*
  (`tool-computer-use/src/windows.ts:398-404`: `activateApp` falls through to `launch`). Launching a
  process is native authority the user did not grant when they recorded one window, so pi-orb keeps
  only the first half. The rule is three checks, all of which must pass before the task is rebound:
  the application must appear in the running-application list (base-name equality — `Notepad` ==
  `notepad.exe`, never a substring, so a browser whose *title* mentions the word cannot be selected);
  `activateApp` must succeed (it returns `false` instead of starting anything); and the resulting
  foreground window must still belong to that application. A failure at any step leaves the previous
  target in place, because adopting whatever happens to be in front is exactly the "the driver
  picked a target" behaviour this project forbids. On success the new window is reported to the
  shell through `onTargetChanged`, so the panel shows where the next action will land and the user
  can revoke; recording or picking a window and every revocation path clear it.
  `validateAction` refuses any label that could carry a path, an argument-looking segment, shell
  metacharacters or control characters, so an activation request cannot become a command line.
  Tested in `tests/reference-windows-open-app.test.ts` (including "not running fails and `launch` is
  never reached") and `tests/orb-tools.test.ts`; the tool set is now eight, re-verified against what
  the provider actually receives (`evidence/p1-06/tool-exposure.json`, 7/7). The real desktop effect
  stays manual: `doc/verification.md` §10 (F1–F6).

- **Windows distribution (P2-05).** pi-orb can now be built into something you can hand to someone:
  `npm run package:win` produces a per-user NSIS installer and `npm run package:win:dir` an unpacked
  app. The packaging posture is reused from the reference project's
  `apps/desktop/scripts/electron-builder-config.mjs` — electron-builder driven by a JS config module,
  NSIS as the only Windows target, per-user install with elevation disabled, `asar: true`, the
  `**/*.{node,dll,exe}` unpack glob, and no update feed — while its dsh-monorepo release pipeline
  (bundled runtime, custom NSIS pages, signing chain, upload flow) is deliberately not copied.
  Three deviations from electron-builder's defaults are recorded with their reasons in
  `doc/packaging.md` §4: `npmRebuild: false` (the shipped binaries must be the prebuilt ones
  every native evidence run used, not a fresh from-source build), a `files` exclusion list (smart
  unpack otherwise ships koffi's C++ sources, its vendored headers and documentation, uiohook-napi's
  vendored C sources and every other platform's `.node` — 129 unpacked files become 10), and
  `resources/icon.ico` derived from the already-approved `src/renderer/orb-avatar.png` rather than a
  new brand asset.
- `evidence/p2-05/`: the stage is verified by two separate probes rather than by "the installer
  built". `run-package-audit.mjs` (25/25) reads the built app and checks that the product files sit at
  the paths the main process resolves at runtime, that the license obligations travel with the
  artifact, and that no repository source, test, evidence file, credential, key, foreign-platform
  binary or build toolchain leftover is inside. `run-packaged-smoke.mjs` (10/10) then launches the
  packaged `pi-orb.exe` with an isolated profile and drives it over CDP: the bridge reaches the
  renderer, the renderer still has no Node access, the built bundle and avatar load out of the asar,
  and `orb:list-desktop-windows` returns real windows — which is the only external observation that
  `koffi` loaded from `app.asar.unpacked`. Falsified by deleting that unpacked binary: the desktop
  checks fail, and pass again once it is restored.
- `doc/packaging.md` and `doc/verification.md` §9 (E1–E9): what is automated, and the
  clean-machine install / uninstall / upgrade / SmartScreen steps that cannot be. The installer is
  unsigned, so the unknown-publisher prompt is a recorded state, not a defect.
- The release gate grows to 47 checks: it now also holds the packaging configuration to its
  load-bearing properties (`asarUnpack` for native modules, per-user and non-elevating install,
  `publish: null`, `npmRebuild: false`, third-party residue trimmed, `release/` ignored), requires the
  P2-05 records to exist, and requires the recorded audit and probe results to have passed with their
  native-binary checks intact.
- `tests/reference-windows-foreground.test.ts` (10 cases) and `tests/reference-windows-input.test.ts`
  (13 cases): the reference project's own specs for the ported Windows backend, now ported case by
  case. They cover window selection (shell and overlay skipping, owner chains, transient unioning,
  per-monitor separation), key mapping, extended keys, UIPI rejection, the clipboard
  save-paste-restore order, wheel steps, focus restoration and cancellation. Six of them were
  falsified by mutation before being accepted.
- `doc/reference-playbook.md` §9.4 and §10.6: the packaging face of the reference index — what to
  reuse, what never to copy, the three non-default decisions to check before touching the config, and
  the procedure that requires both probes to pass.

### Changed

- The reuse playbook's §6.1/§6.2 audit findings were closed rather than left implied.
  `src/main/reference-windows/coordinate-mode.ts` is deleted: it held two types with no live caller
  while `src/shared/orb-tools.ts` owns the only validation implementation, and a dead file is exactly
  what N8 forbids. `coordinates.ts` keeps only `mapNormalizedToGlobal` (9 of its 11 exports had no
  caller); the file records that pixel encoding, if ever implemented, must be restored from the
  pinned commit rather than re-derived. `UNFOCUSED_WINDOW_NOTE` is restored verbatim from the
  reference, which had been truncated mid-sentence and left the model without the next step it should
  take; the ported spec pins the literal. Every ported file now carries a repository + commit + path +
  MIT header, and `THIRD_PARTY_NOTICES.md` §3.5 lists them individually, including the floating shell
  and renderer files that were previously attributed only in prose.

- `doc/reference-playbook.md`: the single entry point for reusing
  `deepseek-harness-orb` — where the pinned checkouts live, which reference file owns which
  behaviour (with line numbers), the constants and interaction specs that must match, the
  reusable / adaptable / off-limits split, the per-task procedure, the upstream sync steps and a
  pre-commit checklist. Writing it produced a source-level audit of the existing port, recorded in
  §6.1 and §6.3: the reference backend's `coordinates.ts`, `wait.ts`, `observation-limits.ts`,
  `windows-foreground.ts` and `capture-exclude.ts` are byte-identical ports; `windows.ts` is a
  deliberate improvement (it adds the `try/finally` key and button release the reference lacks);
  `windows-native.ts` carries the `koffi@2` adaptations (`koffi.sizeof`, `koffi.address`) that a
  future `koffi@3` upgrade must revisit. The audit also names what is still missing:
  `coordinate-mode.ts` kept only its two types, seven declared backend methods have no caller, the
  capture-exclude list is permanently empty, the `UNFOCUSED_WINDOW_NOTE` copy was truncated, and the
  reference's `windows-foreground` invariants have no test.
- The release gate now keeps the reuse entry point honest: it checks that
  `doc/reference-playbook.md` exists, pins the reference commit and keeps its reuse index, port
  procedure and checklist sections, and that `AGENTS.md` records the durable checkout and points at
  the playbook. Gate count 32 → 36, still falsifiable in the same way as the other checks.
- The local reference checkout is now recorded as `D:\pi-orb-ref\deepseek-harness-orb` (the durable
  clone, same pinned commit) in `AGENTS.md` and `README.md`, alongside the two earlier temp checkouts.

- `evidence/p1-06/run-real-model-c7.mjs`: the real-model C7 entry point (real pi-web + real model),
  isolated so it never reads or writes the user's running orb — its own `--user-data-dir` and
  `PI_ORB_CONFIG`, and an agent dir whose `models.json` is a hard link and `auth.json` a symlink, so the
  real provider configuration is used with no second copy of any credential.
- `doc/verification.md`: the single, step-by-step list of what genuinely cannot be automated
  (real key presses, a second monitor, an elevated window, mid-press cancellation, and a real model
  choosing to call the tools), with prerequisites, the five permitted result labels and where each
  result has to be written back.

- P1-07 release gate (`evidence/p1-07/run-release-gate.mjs`, 29 checks): quality gates, the
  non-destructive baseline, release hygiene, the license inventory, version agreement, the presence
  of the unverified-capability records, and an uninstall-safety audit of the product's write surface.
  Its decisive checks were falsified five times (an injected credential, an injected AGPL dependency,
  a wrong version, a write into pi-web's node_modules, and a write from an unlisted module) and each
  fails as expected.
- Third-party license inventory and `THIRD_PARTY_NOTICES.md`, including how to obtain the source
  for the MPL-2.0 components.
- `LICENSE`: the repository declared MIT without shipping the license text.
- A window lifecycle rule (`src/main/window-lifecycle.ts`) with one collapse routine, plus a
  Collapse control in the window itself.
- Lifecycle regression record `evidence/p1-07/lifecycle-regression.json` (10/10), including a real
  disconnect: authority granted, the pi-web process actually killed, and the grant observed revoked.
- P1-01 workspace and independent session: Orb cannot be enabled without a selected
  workspace; cancelling writes nothing; relative, missing and non-directory paths are
  refused; a Windows junction and a differently-cased spelling resolve to one identity;
  a missing directory is only created after explicit confirmation; switching the
  workspace starts a new session while leaving the previous session file and history
  byte-identical; and the rejected-selection reason is reported to the user.
- Single shared configuration-path resolution for the Electron shell and the Pi
  extension, with unit tests pinning that both sides agree.
- Orb mode Pi extension registers its command and prompt section only for an exact
  workspace match; a subdirectory and a prefix-similar sibling never match.
- Verification records `evidence/p1-01/` (19 integration assertions against a real
  pi-web snapshot, 22 application assertions against real Electron), including a
  demonstrated statement of the `~/.agents/skills` limitation.
- Repository foundation: `package.json` with a locked dependency set, TypeScript
  `strict`, ESLint, Vitest, and an `electron-vite` build producing main, preload and
  renderer bundles.- `.gitignore` covering dependencies, build output, scratch directories, local agent
  goal state, credentials, native binaries and screenshots.
- Electron main process: orb window, tray, configurable global wake shortcut with
  registration diagnostics, and single-instance exit cleanup.
- `contextBridge` preload exposing a fixed, generation-scoped operation set with no
  raw Node or generic IPC access.
- React renderer for the orb window: streaming output, explicit stop, workspace
  selection and error display.
- Orb configuration contract in `src/shared/orb-config.ts`: strict schema validation
  and exact normalized-directory matching (no subdirectory or prefix match).
- Workspace validation in `src/main/workspace.ts`: absolute-path requirement,
  symlink/junction resolution, missing and inaccessible directory rejection, and
  creation only after explicit confirmation.
- Run-generation tracking and a single-task lock in `src/main/generations.ts`, so a
  request from an earlier run cannot act on the current one.
- pi-web client adapter and Orb session controller reusing the documented
  `/api/agent/new`, `/api/agent/{id}` and SSE endpoints; SSE is subscribed before the
  prompt and completion is tracked from assistant-role events only.
- Pi package `pi-package/` with the Orb mode extension: conditional registration on an
  exact `cwd` match, and no registration at all otherwise.
- `doc/support-matrix.md` recording verified and unverified version combinations.
- P1-02 minimum Electron orb window end to end: text input, streamed assistant
  output, visible errors, an explicit stop whose output stops growing and whose task
  lock is released, window bounds persistence, and a tray entry. The chat flow runs
  against a real pi-web while the normal pi-web UI can browse the same session.
- Status snapshot now carries the run generation, the task-lock state and the bound
  session id, so a client never depends on a pushed event it may have missed.
- `tests/fixtures/pi-web-events.ts` records the real pi-web SSE event shapes, so the
  stream parser is checked against the observed wire format rather than a guess.
- P1-03 global wake shortcut: shape validation that separates "malformed" from
  "already owned", registration diagnostics surfaced in the status snapshot, a
  configurable shortcut that never persists a value that fails to register, a tray
  fallback entry, and a wake/collapse state machine with auto-repeat suppression.
- Verification record `evidence/p1-03/` (20/20) proving real OS registration with a
  second-process contention probe, conflict diagnosis, release on change, and release
  on exit — without synthesising any keystroke.
- P1-04 explicitly-authorized screenshot context: one pending capture at a time, a
  preview that shows the exact bytes that will be sent, discard with zero upload, a
  text-only model that never receives image data, explicit size and pixel limits, and
  a target recorded before the orb takes focus so the orb cannot capture itself.
- Windows target-window helper declaring per-monitor-v2 DPI awareness and reporting
  whether the declaration actually took effect (the `DPI_AWARENESS` enum collapses v1
  and v2, so the contexts are compared directly).
- `ScreenshotFlow` as the single seam for the consent rules, driven directly by tests
  so "previewed bytes == sent bytes" is verified with a byte-for-byte comparison.
- Verification records `evidence/p1-04/` (21/21) covering the refusal and consent
  paths end to end against real Electron and a real pi-web, plus a read-only
  capture-source probe that established `window:<hwnd>:<index>` as an exact identity.
- P1-05 real-machine acceptance of the locked Cua driver (decision (a)): installed
  artifacts verified against the recorded tarball and binary hashes, the runtime tool
  inventory (57 tools) read from a running driver, the real coordinate-space mismatch
  measured (physical 2560x1600 window bounds vs 1707x1067 DIP screen and DIP actions),
  background clicks landing on the intended target in four widely separated cells,
  background typing landing in a native application verified by reading the document
  back, and balanced key/mouse press and release.
- A disposable, self-reporting input target (`evidence/p1-05/target-app/`) that logs the
  cell that received each press along with its in-cell offset, so a coordinate error is
  visible as the wrong cell instead of a vague "it clicked somewhere".
- P1-06 Orb mode and the desktop tool loop: four `orb_`-prefixed tools registered only for an
  exact workspace match, a per-task authorization bound to a session and run generation, an
  action budget and time limit, one action per observation, and a batch that stops after a
  failure instead of retrying blindly.
- A bridge between the Pi extension and the shell over a Windows named pipe, with a per-run
  token in a `0600` file, a protocol version, a session/generation check, and a refusal for
  browser-shaped requests.
- The user chooses which window desktop actions may target, because the orb refuses to guess.
- The same "record the target before the orb takes focus" rule that governs screenshots now
  also governs desktop actions.

### Fixed

Both defects below produced no error anywhere and were found only by running the real
application:

- The Pi extension sent run generation `0` while the shell's live generation starts at `1`, and the
  value could only have come from an environment variable nothing sets (the extension runs inside
  pi-web's process, whose environment this project cannot set). The bridge therefore refused every
  desktop request as `stale-generation`, so the P1-06 tools could never work outside the probes. The
  shell now publishes the generation in the same handshake file the extension already reads, and
  rewrites it whenever the generation changes.
- Reaching the bridge with an unknown session was reported as `stale-generation`, which told the user
  their run was stale when the real problem was that the session was not this shell's. The two cases
  are now distinct reasons with distinct messages; this was found by a check asserting that a request
  using the handshake generation gets *past* the generation check.
- Losing the pi-web connection did not revoke desktop authority, so after pi-web died a grant
  survived that belonged to a session nobody could see any more, and reconnecting could resume it.
  A lost or unusable connection now revokes desktop operations and the unconfirmed screenshot, and
  does not restore the grant on reconnect.
- The screenshot target was re-read from the foreground window at the moment the user pressed the
  screenshot control. By then the orb holds focus, and the reader excludes this process, so the
  lookup always failed: the positive capture path could never run once. The target is now recorded
  once, before the orb is shown, and the capture flow consumes that record and only checks that the
  window still exists with the same title (a validity check, not a foreground check, because the
  user has deliberately switched to the orb by then). Collapsing, changing workspace or quitting
  clears the record so a later capture cannot silently reuse a window the user has left.
- Hiding the orb through the window's close button or the tray menu kept desktop authority
  alive, so a hidden orb could still move the user's mouse and keyboard. All hide routes now go
  through one lifecycle routine that revokes the task authorization and drops any unconfirmed
  screenshot, and a unit test asserts no hide can happen without both.
- The Electron main process ignored `PI_ORB_CONFIG` while the Pi extension honoured
  it, so the two sides read different files: the configuration was written and shown
  as configured, but Orb mode never activated. Path resolution is now a single shared
  function in `src/shared/orb-config.ts`, with unit tests pinning that both sides agree.
- A rejected directory selection left the previously committed workspace usable but
  reported no reason at all, so choosing a bad directory looked like nothing happened.
  The reason for the last operation is now part of the status snapshot.
- The initial run generation was emitted before the renderer subscribed, so every
  prompt was refused as stale. Generation, task-lock state and session id are now
  read from the pull-based status snapshot.
- The single-task lock was released when the HTTP prompt call returned rather than
  when the turn ended, so `busy` was always false and a second GUI task could start
  while one was running. The lock now spans the turn.
- The SSE parser guessed at the event shape (`message_delta` with `delta.text`), so
  streamed text never reached the UI and nothing reported an error. It now reads the
  observed `message_update.assistantMessageEvent.text_delta` contract.
- A reply that arrived without any delta events rendered as empty, because the
  accumulator's empty-string initial value defeated a `??` fallback.
- Accelerator validation accepted a doubled separator while registering the original
  string, so the OS could refuse a value this project had called valid and report a
  malformed shortcut as a conflict with another application. Validation now rejects
  empty parts and returns the exact canonical string that gets registered.
- A shortcut registration failure was only written to the main-process console, so the
  user could not see why the orb was unreachable. The reason is now part of the status
  snapshot and shown in the window.
- A confirmation that did not match the live screenshot preview cleared it along with its
  queued message, so a late click from an earlier preview left the user unable to confirm
  the image they were looking at. A mismatched or stale decision is now a no-op that
  leaves the current preview intact, and "refuse" is distinguished from "cancel".
- The bridge wrapped a policy refusal inside a successful reply, so a caller would read "the
  request succeeded" while the action had not run, and a refused action could be counted as
  work done. A refusal is now surfaced as a refusal all the way to the extension.
- Desktop observation fell back to the front-most window when no target was named. Measurement
  showed an auxiliary surface (the touch keyboard host) can outrank the intended window, so the
  click went to the wrong window. The fallback is removed: a target must be identified, and
  observation is refused otherwise.
- An observation could be replayed, letting a plan chain actions on one picture. The observation
  is now consumed by the action that used it, so the next action must re-observe.

### Security

- Renderer runs with `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false` and a restrictive CSP. pi-web credentials never leave the
  main process.

## Version policy

- `0.x` while the minimum usable product is incomplete. Minor versions add capability,
  patch versions fix defects; a breaking change to the configuration schema or the IPC
  contract raises the minor version and is described here.
- A release records its verified combination (pi-orb, Node, Electron, Pi SDK, pi-web,
  desktop driver, OS) in the support matrix. Verified rows are evidence-backed; see the
  linked file under `evidence/`.

## 工具速度阶段 2

- 新增 orb_batch 顺序批量，协议 v2、整批预检、取消传播、按工作量超时和中文逐步进度。10 批真实点击读回通过；不宣称降低每步原生等待。

## 工具速度阶段 3

- 模型请求只保留最近三张 Orb 工具截图，完整会话历史、用户附件和其他工具图片不变，记录归一化后图片字节预算。
