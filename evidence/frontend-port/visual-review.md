# Floating window visual review

Baseline: `rain-knows/deepseek-harness-orb` MIT, commit
`72f1d738458a223696685a909e806b683eff5885`,
`apps/desktop/renderer/floating.{html,css,js}`. All panel images are
344 × 444 px; ball images are 96 × 96 px. Reference frames use the pinned
renderer with injected host state. Pi frames use the packaged Electron app;
the session flow uses a deterministic Pi Web HTTP/SSE fixture.

| State | Reference | pi-orb | Review |
|---|---|---|---|
| Collapsed ball | [reference](reference-ball.png) | [after](after-ball.png) | Same 96 px shell and avatar placement. |
| Expanded light | [reference](reference-panel.png) | [after](after-ready.png) | Shell radius, controls, composer and avatar follow reference; Pi workspace hint occupies the empty transcript. |
| Expanded dark | [reference](reference-dark.png) | [after](after-dark.png) | Palette and shell geometry follow reference; system color scheme propagates. |
| Growing input | [reference](reference-input.png) | [after](after-input.png) | Composer expands within the shell; keyboard Enter, Shift+Enter and IME behavior covered by DOM test. |
| Question card | [reference](reference-question.png) | [after](after-question.png) | Reference card layout and option controls; Pi question arrives over a real tool-progress transcript. |
| History | [reference](reference-history.png) | [after](after-history.png) | Same floating history surface; Pi data comes from `/api/sessions`. |
| Docked tab | [reference](reference-dock.png) | [after](after-dock.png) | Same edge tab; actual main-process dock state reached by renderer pointer gesture. Reduced-motion animation resolves to `none`. |
| Pi access | — | [after](after-access.png) | Pi-only explicit authorization uses the reference shell, type scale and controls. |
| Pi model | — | [after](after-model.png) | Pi Web catalogue in reference-style popover. |
| Pi screenshot preview | — | [visual fixture](after-preview-fixture.png) | Uses the Pi preview sheet and a synthetic editor image; this image does not prove native capture. |
| Tool transcript | — | [after](after-tool-thread.png) | Pi Web tool events and assistant continuation render in the reference panel. |

Before replacement: [ball](before-ball.png), [panel](before-panel.png).
The old panel's setup screen, typography and controls diverged substantially
from the reference. The new panel uses the copied reference DOM/CSS and the
ported state machine. Host-only controls are confined to `orb-surface.css`.

The reference renderer's macOS `setTextEditing`/`restoreFrontApp` behavior
supports its automatic return to the previous foreground app. The Windows
Orb keeps focus in the editable field and the shell context menu preserves
cut/copy/paste actions.
