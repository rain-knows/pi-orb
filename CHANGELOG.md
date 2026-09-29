# Changelog

All notable changes to pi-orb are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Version numbers are meaningful only together with a row in
[`doc/support-matrix.md`](./doc/support-matrix.md). A combination that has not been
verified is recorded as *unverified* and is not claimed as compatible.

## [Unreleased]

### Fixed

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

### Added

- `evidence/p1-06/run-real-model-c7.mjs`: the real-model C7 entry point (real pi-web + real model),
  isolated so it never reads or writes the user's running orb — its own `--user-data-dir` and
  `PI_ORB_CONFIG`, and an agent dir whose `models.json` is a hard link and `auth.json` a symlink, so the
  real provider configuration is used with no second copy of any credential.
- `doc/manual-acceptance.md`: the single, step-by-step list of what genuinely cannot be automated
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
