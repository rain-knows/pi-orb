# Floating renderer port: fixed reference baseline

Source repository: `rain-knows/deepseek-harness-orb`, MIT, commit
`72f1d738458a223696685a909e806b683eff5885`. Both the preferred sparse
checkout and the complete local checkout reported that exact commit before work.
The complete checkout supplies `apps/desktop/renderer/floating.{html,css,js}` and
`apps/desktop/tests/floating-renderer.spec.ts`.

## Stage 1: baseline and boundaries

The 344 × 444 pixel comparison is in `evidence/frontend-port/`:

| Image | What it captures |
|---|---|
| `before-ball.png` | Packaged pi-orb 0.1.0, isolated unconfigured profile, collapsed |
| `before-panel.png` | Same packaged app, hover-expanded setup panel |
| `reference-panel.png` | Pinned reference HTML/CSS/image, expanded up-left, dark attribute and host labels supplied by the capture script |

`capture-baseline.mjs` makes these captures. The reference frame is a visual
renderer fixture because its DSH host does not run inside pi-orb; it does not
claim an end-to-end reference session. All three images use the same viewport.

| Reference section | Reuse | Necessary Pi boundary |
|---|---|---|
| `floating.html` panel, top controls, transcript, question, history, selection, composer, ball, dock, stop | Copy DOM and IDs | Remove macOS TCC gate; add workspace, desktop authorization and screenshot review surfaces |
| `floating.css` layout, tokens, dark palette, transitions, composer and gesture states | Copy stylesheet | Remove DSH iframe/TCC-only rules; add the smallest rules for Pi surfaces |
| `floating.js` theme, text editing, composer sizing, hover/pin/drag/dock, popovers, question drafts | Port functions and state transitions | Replace `window.dshDesktop`, `dsh-app://` RPC, NDJSON event stream and iframe transcript with the existing restricted `window.orb` preload bridge and Pi Web client |
| `floating-renderer.spec.ts` interaction cases | Port applicable JSDOM scenarios | Replace DSH RPC assertions with bridge/Pi behavior; no DSH protocol shim |

The source does not supply a Windows native selection toolbar or a Pi Web session
client. The local selection chip and explicit desktop authorization continue to
use their existing host interfaces. Reference branding, URL/path opening and
automatic screenshot saving are outside the approved product boundary.

Each following stage records its own source mapping, test result and commit.
