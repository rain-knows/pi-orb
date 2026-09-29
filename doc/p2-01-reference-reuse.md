# P2-01 参考项目复用记录

日期：2026-09-29（2026-09-30 按源码核对重写前端部分）

## 来源

- 仓库：`https://github.com/rain-knows/deepseek-harness-orb`
- 固定提交：`72f1d738458a223696685a909e806b683eff5885`
- 本地只读检出：`C:\Users\JUSTLIKEZYP\AppData\Local\Temp\deepseek-harness-orb-pi-orb`
- 主要来源文件：`apps/desktop/renderer/floating.html`、`floating.css`、`floating.js`、
  `apps/desktop/src/floating-window.ts`、`orb-avatar.ts`

## 一次被更正的事实（重要）

本文件此前的版本把前端描述为「按参考 shell 的结构收敛」，读起来像是已经复用了参考的 DOM/CSS。
按固定提交逐项核对源码后，**这个说法不成立**：当时的 renderer 是自己设计的一套 `orb__*` 样式，
与参考没有任何共同类名，也没有参考的设计令牌与状态模型。核对结果：

| 项 | 参考 | 更正前 | 更正后 |
|---|---|---|---|
| CSS 自定义属性 | 18 个（`--ball`/`--chrome`/`--panel-radius`/`--composer-height`/`--origin-x/y`/调色板/阴影…） | 5 个无关的 `--orb-*` 颜色 | 18 个同名令牌全部定义 |
| 类名 | `#panel`/`#ball`/`#composer`/`#dock-tab` 等 id + `body.<state>` | `orb__*` / `orb--*`（0 个重叠） | 参考 id 与 `body` 状态类同名 |
| 展开动画 | `opacity` + `scale(0.18→1)`，300ms，`transform-origin: var(--origin-x) var(--origin-y)` | 无（直接切换布局） | 已移植 |
| 展开方向原点 | 四个方向各自设置 `--origin-*` | 仅硬编码边距 | 已移植 |
| 深色主题 | `html[data-ds-dark-theme]`（宿主决定并写入 DOM） | `prefers-color-scheme` 媒体查询 | 已改为参考属性 |

这是一次**漂移**，不是「必要适配」：参考的 CSS 完全可以在 pi-orb 的 renderer 里成立，只是当初
被重写了。按 AGENTS.md「能直接移植时禁止自行重写等价实现」，已改为移植，并由
`tests/renderer-reference-parity.test.ts`（11 条）钉住令牌、状态词表与参考 id，防止再次漂移。

## 当前复用（核对后）

### 主进程（窗口几何与停靠动画）

沿用参考 `floating-window.ts` 的几何与状态机，落在 `src/main/floating-geometry.ts` 与
`src/main/floating-window-controller.ts`：72px 球、344×444 含 chrome 的展开窗口、工作区方向选择、
拖动释放后的左右边缘停靠、多显示器最近显示器计算。窗口收起先还原为 96×96 球，配置只保存球位置。

**停靠是滑动，不是瞬移**（本轮补齐）：参考 `animateOverlayBounds`（`floating-window.ts:407-441`）
把窗口从当前位置缓动到目标位置——滑出用 `FLOATING_DOCK_SLIDE_OFF_MS = 250` + `easeInOutCubic`，
滑回用 `FLOATING_DOCK_SLIDE_IN_MS = 300` + `easeOutCubic`，每帧 `setBounds(lerpRect(...))`，
并在窗口销毁、`VITEST` 测试模式、或系统「减少动效」时直接落位。这三处守卫一并移植：

- `easeInOutCubic` / `easeOutCubic` / `lerpRect` 与两个时长常量移入 `floating-geometry.ts`，与参考同名；
- `prefersReducedMotion()` 读 `systemPreferences.getAnimationSettings?.().prefersReducedMotion`；
- 新增 `FLOATING_DOCK_TAB_FILL`（`#75757F`）与 `FloatingDockState` / `FloatingExpandState` 类型，
  与参考同名。

