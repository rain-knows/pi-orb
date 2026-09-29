# Contributing to pi-orb

English | [中文](CONTRIBUTING.zh.md)

Thanks for considering a contribution. pi-orb is a small project with an unusual constraint, so
please read this before opening a pull request — most review comments come from these rules rather
than from style preference.

## The one rule that shapes everything: reuse the reference project

pi-orb is a non-destructive extension of [pi-web](https://github.com/agegr/pi-web) whose product
shape, floating window, interaction language and desktop backend are **ported from**
[`rain-knows/deepseek-harness-orb`](https://github.com/rain-knows/deepseek-harness-orb) at a pinned
commit. That means:

- **Before writing anything**, open [`doc/reference-playbook.md`](doc/reference-playbook.md) and find
  which reference file owns the behaviour you are about to touch. It indexes the reference files with
  line numbers, the constants and interaction specs that must match, what is reusable, what is
  adaptable and what is off limits.
- **If the reference already implements it, port it — do not rewrite an equivalent.** A
  self-designed version of something the reference already has will be asked to be replaced.
- **If it genuinely cannot be ported**, record the reference file, commit and the difference in a
  stage document first, then write the smallest possible adapter. `doc/p2-01-reference-reuse.md` and
  `doc/p2-05-distribution.md` are the two worked examples.
- **Attribute correctly.** Ported code keeps its MIT notice and a per-file header naming the source
  repository, commit and original path, and it is listed in
  [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Never describe ported work as original, and
  never describe original work as ported — `src/main/double-alt.ts` carries a comment explaining why
  its header was corrected for exactly that reason.
- Do not add settings, navigation, permission steps, visual decoration or product concepts the
  reference does not have. The only additions allowed are the ones the Pi/pi-web boundary forces.

## Non-destructive contract

Sections N1–N8 of [`doc/pi-orb-development-goals.md`](doc/pi-orb-development-goals.md) are
requirements, not aspirations. The short version:

- A session whose working directory is not the configured Orb workspace gains **no** tool, no command
  and no prompt section.
- pi-orb connects to an existing pi-web. It never starts, restarts, upgrades or stops one it did not
  start, and it never writes into pi-web's working tree or `node_modules`.
- Installing, closing or removing pi-orb deletes no user file and no history.
- Revocation (collapse, stop, disconnect, session change, lock, exit) releases keys, mouse, locks and
  listeners, and drops desktop authority and the recorded target.

## Getting set up

Windows x64 is the only supported platform; see
[`doc/support-matrix.md`](doc/support-matrix.md) for the verified version combinations.

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Notes that cost people time:

- npm 11 blocks dependency install scripts by default. Electron's binary will not download unless its
  `allowScripts` entry is honoured (it is declared in `package.json`); if `node_modules/electron/dist`
  is empty, the build and every packaged probe fail in confusing ways.
- `PI_ORB_*` environment variables (pi-web URL, password, config path) are documented in the
  [README](README.md#environment).

## Verification is part of the change

Every claim in this repository is backed by a script that can be re-run. A pull request is expected to
carry the evidence for what it changes, in the same commit:

| You changed | Run this | And record |
|---|---|---|
| Anything | `npm run typecheck && npm run lint && npm test` | — |
| Anything at all | `node evidence/p1-07/run-release-gate.mjs` | `evidence/p1-07/release-gate.json` |
| Desktop backend, coordinates, tools | `node evidence/p1-06/run-p1-06-tools.mjs` | `evidence/p1-06/tool-exposure.json` |
| Packaging, icon, dependencies | `node evidence/p2-05/run-p2-05.mjs` | `evidence/p2-05/*.json` |
| Anything a human must judge | [`doc/manual-acceptance.md`](doc/manual-acceptance.md) | the matching table there |

Rules that the release gate enforces on your behalf:

- **Never weaken an assertion to make a check pass.** If a test cannot hold, the behaviour is wrong or
  the test is wrong — say which, in the commit message.
- **Unverified stays unverified.** A capability that has not been measured on a real desktop is
  listed under "未验证 / unverified" in `doc/support-matrix.md`. Do not move a row to the supported
  table without evidence a reader can reproduce.
- **Deleting a record is not a fix.** The gate requires the acceptance records and their unverified
  items to still be present, so a release cannot turn green by removing what it could not satisfy.
- **Gate checks must be falsifiable.** Each of them exists because it caught something; when you add
  one, show in the commit message what makes it fail.

## Commits and stages

Work is delivered in small, separately reviewable stages, each with its own documentation and commit
(`P1-01` … `P1-07`, `P2-01` … `P2-05`). A stage commit is expected to update, in the same change:

- the code and its tests;
- the relevant `evidence/<stage>/` record, regenerated rather than hand-edited;
- [`CHANGELOG.md`](CHANGELOG.md);
- [`doc/support-matrix.md`](doc/support-matrix.md) if any verified/unverified status moved (it is the
  single source for version compatibility — never state support anywhere else);
- the stage document under `doc/` when the change is architectural or reuses new reference material.

Write commit messages that say what was wrong before and how you know it is right now. The history is
the project's reasoning record; "fix stuff" costs the next reader an afternoon.

## Licensing

pi-orb is MIT licensed. By contributing you agree your contribution is provided under the same
license. Do not add a dependency whose license conflicts with redistribution — the gate fails on
AGPL/GPL-3/SSPL components and requires every production dependency to declare a license.

## Reporting a security or safety problem

Please do not open a public issue for anything exploitable. See [`SECURITY.md`](SECURITY.md).
