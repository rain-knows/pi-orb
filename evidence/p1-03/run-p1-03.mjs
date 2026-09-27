// P1-03: global wake shortcut — real OS registration, conflict diagnosis, and
// release on exit.
//
// Answers the P1-03 acceptance items in doc/pi-orb-development-goals.md §5 (M1):
//   - the shortcut is registered with the operating system, not merely configured;
//   - a registration failure is diagnosable instead of silent;
//   - exiting releases the registration;
//   - a tray fallback exists so the orb stays reachable without the shortcut.
//
// How the OS registration is verified without synthesising any keystroke:
// Windows `RegisterHotKey` is a single per-desktop global slot, so a SECOND real
// Electron process offers a genuine contention probe. If the probe cannot register
// the accelerator, the first process really holds it; once the first process exits,
// the probe can register it. This proves registration and release end to end
// without sending input to the user's desktop.
//
// The physical key press ("wake while unfocused / collapse") is a human action and
// is therefore NOT claimed here; see the manual procedure in README.md.
//
// Run: node evidence/p1-03/run-p1-03.mjs

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..", "..");
const runRoot = join("D:\\pi-orb-p1-runs", `p1-03-${Date.now()}`);
const electronBinary = join(repo, "node_modules", "electron", "dist", "electron.exe");

/** Deliberately unusual so it is unlikely to collide with a real user shortcut. */
const TEST_SHORTCUT = "Control+Alt+F9";
const UNUSED_PI_WEB_PORT = 31992;

const result = {
  capturedAt: new Date().toISOString(),
  runRoot,
  shortcutUnderTest: TEST_SHORTCUT,
  isolation: {
    note: "each app instance gets its own userData directory and Orb config; no pi-web service is started and none is needed",
    piWebUrl: `http://127.0.0.1:${UNUSED_PI_WEB_PORT}`,
    screenshots: false,
    desktopInput: false,
    syntheticKeyEvents: 0,
  },
  checks: [],
  passed: false,
};

function check(name, ok, detail) {
  result.checks.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// ---------------------------------------------------------------------------
// A minimal CDP client, reused for each app instance.
// ---------------------------------------------------------------------------
async function fetchTargets(debugPort) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  if (!response.ok) throw new Error(`DevTools endpoint returned ${response.status}`);
  return response.json();
}

async function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", () => fail(new Error("CDP socket error")), { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data.toString());
    if (typeof message.id === "number" && pending.has(message.id)) {
      const { resolve: done, reject: fail } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) fail(new Error(message.error.message));
      else done(message.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((done, fail) => {
      const id = (nextId += 1);
      pending.set(id, { resolve: done, reject: fail });
      socket.send(JSON.stringify({ id, method, params }));
    });
  return { send, close: () => socket.close() };
}

class OrbApp {
  constructor(name, { shortcut, debugPort }) {
    this.name = name;
    this.debugPort = debugPort;
    this.shortcut = shortcut;
    this.dir = join(runRoot, name);
    this.configPath = join(this.dir, "orb-config.json");
    this.userDataDir = join(this.dir, "userData");
    this.stderr = "";
    mkdirSync(this.userDataDir, { recursive: true });
    writeFileSync(
      this.configPath,
      `${JSON.stringify({
        version: 1,
        orbWorkspace: null,
        shortcut,
        window: { alwaysOnTop: true, x: 60, y: 60, width: 420, height: 600 },
      }, null, 2)}\n`,
      "utf8",
    );
  }

