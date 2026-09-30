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

## Stage 2: renderer replacement

`src/renderer/index.html` and `floating.css` are direct copies of the pinned
reference, with the host-specific substitutions in the table above. The
reference interaction functions for theme, composer sizing, hover, pin, drag,
dock, history and permission menu are ported in `floating.js`. Pi's existing
preload bridge supplies the session, desktop task, selection and screenshot
operations. `orb-surface.css` contains only Pi-specific workspace, access and
preview surfaces. The obsolete `App.tsx`, `main.tsx`, `styles.css`, renderer
bridge type, Vite React plugin, React packages and JSX compiler setting were
removed. `jsdom@29.1.1` and `@types/jsdom@28.0.3` follow the reference test
setup as development dependencies.

The renderer now sends and stops Pi prompts, shows streaming replies, opens
saved conversations, chooses a workspace, approves/revokes desktop tasks, and
previews/confirms/discards screenshots through `window.orb`. There is no DSH
RPC compatibility endpoint. The model picker remains hidden until the Pi Web
model commands are wired in stage 3.

Verification at this stage: 449 unit/renderer tests passed; `npm run typecheck`
and `npm run package:win:dir` passed; the packaged smoke test passed all 19
checks, including preload isolation, real native window enumeration, reference
shell geometry, context menu and dock animation. Actual packaged captures are
`evidence/frontend-port/after-{ball,panel,access}.png`. The panel and access
captures were inspected at 344 × 444 against the reference capture.

## Stage 3: reference interaction and Pi Web adapters

The reference's `floating.js` question draft functions and `floating.html`
question card provide the interaction pattern. Pi Web's existing
`extension_ui_request` events (`select`, `confirm`, `input`, `editor`) map into
that card; the reply uses its existing `extension_ui_response` command through
the Orb session and generation guards. The reference's DSH waterfall event
client and multi-question answer envelope are not transported into Pi Web.
Pi Web's `custom` terminal UI is not rendered as a reference question card
because it has different input and update semantics.

Pi Web's `tool_execution_start/end` events create transcript progress rows.
The reference transcript iframe stays absent: the existing Pi Web session
client and sanitized Orb event channel provide the data. The reference model
menu concept is backed by Pi Web's `/api/models?cwd=` catalog and `set_model`
session command. Model changes are restricted to the Orb session, rejected
during a running turn, and checked against the workspace catalog. No separate
model registry was added.

The packaged `probe-interactions.mjs` uses a deterministic Pi Web wire fixture
with the real Electron main process, preload and renderer. It verified model
catalogue loading, a prompt, tool progress, a blocking choice and its exact
response ID, plus the resumed assistant reply. `interaction-probe.json` records
the command sequence; `after-{ready,model,question,tool-thread}.png` are actual
packaged-window captures. The fixture does not stand in for the real-model
closed-loop acceptance gate in stage 6.
