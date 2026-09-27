# Changelog

All notable changes to pi-Orb are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Version numbers are meaningful only together with a row in
[`doc/support-matrix.md`](./doc/support-matrix.md). A combination that has not been
verified is recorded as *unverified* and is not claimed as compatible.

## [Unreleased]

### Added

- Repository foundation: `package.json` with a locked dependency set, TypeScript
  `strict`, ESLint, Vitest, and an `electron-vite` build producing main, preload and
  renderer bundles.
- `.gitignore` covering dependencies, build output, scratch directories, local agent
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