因此 `clampFloatingWindow` 与 `unsnapDockedBall` 现在是 `async`：dock 先把球滑出屏幕边缘
（`offScreenBallOrigin`）再放 tab，unsnap 先把窗口放到 tab 所在的屏外位置再滑回来——**先放 tab 再滑
会让球在指针处凭空消失**，这正是参考的顺序。IPC 两个 handler 相应改为等待滑动结束，renderer 拿到的
状态描述的是停下后的窗口，而不是动画途中的某一帧。

核对方式：把参考 48 个导出与 pi-orb 逐名比对，30 个保持参考名，几何常量全部一致；差异项
（overlay guard、右键菜单、观察框、`createFloatingWindow`）与未移植原因见本文件末节。

### renderer（本次改为真移植）

1. **设计令牌**：`styles.css` 的 `:root` 采用参考的令牌名与值（`--ball: 72px`、
   `--chrome: 12px`、`--panel-radius: 36px`、`--composer-height: var(--ball)`、
   `--prompt-line/-pad`、`--composer-max`、`--selection-chip: 28px`、`--black/--white/--input-bg/
   --border/--pin/--error`、两个阴影、`--origin-x/--origin-y`）。深色值同样取自参考的
   `html[data-ds-dark-theme]` 块。
2. **布局状态模型**：`body.expanded`、`body.docked`、`body.docked-left/right`、
   `body.expand-up/down/left/right`、`body.pinned`、`body.running`、`body.has-selection-chip`，
   由 `App.tsx` 写入 `document.body.className`，CSS 负责布局——与参考一致。**一个状态只有一种
   机制**（此前 expanded/pinned 曾被写进 `<html>` 的 data 属性，已改回 body 类）。
3. **面板揭示**：`#panel { inset: var(--chrome); border-radius: var(--panel-radius); opacity: 0;
   transform: scale(0.18); transform-origin: var(--origin-x) var(--origin-y); transition: opacity
   300ms ease-in-out, transform 300ms ease-in-out }`。参考先 `panel.hidden = false` 再加
   `expanded`，收起时先移除 `expanded`、动画结束后再 `hidden`；pi-orb 的 `panelHidden` 状态机照此
   实现，因此折叠动画不会被 `hidden` 截断。
4. **元素身份**：`#panel`、`#ball`、`#dock-tab`、`#composer`、`#prompt`、`#selection-chip`、
   `#history`、`#new-conversation`、`#transcript`、`#send` 使用参考同名 id；`#history`/
   `#permission`/`#new-conversation` 的绝对定位、`body.expand-down` 时翻到底边、
   `#panel::after` 的输入胶囊底色、`#ball` 四方向定位与 pin 光环、`#dock-tab` 的呼吸动画与
   `prefers-reduced-motion` 关闭，都取自参考。
5. **hover 展开**：监听 `document.body` 的 `pointerenter`/`pointerleave`——参考就是挂在 body 上，
   因为面板与球是兄弟节点、指针会跨过两者之间的间隙。
6. **选区 chip**：`#selection-chip` 的高度、宽度 `calc(100% - var(--ball) - 28px)`、四方向偏移与
   `hidden` 语义取自参考。
7. **输入胶囊**：`#composer` 固定 `var(--composer-height)`、圆角 `calc(var(--ball)/2)`、
   四方向偏移、`#prompt` 的 `--prompt-pad`/`--prompt-line`、`body.running` 时隐藏，均取自参考。
8. **交互时序与收起守卫**（本轮补齐）：
   - 时序常量改用参考名与参考值：`COLLAPSE_MS = 180`、`ANIMATION_MS = 300`、
     `DOCK_HOVER_DELAY_MS = 800`（`floating.js:3-6`）。此前收起延时被硬编码为 `480`，
     慢了约 2.7 倍——这是手感差异，不是无关细节；面板 `hidden` 也改为在 `ANIMATION_MS` 之后。
   - 收起守卫补上参考的 `dragging` 与 `hasSelectionChip()`（`floating.js:528`）：
     拖动球的过程中指针离开不得收起面板，面板里还挂着选区上下文时也不得收起。
     `dragging` 因此必须是 render state 而非仅 ref，否则守卫在渲染期读不到它。
   - 停靠 tab 增加 `DOCK_HOVER_DELAY_MS` 悬停延时（`floating.js:440-455`）：指针只是扫过 tab
     不会把球拉出来，停够 800ms 才 unsnap，离开即取消；点击仍然立即生效。
   - 两个定时器都在卸载时清理：一个挂起的收体会调用已销毁的 bridge，挂起的 unsnap 会去移动
     渲染进程已不再拥有的窗口。

