# pi-orb

An open-source Electron desktop companion for [pi-web](https://github.com/agegr/pi-web).
pi-orb adds a floating orb window with a dedicated working directory and an explicit,
user-authorized desktop mode. It is **not** another agent harness: it reuses the
existing pi-web / Pi session engine, model configuration and credentials.

## Product direction

pi-orb is a **non-destructive extension of pi-web**, built on Pi's supported plugin
system and small Electron adapters. Its product shape, floating-window behavior,
interaction language and desktop workflow are implemented by directly reusing the
reference project [deepseek-harness-orb](https://github.com/rain-knows/deepseek-harness-orb)
wherever possible. pi-web remains the owner of sessions, model loops, credentials and
plugin loading; Orb-specific tools and prompts are scoped to the configured Orb workspace
and explicit user authorization.

The primary local read-only reference checkout is
`D:\pi-orb-ref\deepseek-harness-orb`, pinned to
`72f1d738458a223696685a909e806b683eff5885` (two further checkouts of the same commit are
recorded in [`AGENTS.md`](./AGENTS.md)). They are research and source-audit checkouts, not runtime
dependencies.

Before changing anything that touches the floating shell, the desktop backend, the tool contract or
the authorization path, start from
[`doc/reference-playbook.md`](./doc/reference-playbook.md): it indexes the reference files, pins the
constants and interaction specs that must match, lists what is reusable, adaptable or off limits, and
gives the per-task procedure plus the upstream-sync steps. The reuse-first rules themselves are in
[`AGENTS.md`](./AGENTS.md).

- Development goals, non-destructive contract and acceptance matrix: [`doc/pi-orb-development-goals.md`](./doc/pi-orb-development-goals.md)
- Technology choices and version boundaries: [`doc/tech-stack.md`](./doc/tech-stack.md)
- Supported and unverified version combinations: [`doc/support-matrix.md`](./doc/support-matrix.md)
- Document index: [`doc/README.md`](./doc/README.md)
- Verification evidence: [`evidence/README.md`](./evidence/README.md)
- Version history: [`CHANGELOG.md`](./CHANGELOG.md)

## Status

**P1 feature-complete; not a complete v0.1 release.** All seven P1 tasks (`P1-01` … `P1-07`) are
implemented and each has a reproducible record under [`evidence/`](./evidence/README.md).

P2 work is now being delivered in small reference-reuse stages. P2-01's renderer shape and
Electron floating-window geometry follow the pinned DeepSeek Orb shell source and are recorded in
[`doc/p2-01-reference-reuse.md`](./doc/p2-01-reference-reuse.md); real multi-display, DPI and
manual drag acceptance remains explicitly unverified.

v0.1 is defined as M1 + M2 + M3 + P1-07:

| Milestone | State |
|---|---|
| M1 — floating window, dedicated workspace, chat | **Complete** (P1-01, P1-02, P1-03) |
| M2 — explicitly authorized screenshot context | **Complete** (P1-04, 41/41): the positive path — record the user's target, capture by handle, preview, confirm, and the model receiving those exact bytes — is verified on this machine |
| M3 — one-action-one-observation computer use | **Core loop complete** (P1-05, P1-06): background and **foreground** clicks land on the aimed target, a foreground scroll both reaches and moves the intended element, and a point picked off a screenshot lands on that same point in the target within one run — all judged from the target's own event log. The model addresses a position as a fraction of the screenshot it can see, not as a screen coordinate. Typing into Chromium content, elevated windows, multi-monitor, and a **real** model choosing to call the tools remain unverified |
| P1-07 — safety, regression and release gate | **Complete** |

P2 is being delivered as separately reviewable reference-reuse stages:

| Stage | State |
|---|---|
| P2-01 — reference floating shell, geometry and interactions | **Implemented; real multi-display, DPI and manual drag acceptance remains unverified** |
| P2-02 — double-Alt screenshot gesture | **Implemented; real keyboard, AltGr and non-US layout acceptance remains unverified** |
| P2-03 — pi-web history and selection context | **History and Windows UI Automation selection chip implemented; real UIA, multi-display/DPI and native selection toolbar remain unverified** |
| P2-04 — reference desktop actions | **Hotkey, long press, same-window drag, authorized post-action image blocks and explicit screenshot export implemented; real desktop actions, target pixels and clipboard/save-dialog acceptance remain unverified** |
| P2-05 — Windows distribution | **Unpacked app and per-user NSIS installer build; the packaged artifact's contents are audited (25/25) and the packaged app is started and driven (10/10, including a real desktop window enumeration). Clean-machine install, uninstall, upgrade and the unsigned-installer SmartScreen experience remain unverified** |

So the current build is **not** a complete v0.1: the unverified items above are narrow but real, and M3
must not be described as done. They are listed one by one in
[`doc/support-matrix.md`](./doc/support-matrix.md) with manual verification steps; the release gate
checks that those unverified records still exist, so a release cannot turn green by deleting them.

Unverified means disabled or reported as unavailable, never silently faked. No mock stands in for a
native input, cancellation or key-release check.

## Repository layout

| Path | Contents |
|---|---|
| `src/main/` | Electron main process: window, tray, shortcut, Orb configuration, pi-web client, session controller |
| `src/preload/` | Sandboxed `contextBridge` bridge; the only channel between renderer and main |
| `src/renderer/` | React UI for the orb window |
| `src/shared/` | Code shared by main, preload, renderer and the Pi extension (configuration schema and matching rules, IPC contract) |
| `pi-package/` | Pi resources shipped with pi-orb; `extensions/orb.ts` is the Orb mode entry point |
| `tests/` | Unit tests for pure logic and the workspace rules |
| `evidence/` | Reproducible verification records, per P0/P1/P2 stage |
| `resources/` | Packaging assets (the application icon, derived from the approved product avatar) |
| `doc/` | Goals, technology choices, support matrix and supporting research |

## Verification

Every claim in this repository is backed by a script that can be re-run. Start with
the release gate, which runs the project's quality gates and checks the release
hygiene, the license inventory and the evidence records:

```powershell
node evidence/p1-07/run-release-gate.mjs
```

The per-stage commands, including the native acceptance runs, are listed in
[`evidence/README.md`](./evidence/README.md).

## Development

```powershell
npm install
npm run typecheck
npm test
npm run lint
npm run build
```

`npm run dev` starts the Electron shell with a hot-reloading renderer.

### Building a Windows distribution

```powershell
npm run package:win:dir   # release/<version>/win-unpacked, no NSIS download needed
npm run package:win       # release/<version>/pi-orb-<version>-win-x64.exe (per-user NSIS, unsigned)
node evidence/p2-05/run-p2-05.mjs   # build + audit the contents + start the packaged app
```

The packaging posture — electron-builder, per-user NSIS with elevation disabled, `asarUnpack` for
native modules, no update feed — follows the reference project's
[`apps/desktop/scripts/electron-builder-config.mjs`](https://github.com/rain-knows/deepseek-harness-orb)
at the pinned commit; what is not copied is its dsh-monorepo release pipeline. Three deliberate
deviations from electron-builder's defaults are documented in
[`doc/p2-05-distribution.md`](./doc/p2-05-distribution.md) §4 (no native rebuild, third-party build
residue trimmed, icon derived from the approved avatar asset).

The installer is **unsigned**, so Windows SmartScreen will warn about an unknown publisher. Clean
install, uninstall, upgrade and SmartScreen acceptance are manual steps, not automated ones: see
[`doc/manual-acceptance.md`](./doc/manual-acceptance.md) §9.

### Environment

| Variable | Meaning |
|---|---|
| `PI_ORB_PI_WEB_URL` | pi-web base URL. Default `http://127.0.0.1:30141`. |
| `PI_ORB_PI_WEB_PASSWORD` | pi-web password used by the main process. |
| `PI_ORB_CONFIG` | Overrides the Orb configuration path. The Pi extension reads the same variable. |

Credentials stay in the Electron main process. pi-orb never starts, restarts or stops
a pi-web service it did not start itself.

### Installing the Pi extension

The Orb tools exist only in a session whose Pi configuration declares this repository's package.
pi-orb does **not** register it for you — writing into your Pi settings would modify your environment
unasked — so it is one explicit step, using the official CLI:

```powershell
pi install D:\workself\pi-orb\pi-package   # declare the local package
pi list                                     # confirm; the CLI writes a `packages` array entry
```

Then restart pi-web: Pi reads the declaration at process start. To undo it, one command removes the
declaration again (it copies no files, so nothing else is left behind):

```powershell
pi remove D:\workself\pi-orb\pi-package
```

The full walkthrough, including why a session without this step has no `orb_*` tool, is in
[`doc/manual-acceptance.md`](./doc/manual-acceptance.md) §1.1.

## Non-destructive guarantees

The following are contract requirements, not aspirations
(see [`doc/pi-orb-development-goals.md`](./doc/pi-orb-development-goals.md) §2):

- **N1–N3** A session whose working directory is not the configured Orb workspace
  gains no tool, no command and no prompt section.
- **N4** pi-orb only connects to an existing pi-web. It never takes ownership of a
  service it did not start.
- **N5** Two clients may browse the same session; only one entry point holds control
  of a task.
- **N6** Installing, closing or removing pi-orb deletes no user workspace file and no
  history.
- **N7** Disconnect, reload, session change, lock and exit revoke desktop authority
  and release keys, mouse, locks and listeners.
- **N8** Explicit versions, small adaptation modules, no silent API fallbacks and no
  compatibility layers for abandoned paths.

**One unavoidable exception, stated explicitly:** Pi loads the *user-level*
`~/.agents/skills` unconditionally, resolved from `HOME` at runtime and independent
of both `cwd` and `agentDir` (see [`evidence/p0-01/README.md`](./evidence/p0-01/README.md)).
When that directory exists it reaches the prompt of **every** session, including
normal non-Orb ones. pi-orb therefore promises that it does not actively change those
prompts — it cannot promise the prompt content is byte-identical.

## Licensing

pi-orb is MIT licensed (see [`LICENSE`](./LICENSE)).

Third-party obligations are recorded in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
The bundled desktop backend is the MIT licensed Windows implementation imported from
`deepseek-harness-orb` commit `72f1d738458a223696685a909e806b683eff5885`; historical Cua probe
records remain under `evidence/` but are not production dependencies.
