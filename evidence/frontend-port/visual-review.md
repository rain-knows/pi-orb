# Floating window visual review

Baseline: `rain-knows/deepseek-harness-orb` MIT, commit
`72f1d738458a223696685a909e806b683eff5885`,
`apps/desktop/renderer/floating.{html,css,js}`. All panel images are
344 × 444 px; ball images are 96 × 96 px. Reference frames use the pinned
renderer with injected host state. Pi frames use the packaged Electron app;
the session flow uses a deterministic Pi Web HTTP/SSE fixture.

Screenshots are local generated artifacts and are ignored by Git. The filenames below
refer to local captures, rather than files included in a fresh clone. Recreate reference
and current frames with `capture-baseline.mjs --reference`, `capture-baseline.mjs --after`
and `probe-interactions.mjs`; the before frames require the historical pre-port package.

| State | Reference | pi-orb | Review |
|---|---|---|---|
| Collapsed ball | `reference-ball.png` | `after-ball.png` | Same 96 px shell and avatar placement. |
| Expanded light | `reference-panel.png` | `after-ready.png` | Shell radius, controls, composer and avatar follow reference; Pi workspace hint occupies the empty transcript. |
| Expanded dark | `reference-dark.png` | `after-dark.png` | Palette and shell geometry follow reference; system color scheme propagates. |
| Growing input | `reference-input.png` | `after-input.png` | Composer expands within the shell; keyboard Enter, Shift+Enter and IME behavior covered by DOM test. |
| Question card | `reference-question.png` | `after-question.png` | Reference card layout and option controls; Pi question arrives over a real tool-progress transcript. |
| History | `reference-history.png` | `after-history.png` | Same floating history surface; Pi data comes from `/api/sessions`. |
| Docked tab | `reference-dock.png` | `after-dock.png` | Same edge tab; actual main-process dock state reached by renderer pointer gesture. Reduced-motion animation resolves to `none`. |
| Pi access | — | `after-access.png` | Pi-only explicit authorization uses the reference shell, type scale and controls. |
| Pi model | — | `after-model.png` | Pi Web catalogue in reference-style popover. |
| Pi screenshot preview | — | `after-preview-fixture.png` | Uses the Pi preview sheet and a synthetic editor image; this image does not prove native capture. |
| Tool transcript | — | `after-tool-thread.png` | Pi Web tool events and assistant continuation render in the reference panel. |
| Running tool and composer | — | `after-tool-running.png` | Compact Chinese status row; 36 px square stop icon; blank running input has transparent caret and no placeholder. |

Before replacement: `before-ball.png`, `before-panel.png`.
The old panel's setup screen, typography and controls diverged substantially
from the reference. The new panel uses the copied reference DOM/CSS and the
ported state machine. Host-only controls are confined to `orb-surface.css`.

The reference renderer's macOS `setTextEditing`/`restoreFrontApp` behavior
supports its automatic return to the previous foreground app. The Windows
Orb keeps focus in the editable field and the shell context menu preserves
cut/copy/paste actions.
