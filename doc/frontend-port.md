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
| `reference-panel.png` | Pinned reference HTML/CSS/image, expanded up-left in the light theme; host labels supplied by the capture script |

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
client. The local selection chip and session Access bridge use pi-orb host interfaces.
URL/path opening and automatic screenshot saving are outside the approved product boundary.

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
saved conversations, chooses a workspace, selects/revokes session Access, and
previews/confirms/discards screenshots through `window.orb`. There is no DSH
RPC compatibility endpoint. The Pi Web model picker is wired in stage 3 and is
available from the native context menu rather than the main Access controls.

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

## Stage 4: frontend completion gate

`evidence/frontend-port/visual-review.md` records the initial state-by-state comparison
at the reference window sizes. `capture-baseline.mjs --reference` renders the
actual pinned reference DOM/CSS/image with fixture host state;
`probe-interactions.mjs` captures the packaged pi-orb window while exercising
its real preload/main-process boundary against a deterministic Pi Web wire
fixture. The initial access gate and screenshot preview use Pi-specific UI, so their
comparison is against the same shell tokens and geometry. The preview image
is explicitly synthetic.

The applicable reference renderer interaction tests have been adapted to
JSDOM. They check hover, pin, delayed collapse, the 4 px drag threshold,
docking, history, question cards, selection, theme, keyboard editing and
right-click editing behavior through the actual page DOM. The packaged probe
checks reduced-motion dock styling with emulated media. Reference
`setTextEditing` and `restoreFrontApp` exist to return focus to the previous
macOS app during a running DSH task; the Windows Pi Orb keeps keyboard focus
in its composer.

The initial frontend port passed its then-current test, lint, packaged smoke and
interaction gates. The session Access, queue and lifecycle implementation added later is recorded below.

## Stage 5: session Access, queue and foreground observations

Reference sources: `apps/desktop/src/orb-permission.ts` and the pinned
`floating.{html,css,js}`. The renderer exposes only `History / Access / New` in
the top row; Access selects `Read Only / Workspace Write / Full Access`. Model,
screenshot and shortcut commands remain in the native context menu or existing
global gesture. The three tiers map to observation/list/wait, those plus input,
and those plus `orb_open_app`, respectively.

The grant binds to the current Orb session and run generation. The prompt queue
keeps one Pi session and its grant across consecutive turns. The Windows driver
obtains the current foreground app for each observation, excludes the Orb
process, and binds the next action to that observation id and HWND.
`orb_open_app` activates an already running app and returns a fresh observation;
it does not launch applications. The reference GIF is copied from
`apps/desktop/renderer/deepseek-avatar-square.gif`; its source and license are
recorded in `THIRD_PARTY_NOTICES.md`.

Pi adaptation boundaries: session id/generation checks, screenshot preview
confirmation, Windows foreground APIs and the restricted named-pipe bridge
remain pi-orb code. DSH RPC and iframe session UI are not copied. Access revokes
on hide, stop, disconnect, workspace/session change and process exit; normal
turn idle preserves it.

Targeted verification covers session/generation refusal, missing Access, stale
observations after regrant, all three tiers, multi-prompt queue progression, and
the actual renderer DOM. Full-suite, lint, build, package probe and live-model
outcomes are recorded in `doc/reference-experience-gap.md` after this run.
