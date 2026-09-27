# pi-Orb

An open-source Electron desktop companion for [pi-web](https://github.com/agegr/pi-web).
pi-Orb adds a floating orb window with a dedicated working directory and an explicit,
user-authorized desktop mode. It is **not** another agent harness: it reuses the
existing pi-web / Pi session engine, model configuration and credentials.

- Development goals, non-destructive contract and acceptance matrix: [`doc/pi-orb-development-goals.md`](./doc/pi-orb-development-goals.md)
- Technology choices and version boundaries: [`doc/tech-stack.md`](./doc/tech-stack.md)
- Supported and unverified version combinations: [`doc/support-matrix.md`](./doc/support-matrix.md)
- Document index: [`doc/README.md`](./doc/README.md)
- Verification evidence: [`evidence/README.md`](./evidence/README.md)
- Version history: [`CHANGELOG.md`](./CHANGELOG.md)

## Status

**P1 in progress.** P0 (proof that pi-Orb can attach to pi-web non-destructively) is
complete and recorded under [`evidence/`](./evidence/README.md). P1 is the minimum
usable product: `P1-01` … `P1-07`, i.e. M1 (floating window + chat), M2 (screen
context), M3 (computer use) and the release gate.

Capabilities that have not passed their acceptance step are labelled **unverified**
and stay disabled. No mock passes for native input, cancellation or key release.

## Repository layout

| Path | Contents |
|---|---|
| `src/main/` | Electron main process: window, tray, shortcut, Orb configuration, pi-web client, session controller |
| `src/preload/` | Sandboxed `contextBridge` bridge; the only channel between renderer and main |
| `src/renderer/` | React UI for the orb window |
| `src/shared/` | Code shared by main, preload, renderer and the Pi extension (configuration schema and matching rules, IPC contract) |
| `pi-package/` | Pi resources shipped with pi-Orb; `extensions/orb.ts` is the Orb mode entry point |
| `tests/` | Unit tests for pure logic and the workspace rules |
| `evidence/` | Reproducible verification records, per P0/P1 stage |
| `doc/` | Goals, technology choices, support matrix and supporting research |

## Development

```powershell
npm install
npm run typecheck
npm test
npm run lint
npm run build
```

`npm run dev` starts the Electron shell with a hot-reloading renderer.

### Environment

| Variable | Meaning |
|---|---|
| `PI_ORB_PI_WEB_URL` | pi-web base URL. Default `http://127.0.0.1:30141`. |
| `PI_ORB_PI_WEB_PASSWORD` | pi-web password used by the main process. `PI_WEB_PASSWORD` is accepted as a fallback. |
| `PI_ORB_CONFIG` | Overrides the Orb configuration path. The Pi extension reads the same variable. |

Credentials stay in the Electron main process. pi-Orb never starts, restarts or stops
a pi-web service it did not start itself.

## Non-destructive guarantees

The following are contract requirements, not aspirations
(see [`doc/pi-orb-development-goals.md`](./doc/pi-orb-development-goals.md) §2):

- **N1–N3** A session whose working directory is not the configured Orb workspace
  gains no tool, no command and no prompt section.
- **N4** pi-Orb only connects to an existing pi-web. It never takes ownership of a
  service it did not start.
- **N5** Two clients may browse the same session; only one entry point holds control
  of a task.
- **N6** Installing, closing or removing pi-Orb deletes no user workspace file and no
  history.
- **N7** Disconnect, reload, session change, lock and exit revoke desktop authority
  and release keys, mouse, locks and listeners.
- **N8** Explicit versions, small adaptation modules, no silent API fallbacks and no
  compatibility layers for abandoned paths.

**One unavoidable exception, stated explicitly:** Pi loads the *user-level*
`~/.agents/skills` unconditionally, resolved from `HOME` at runtime and independent
of both `cwd` and `agentDir` (see [`evidence/p0-01/README.md`](./evidence/p0-01/README.md)).
When that directory exists it reaches the prompt of **every** session, including
normal non-Orb ones. pi-Orb therefore promises that it does not actively change those
prompts — it cannot promise the prompt content is byte-identical.

## Licensing

pi-Orb is MIT licensed. The bundled desktop driver
(`@trycua/cua-driver@0.30.1`, Windows platform package) is `MIT AND MPL-2.0`; its
NOTICE and source-availability obligations are recorded in
[`evidence/p0-04/cua-artifact-manifest.json`](./evidence/p0-04/cua-artifact-manifest.json).
Third-party notices are collected before release (`P1-07`).
