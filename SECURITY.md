# Security and safety policy

pi-orb drives the real desktop: it captures windows, posts synthetic mouse and keyboard input, and
runs inside an Electron shell that talks to your local pi-web. That makes two different kinds of
report relevant here, and they are handled differently.

## Scope

**In scope — treat as a security report:**

- a path by which a **non-Orb** session, or an unauthorized request, can reach a desktop capability
  (tool, capture, input) that the non-destructive contract says it must not have;
- authority that outlives its grant: an action accepted after revocation, a stale generation, a
  cancelled task, a different session, or a different target window;
- a way to make the bridge accept a request that did not come from the shell, or to reach pi-web's
  credentials from the renderer;
- credential or key material reaching a shipped artifact, the build output, or a log;
- an installer or packaged build that writes outside the Orb data directory and the workspace the
  user explicitly chose.

**Also in scope — report as a safety defect:**

- an action that lands on a **different window or application** than the one the user authorized, or
  that silently *changes* the target. The open-app path is deliberately activation-only for this
  reason (`doc/reference-playbook.md` §7.5): it must never launch a process, and it must fail rather
  than adopt whatever window happens to be in front;
- a key or mouse button left held after a cancellation, a refusal, a collapse or an exit;
- a screenshot taken, sent or written to disk without the user's explicit confirmation;
- an action reported to the model as successful when the target never received it.

## Out of scope

- **The limitations this project already documents.** Multi-monitor behaviour, elevated windows,
  typing into Chromium content, and the unsigned installer's SmartScreen prompt are known and listed
  as unverified in [`doc/support-matrix.md`](doc/support-matrix.md). A report that they are not
  implemented is not a vulnerability; a report that one of them **leaks authority or lands on the
  wrong target** is.
- Vulnerabilities in pi-web, Pi, Electron or a dependency: report those upstream. If pi-orb's
  integration is what makes it reachable, say so and we will treat it as in scope.
- Anyone with local administrator rights on the machine, or anything that requires the attacker to
  already control the user's session or the pi-orb process. pi-orb is not a sandbox and does not
  claim to be one: see "What pi-orb does not protect against" below.

## What pi-orb does not protect against

Being explicit is part of the product, not a disclaimer:

- **The Orb workspace is not a filesystem sandbox.** A cwd match marks where the Orb's own context
  lives; it does not restrict what the model's tools may read or write. Section 1.1 of
  [`doc/pi-orb-development-goals.md`](doc/pi-orb-development-goals.md) states this as a non-goal so
  nobody mistakes the workspace for isolation.
- **An authorized desktop task is a real grant of input authority.** While a task is approved, the
  model can move the mouse, type and press keys in the window you recorded. Approve a task only for a
  window you are willing to have manipulated, and prefer a disposable target.
- **Screen content is untrusted input.** Text visible in a captured window is data, never an
  instruction and never authorization. The Orb prompt says so; if you find a path where captured
  content can extend authority, that is a security report.

## Reporting

Open a **private** report through GitHub's
[security advisory](https://github.com/rain-knows/pi-orb/security/advisories/new) form for this
repository. Please do not open a public issue for anything exploitable.

A useful report contains:

- what an attacker gains, and what they must already control to get it;
- the exact steps, and whether they need a real desktop, a specific window, or a running pi-web;
- the pinned versions involved (pi-orb, Electron, Pi SDK, the reference backend commit — the support
  matrix lists them);
- whether the affected capability is one the support matrix marks verified or unverified.

There is no bug-bounty programme and no response-time guarantee. This is a small project, and it
would rather tell you honestly that it has not replied yet than promise a service level it cannot
keep.

## How a fix is expected to land

Fixes follow the normal stage process in [`CONTRIBUTING.md`](CONTRIBUTING.md): the behaviour change,
its regression test, the regenerated evidence record and the changelog entry in one commit. A fix for
an authority-escaping defect is also expected to add a **falsifiable** gate or test — one whose
failure mode is demonstrated in the commit message — because that class of defect is exactly what
those checks exist to catch.