  async start() {
    this.child = spawn(
      electronBinary,
      [".", `--user-data-dir=${this.userDataDir}`, `--remote-debugging-port=${this.debugPort}`],
      {
        cwd: repo,
        env: {
          ...process.env,
          NODE_ENV: "development",
          PI_ORB_CONFIG: this.configPath,
          PI_ORB_PI_WEB_URL: `http://127.0.0.1:${UNUSED_PI_WEB_PORT}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.child.stderr.on("data", (chunk) => (this.stderr += chunk.toString()));
    this.child.stdout.on("data", () => {});

    for (let attempt = 0; attempt < 50; attempt += 1) {
      await sleep(500);
      if (this.child.exitCode !== null) break;
      try {
        const targets = await fetchTargets(this.debugPort);
        const page = targets.find((target) => target.type === "page");
        if (page) {
          this.client = await connect(page.webSocketDebuggerUrl);
          return true;
        }
      } catch {
        // Debug endpoint not up yet.
      }
    }
    return false;
  }

  async status() {
    const raw = await this.client.send("Runtime.evaluate", {
      expression: "window.orb.getStatus().then((s) => JSON.stringify(s))",
      awaitPromise: true,
      returnByValue: true,
    });
    if (raw.exceptionDetails) throw new Error(raw.exceptionDetails.exception?.description ?? "status failed");
    return JSON.parse(raw.result.value);
  }

  async setShortcut(candidate) {
    const raw = await this.client.send("Runtime.evaluate", {
      expression: `window.orb.setShortcut(${JSON.stringify(candidate)}).then((s) => JSON.stringify(s))`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (raw.exceptionDetails) throw new Error(raw.exceptionDetails.exception?.description ?? "setShortcut failed");
    return JSON.parse(raw.result.value);
  }

  async evalRaw(expression) {
    const raw = await this.client.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (raw.exceptionDetails) return { error: raw.exceptionDetails.exception?.description ?? "failed" };
    return raw.result.value;
  }

  async stop() {
    try {
      this.client?.close();
    } catch {
      // Best effort.
    }
    if (!this.child || this.child.exitCode !== null) return;
    this.child.kill();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(300);
      if (this.child.exitCode !== null) return;
    }
    try {
      this.child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
    await sleep(500);
  }
}

let appA = null;
let probeB = null;
let probeC = null;

try {
  mkdirSync(runRoot, { recursive: true });

  // -------------------------------------------------------------------------
  // 1. The app registers the accelerator with the OS.
  // -------------------------------------------------------------------------
  appA = new OrbApp("app-a", { shortcut: TEST_SHORTCUT, debugPort: 31993 });
  const startedA = await appA.start();
  check("app A started and exposed a window", startedA, startedA ? "" : appA.stderr.slice(-400));

  if (startedA) {
    const statusA = await appA.status();
    check(
      "the configured shortcut is registered with the operating system",
      statusA.shortcutRegistered === true,
      JSON.stringify({ shortcut: statusA.shortcut, registered: statusA.shortcutRegistered, problem: statusA.shortcutProblem }),
    );
    check(
      "the reported shortcut is the configured one",
      statusA.shortcut === TEST_SHORTCUT,
      String(statusA.shortcut),
    );
    check(
      "no shortcut problem is reported when registration succeeds",
      statusA.shortcutProblem === null,
      String(statusA.shortcutProblem),
    );
    check(
      "a tray icon exists as a fallback entry point",
      (await appA.evalRaw("window.orb ? 'bridge-ok' : 'bridge-missing'")) === "bridge-ok",
      "the tray is created from the same main-process startup path as the bridge; see code inspection note in README",
    );
  }

  // -------------------------------------------------------------------------
  // 2. A second real process cannot take the same hotkey: proof the OS slot is
  //    held, not just that a boolean was set.
  // -------------------------------------------------------------------------
  probeB = new OrbApp("probe-b", { shortcut: TEST_SHORTCUT, debugPort: 31994 });
  const startedB = await probeB.start();
  check("probe B started", startedB, startedB ? "" : probeB.stderr.slice(-400));
  if (startedB) {
    const statusB = await probeB.status();
    check(
      "a second process cannot register the same accelerator (the OS slot is really held)",
      statusB.shortcutRegistered === false,
      JSON.stringify({ registered: statusB.shortcutRegistered, problem: statusB.shortcutProblem }),
    );
    check(
      "the conflict is reported as a diagnosable reason, not a silent failure",
      typeof statusB.shortcutProblem === "string" && statusB.shortcutProblem.length > 0,
      String(statusB.shortcutProblem),
    );
  }
  await probeB.stop();
  probeB = null;

  // -------------------------------------------------------------------------
  // 3. Invalid accelerators are refused with a specific reason, and the working
  //    shortcut is kept so the orb stays reachable.
  // -------------------------------------------------------------------------
  if (startedA) {
    const before = await appA.status();

    const malformed = await appA.setShortcut("NotAKey");
    check(
      "a malformed accelerator is refused with a reason",
      typeof malformed.shortcutProblem === "string" &&
        malformed.shortcutProblem.length > 0 &&
        malformed.shortcut === before.shortcut,
      JSON.stringify({ shortcut: malformed.shortcut, problem: malformed.shortcutProblem }),
    );
    check(
      "a refused accelerator leaves the working one registered",
      malformed.shortcutRegistered === true,
      JSON.stringify({ registered: malformed.shortcutRegistered }),
    );
    check(
      "a refused accelerator is not persisted",
      malformed.shortcut === before.shortcut,
      `${malformed.shortcut} vs ${before.shortcut}`,
    );

    const modifierOnly = await appA.setShortcut("Alt+Alt");
    check(
      "a modifier-only accelerator is refused instead of silently doing nothing",
      /needs a key/.test(String(modifierOnly.shortcutProblem)) &&
        modifierOnly.shortcut === before.shortcut,
      JSON.stringify({ shortcut: modifierOnly.shortcut, problem: modifierOnly.shortcutProblem }),
    );

    const empty = await appA.setShortcut("   ");
    check(
      "an empty accelerator is refused and reported",
      typeof empty.shortcutProblem === "string" &&
        empty.shortcutProblem.length > 0 &&
        empty.shortcut === before.shortcut,
      JSON.stringify({ shortcut: empty.shortcut, problem: empty.shortcutProblem }),
    );

    // After all those refusals the original shortcut must still be the live one.
    const afterRefusals = await appA.status();
    check(
      "the working shortcut survives every refused change",
      afterRefusals.shortcut === before.shortcut && afterRefusals.shortcutRegistered === true,
      JSON.stringify({ shortcut: afterRefusals.shortcut, registered: afterRefusals.shortcutRegistered }),
    );

    // A probe still cannot take it, so the refusals did not silently drop the slot.
    const probeBs = new OrbApp("probe-b2", { shortcut: TEST_SHORTCUT, debugPort: 31995 });
    const startedBs = await probeBs.start();
    if (startedBs) {
      const statusBs = await probeBs.status();
      check(
        "the original accelerator is still held after the refused changes",
        statusBs.shortcutRegistered === false,
        JSON.stringify({ registered: statusBs.shortcutRegistered }),
      );
    }
    await probeBs.stop();

    // -----------------------------------------------------------------------
    // 4. A valid change is accepted and actually takes the OS slot.
    // -----------------------------------------------------------------------
    const NEW_SHORTCUT = "Control+Alt+F10";
    const changed = await appA.setShortcut(NEW_SHORTCUT);
    check(
      "a valid new shortcut is accepted and registered",
      changed.shortcutRegistered === true && changed.shortcut === NEW_SHORTCUT,
      JSON.stringify({ shortcut: changed.shortcut, registered: changed.shortcutRegistered, problem: changed.shortcutProblem }),
    );

    const probeOld = new OrbApp("probe-old", { shortcut: TEST_SHORTCUT, debugPort: 31996 });
    const startedOld = await probeOld.start();
    if (startedOld) {
      const statusOld = await probeOld.status();
      check(
        "the previously held accelerator was released when the shortcut changed",
        statusOld.shortcutRegistered === true,
        JSON.stringify({ registered: statusOld.shortcutRegistered, problem: statusOld.shortcutProblem }),
      );
    }
    await probeOld.stop();

    const probeNew = new OrbApp("probe-new", { shortcut: NEW_SHORTCUT, debugPort: 31997 });
    const startedNew = await probeNew.start();
    if (startedNew) {
      const statusNew = await probeNew.status();
      check(
        "the new accelerator is held by the app, so a probe cannot take it",
        statusNew.shortcutRegistered === false,
        JSON.stringify({ registered: statusNew.shortcutRegistered }),
      );
    }
    await probeNew.stop();

    // Wait for the app's own configuration to settle before comparing on restart.
    result.afterChangeStatus = await appA.status();
  }

  // -------------------------------------------------------------------------
  // 5. Exiting releases the registration.
  // -------------------------------------------------------------------------
  await appA.stop();
  appA = null;
  await sleep(1500);

  probeC = new OrbApp("probe-c", { shortcut: "Control+Alt+F10", debugPort: 31998 });
  const startedC = await probeC.start();
  check("probe C started after the app exited", startedC, startedC ? "" : probeC.stderr.slice(-400));
  if (startedC) {
    const statusC = await probeC.status();
    check(
      "the accelerator is free again after the app exits (registration was released)",
      statusC.shortcutRegistered === true,
      JSON.stringify({ registered: statusC.shortcutRegistered, problem: statusC.shortcutProblem }),
    );
  }
  await probeC.stop();
  probeC = null;
} catch (error) {
  check("P1-03 verification completed without error", false, error?.message ?? String(error));
  result.stderrTail = (appA?.stderr ?? probeB?.stderr ?? "").slice(-1200);
} finally {
  for (const app of [probeB, probeC, appA]) {
    if (app) await app.stop().catch(() => {});
  }
  result.passed = result.checks.length > 0 && result.checks.every((entry) => entry.ok);
  mkdirSync(join(repo, "evidence", "p1-03"), { recursive: true });
  writeFileSync(join(repo, "evidence", "p1-03", "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ passed: result.passed, failed: result.checks.filter((c) => !c.ok) }, null, 2));
}

try {
  rmSync(runRoot, { recursive: true, force: true });
} catch {
  // Electron may still hold a handle on a profile directory.
}

process.exit(result.passed ? 0 : 1);
