# Desktop tool alignment

> 本页记录迁移前的 `orb_*` 工具契约，现已废弃。当前模型可见工具、自动首帧和后台任务见
> [`reference-toolset-transition.md`](./reference-toolset-transition.md) 与
> [`toolset-comparison-2026-10-04.md`](./toolset-comparison-2026-10-04.md)。
> 下文的工具名、工具数量和“只激活不启动”描述均是历史记录，不是当前验收契约。

## Source

The behavior baseline is `rain-knows/deepseek-harness-orb`, MIT, commit
`72f1d738458a223696685a909e806b683eff5885`, primarily
`packages/experimental/tool-computer-use/src/plugin.ts`, `wait-args.ts`,
`coordinates.ts`, `backend.ts` and the Windows backend/specs. Pi Orb keeps its
own extension, bridge, session generation and explicit session Access grant. The
reference Cordis session and DSH RPC are not copied.

## Stage 5 result

The model-visible Orb surface now exposes eleven bounded tools:

`orb_observe`, `orb_click`, `orb_type`, `orb_scroll`, `orb_hotkey`,
`orb_long_press`, `orb_drag`, `orb_open_app`, `orb_wait`, `orb_long_wait`,
`orb_list_apps`.

The action contracts follow the reference Windows behavior:

- click accepts left/right button, single/double click and the reference
  modifier whitelist; modifiers are pressed only for that click and released
  in a `finally` path;
- type names its own screenshot position and supports `replace` and `submit`;
  the old implicit last-click position was removed;
- scroll is vertical only (`up`/`down`) and uses the reference 1-10 amount;
- wait is fixed at one second; long wait accepts only 10, 30, 60 or 120 seconds;
- list apps and foreground metadata are returned with a fresh observation;
- every action requires the latest observation and the session's current Access level; it returns a
  fresh screenshot, observation id, foreground metadata and window identity for the next action;
- each `orb_observe` selects the current foreground application. Actions remain bound to that
  observation and refuse if the foreground identity changes before input is sent;
- element tokens are not exposed to the model because the Windows backend
  produces no element tree. The parser rejects token payloads instead of
  silently falling back to coordinates.

The reference `Read Only / Workspace Write / Full Access` levels now gate the tool set for the
current Orb session. `orb_open_app` is available only at Full Access; it activates an already
running application and verifies the resulting foreground window, then returns a fresh observation.
It never launches a process. Cross-screen drag and automatic screenshot export remain outside the
approved Pi boundary.

## Verification

The adapted reference backend tests cover click modifiers, button/count,
replace/submit input, vertical scroll, cancellation, foreground metadata,
running-app listing, fixed waits, stale observations, access-tier enforcement, grant/session binding,
and revocation races. Full-suite, typecheck, lint, build, package probe and live model acceptance are
recorded in `doc/reference-experience-gap.md` after the current implementation run.
