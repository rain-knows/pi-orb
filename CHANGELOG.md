# Changelog

All notable changes to pi-Orb are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Version numbers are meaningful only together with a row in
[`doc/support-matrix.md`](./doc/support-matrix.md). A combination that has not been
verified is recorded as *unverified* and is not claimed as compatible.

## [Unreleased]

### Added

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

### Fixed

Both defects below produced no error anywhere and were found only by running the real
application:

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

### Security

- Renderer runs with `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false` and a restrictive CSP. pi-web credentials never leave the
  main process.

## Version policy

- `0.x` while the minimum usable product is incomplete. Minor versions add capability,
  patch versions fix defects; a breaking change to the configuration schema or the IPC
  contract raises the minor version and is described here.
- A release records its verified combination (pi-Orb, Node, Electron, Pi SDK, pi-web,
  desktop driver, OS) in the support matrix. Verified rows are evidence-backed; see the
  linked file under `evidence/`.
