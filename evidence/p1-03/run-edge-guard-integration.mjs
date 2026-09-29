// P1-03 native integration probe.
//
// This is deliberately separate from the human acceptance record: it uses a reserved-looking
// F24 shortcut and synthetic key events to verify the real Electron globalShortcut + uiohook pair.
// It does not open a user workspace, send text, or touch the product's running user profile.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..", "..");
const runRoot = join("D:\\pi-orb-p1-runs", `p1-03-edge-${Date.now()}`);
const electronBinary = join(repo, "node_modules", "electron", "dist", "electron.exe");
const esbuildBinary = process.execPath;
const esbuildEntry = join(repo, "node_modules", "esbuild", "bin", "esbuild");
const shortcut = "Control+Alt+F24";
const guardBundle = join(runRoot, "shortcut-edge-guard.cjs");
const childPath = join(runRoot, "child.cjs");
const appPackagePath = join(runRoot, "package.json");
const userDataDir = join(runRoot, "electron-data");
const uiohookEntry = join(repo, "node_modules", "uiohook-napi", "dist", "index.js");

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const result = {
  capturedAt: new Date().toISOString(),
  shortcut,
  runRoot,
  isolation: {
    userDataDir,
    syntheticKeyEvents: 0,
    note: "The probe uses only Control+Alt+F24 and a temporary Electron profile; it is not the manual A4 result.",
  },
  ready: null,
  report: null,
  checks: [],
  passed: false,
};

function check(name, ok, detail) {
  result.checks.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
}

function buildGuardBundle() {
  const built = spawnSync(
    esbuildBinary,
    [esbuildEntry, join(repo, "src", "main", "shortcut-edge-guard.ts"), "--bundle", "--platform=node", "--format=cjs", `--outfile=${guardBundle}`],
    { cwd: repo, encoding: "utf8", windowsHide: true },
  );
  if (built.status !== 0) throw new Error(`could not bundle edge guard: ${built.stderr || built.stdout}`);
}

function writeChild() {
  writeFileSync(appPackagePath, JSON.stringify({ name: "pi-orb-edge-probe", version: "0.0.0", main: "child.cjs" }, null, 2), "utf8");
  writeFileSync(
    childPath,
    `const { app, BrowserWindow, globalShortcut } = require("electron");
const { ShortcutEdgeGuard } = require(${JSON.stringify(guardBundle)});
const { uIOhook } = require(${JSON.stringify(uiohookEntry)});

const shortcut = ${JSON.stringify(shortcut)};
let callbacks = 0;
let accepted = 0;
let win = null;
let guard = null;
let finished = false;

function finish() {
  if (finished) return;
  finished = true;
  const report = { callbacks, accepted, guardEnabled: guard?.enabled ?? false, guardError: guard?.error ?? null };
  console.log(JSON.stringify({ type: "report", report }));
  guard?.stop();
  globalShortcut.unregisterAll();
  if (win && !win.isDestroyed()) win.destroy();
  app.quit();
}

app.whenReady().then(() => {
win = new BrowserWindow({ show: false, width: 120, height: 80 });
guard = new ShortcutEdgeGuard(uIOhook);
guard.configure(shortcut);
const guardStarted = guard.start();
const registered = guardStarted && globalShortcut.register(shortcut, () => {
  callbacks += 1;
  if (guard.accept()) accepted += 1;
});
console.log(JSON.stringify({ type: "ready", guardStarted, registered, guardError: guard.error }));
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  if (chunk.includes("report")) finish();
});
setTimeout(finish, 3500);
});
`,
    "utf8",
  );
}

function waitForLine(child, predicate, timeoutMs = 10_000) {
  return new Promise((resolveWait, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for child output; tail=${buffer.slice(-500)}`));
    }, timeoutMs);
    const onData = (chunk) => {
      buffer += chunk.toString();
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        try {
          const parsed = JSON.parse(line);
          if (predicate(parsed)) {
            cleanup();
            resolveWait(parsed);
            return;
          }
        } catch {
          // Electron may write non-JSON startup noise; keep scanning for the structured line.
        }
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`child exited before expected output: ${code}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.once("exit", onExit);
  });
}

const heldKeys = [];

async function toggleKey(uIOhook, key, toggle) {
  uIOhook.keyToggle(key, toggle);
  if (toggle === "down") heldKeys.push(key);
  else {
    const index = heldKeys.lastIndexOf(key);
    if (index >= 0) heldKeys.splice(index, 1);
  }
  result.isolation.syntheticKeyEvents += 1;
  await sleep(35);
}

let child = null;
let parentHook = null;
let childStderr = "";
try {
  mkdirSync(userDataDir, { recursive: true });
  buildGuardBundle();
  writeChild();

  child = spawn(electronBinary, [runRoot, `--user-data-dir=${userDataDir}`], {
    cwd: repo,
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stderr.on("data", (chunk) => {
    childStderr += chunk.toString();
  });
  const ready = await waitForLine(child, (message) => message.type === "ready");
  result.ready = ready;
  check("Electron started the native edge guard", ready.guardStarted === true, JSON.stringify(ready));
  check("Electron registered the integration shortcut", ready.registered === true, JSON.stringify(ready));
  check("the guard has no startup error", ready.guardError === null, String(ready.guardError));

  const { UiohookKey, uIOhook } = await import("uiohook-napi");
  parentHook = uIOhook;
  parentHook.start();
  const press = async () => {
    await toggleKey(parentHook, UiohookKey.Ctrl, "down");
    await toggleKey(parentHook, UiohookKey.Alt, "down");
    await toggleKey(parentHook, UiohookKey.F24, "down");
    await sleep(700);
    await toggleKey(parentHook, UiohookKey.F24, "up");
    await toggleKey(parentHook, UiohookKey.Alt, "up");
    await toggleKey(parentHook, UiohookKey.Ctrl, "up");
  };

  await press();
  await press();
  parentHook.stop();
  parentHook = null;
  const reportMessage = await waitForLine(child, (message) => message.type === "report");
  result.report = reportMessage.report;
  check("a held shortcut produced at least one OS callback", result.report.callbacks >= 1, JSON.stringify(result.report));
  check("the first hold was accepted once per edge", result.report.accepted === 2, JSON.stringify(result.report));
  check("the hook remained enabled for both holds", result.report.guardEnabled === true, JSON.stringify(result.report));
  result.passed = result.checks.every((entry) => entry.ok);
} catch (error) {
  result.error = `${error instanceof Error ? error.message : String(error)}${childStderr ? `; stderr=${childStderr.slice(-1200)}` : ""}`;
} finally {
  if (parentHook) {
    for (const key of [...heldKeys].reverse()) {
      try {
        parentHook.keyToggle(key, "up");
      } catch {
        // Best effort; do not hide the original probe failure.
      }
    }
  }
  try {
    parentHook?.stop();
  } catch {
    // Best effort; the key release sequence runs before normal cleanup.
  }
  if (child && child.exitCode === null) {
    child.kill();
    await sleep(300);
  }
  writeFileSync(join(repo, "evidence", "p1-03", "edge-guard-integration.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  rmSync(runRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({ passed: result.passed, checks: result.checks, error: result.error ?? null }, null, 2));
if (!result.passed) process.exitCode = 1;
