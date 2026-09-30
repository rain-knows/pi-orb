# Desktop tool alignment

## Source

The behavior baseline is `rain-knows/deepseek-harness-orb`, MIT, commit
`72f1d738458a223696685a909e806b683eff5885`, primarily
`packages/experimental/tool-computer-use/src/plugin.ts`, `wait-args.ts`,
`coordinates.ts`, `backend.ts` and the Windows backend/specs. Pi Orb keeps its
own extension, bridge, session generation and explicit task authorization. The
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
- every action still requires the current observation, authorization and task
  budget, then captures a new image from the same HWND;
- element tokens are not exposed to the model because the Windows backend
  produces no element tree. The parser rejects token payloads instead of
  silently falling back to coordinates.

`orb_open_app` remains the product-specific narrowing: it activates an already
running application and verifies the resulting foreground window; it never
launches a process. Cross-screen drag and automatic screenshot export remain
outside the approved Pi boundary.

## Verification

The adapted reference backend tests cover click modifiers, button/count,
replace/submit input, vertical scroll, cancellation, foreground metadata,
running-app listing, fixed waits, stale observations and target safety. The
full suite, typecheck, lint and production build pass after this stage.