## 未直接复用及原因（逐条）

- **`floating.js` 不能直接运行**：它依赖 dsh Host RPC、独立 overlay Session、`dsh-app://` 协议和
  iframe ChatView。pi-orb 移植其 DOM 结构、CSS 约定与状态机，会话与授权仍走本仓库
  `OrbSessionController` 与 broker。
- **`#transcript iframe`**：参考把对话渲染在 iframe 里；pi-orb 的对话是自身 React 树，因此没有
  iframe 元素，`#transcript` 直接承载消息节点（`.message`）。
- **参考专有界面面无对应物**：`#question*`（参考向用户提问的卡片）、`#tcc-*`（macOS 屏幕录制／
  辅助功能授权门）、`#ball-gif`（参考用 GIF 头像）、`mandatory-update-frame.*`、`welcome.*`、
  `update-dialog.*`、`selection-toolbar.*`。pi-orb 没有这些产品概念，按 AGENTS.md 不自行增加，
  因此不移植；这也意味着 `styles.css` 比参考的 `floating.css` 少一批选择器。
- **观察框**：参考 `observation-frame-window.ts` 是独立 click-through 原生 overlay；pi-orb 尚无
  该生命周期契约，**不在 renderer 里画会挡截图的假边框**。这是 P2-01 仍未完成的一项。
- **头像**：参考在 Desktop profile 里持久化自定义头像；pi-orb 使用仓库内静态
  `src/renderer/orb-avatar.png`，不扩展 Pi 配置写入。
- **桌面授权、历史、截图预览浮层**：参考没有对应产品面（它的 Access 三档权限与 pi-orb 的任务授权
  语义不同）。pi-orb 这些浮层用**已移植的令牌**表达（`--white`/`--border`/`--pin`/`--panel-radius`
  等），因此属于同一套设计系统，而不是第二套主题。
- **工作区未配置时没有 `#composer`**：参考没有「专用工作区」概念（那是 pi-orb 的 Pi 接入边界），
  未配置时 pi-orb 用「选择工作区」步骤替代 transcript，因此该状态下不渲染输入框——不提供
  Orb 模式尚不存在时的假输入口。

## 验证

| 项 | 证据 |
|---|---|
| 令牌、状态词表、参考 id、无残留 `orb__*` | `tests/renderer-reference-parity.test.ts`（17 条，含时序常量与收起守卫集合） |
| 打包产物中真的渲染出参考壳层、令牌解析为参考值、球为 72px/50% | `evidence/p2-05/packaged-smoke.json`（15/15，含本节新增 4 条） |
| **停靠滑动真的在动**（拖动到边缘后 dock，采样到 9 帧不同位置，从屏外 `x=-52` 滑到 tab `x=0,width=34`） | 同上，`the dock gesture slides the window off the edge instead of snapping it` |
| 缓动曲线、时长常量、矩形插值取整 | `tests/floating-dock-animation.test.ts`（4 条） |
| 主进程几何 | `tests/floating-geometry.test.ts` |
| 真实多显示器、DPI、锁屏恢复、人工拖动、观察框 overlay | **未验证**（支持矩阵 §3；人工步骤见 `manual-acceptance.md`） |

停靠滑动做过反向对照：把 `animateBounds` 的守卫改成恒真（即强制瞬移）后重新构建，打包探测里的
`distinctFrames` 从 9 掉到 2 并判定失败，恢复后重新通过——所以「在滑动」是被观测的性质，不是注释。

本记录不把「视觉相似」当作参考功能完成证明。前端的复用程度现在由上面的测试与打包探测断言，
不由文档措辞决定——这正是本节开头那次更正留下的教训。
