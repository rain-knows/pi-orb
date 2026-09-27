/**
 * P1 foundation boot smoke test.
 *
 * Proves that the built application actually runs: the Electron shell starts, the
 * orb window exists, the sandboxed preload bridge reaches the renderer, the
 * renderer trusts it, and Node is NOT reachable from the renderer.
 *
 * Why this is not redundant with the unit tests: the preload format defect found
 * during this stage (an ESM `.mjs` preload that a sandboxed renderer cannot load)
 * produced no error anywhere — only a missing `window.orb`. Only a real boot can
 * observe that.
 *
 * Run: node evidence/p1-00-foundation/run-boot-smoke.mjs
 *
 * Uses the Chrome DevTools Protocol over a loopback debugging port. No screenshot
 * is taken and no pixel is written to disk. The pi-web URL points at an unused
 * port on purpose, so this test also confirms that a missing pi-web service is
 * reported instead of crashing the shell.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const runRoot = `D:\\pi-orb-p1-runs\\boot-smoke-${Date.now()}`;
const configPath = join(runRoot, "orb-config.json");
const userDataDir = join(runRoot, "userData");

// A dedicated port unlikely to collide with a real pi-web instance.
const UNUSED_PI_WEB_PORT = 31987;
const DEBUG_PORT = 31988;

const result = {
  capturedAt: new Date().toISOString(),
  runRoot,
  checks: [],
  passed: false,
};

function check(name, ok, detail) {
  result.checks.push({ name, ok, detail });
  return ok;
}

const electronBinary = join(repoRoot, "node_modules", "electron", "dist", "electron.exe");
mkdirSync(runRoot, { recursive: true });

const child = spawn(
  electronBinary,
  [".", `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${DEBUG_PORT}`],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PI_ORB_CONFIG: configPath,
      PI_ORB_PI_WEB_URL: `http://127.0.0.1:${UNUSED_PI_WEB_PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function fetchTargets() {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  if (!response.ok) throw new Error(`DevTools endpoint returned ${response.status}`);
  return response.json();
}

/** Minimal CDP client: enough for Runtime.evaluate and one page target. */
async function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", () => fail(new Error("CDP socket error")), {
      once: true,
    });
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

async function evaluate(client, expression) {
  const outcome = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (outcome.exceptionDetails) {
    throw new Error(outcome.exceptionDetails.exception?.description ?? "evaluation failed");
  }
  return outcome.result.value;
}

try {
  // Wait for the page target to appear.
  let pageTarget = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(500);
    if (child.exitCode !== null) break;
    try {
      const targets = await fetchTargets();
      pageTarget = targets.find((target) => target.type === "page") ?? null;
      if (pageTarget) break;
    } catch {
      // The debugging endpoint is not up yet.
    }
  }

  check(
    "electron shell stays alive",
    child.exitCode === null,
    `exitCode=${child.exitCode}`,
  );
  check("orb window created", pageTarget !== null, pageTarget?.title ?? "no page target");

  if (pageTarget) {
    const client = await connect(pageTarget.webSocketDebuggerUrl);

    const bridgeType = await evaluate(client, "typeof window.orb");
    check("preload bridge exposed to renderer", bridgeType === "object", `typeof window.orb = ${bridgeType}`);

    const sandbox = await evaluate(
      client,
      "JSON.stringify({ require: typeof require, process: typeof process, module: typeof module })",
    );
    const sandboxState = JSON.parse(sandbox);
    check(
      "no Node APIs in the renderer",
      sandboxState.require === "undefined" &&
        sandboxState.process === "undefined" &&
        sandboxState.module === "undefined",
      sandbox,
    );

    // Exercise the real IPC round trip through contextBridge -> ipcMain.
    const status = await evaluate(
      client,
      "window.orb.getStatus().then((s) => JSON.stringify(s)).catch((e) => 'ERR:' + e.message)",
    );
    const statusValue = status.startsWith("ERR:") ? null : JSON.parse(status);
    check(
      "IPC round trip returns status",
      statusValue !== null,
      statusValue ? JSON.stringify(statusValue) : status,
    );
    check(
      "unconfigured workspace disables Orb",
      statusValue?.configured === false,
      `configured=${statusValue?.configured}`,
    );

    const rendererText = await evaluate(client, "document.body.innerText");
    check(
      "renderer shows the workspace requirement",
      typeof rendererText === "string" && rendererText.includes("Choose workspace"),
      String(rendererText).slice(0, 120),
    );
    check(
      "renderer reports the unreachable pi-web service",
      typeof rendererText === "string" && /no pi-web service answered/i.test(rendererText),
      String(rendererText).slice(0, 200),
    );

    // A relative path must be refused by the same validation the UI uses.
    const relative = await evaluate(
      client,
      "window.orb.validateWorkspace('relative/dir').then((r) => JSON.stringify(r))",
    );
    const relativeValue = JSON.parse(relative);
    check(
      "relative workspace path refused over IPC",
      relativeValue.ok === false && relativeValue.resolved === null,
      relative,
    );

    client.close();
  }

  result.stdoutTail = stdout.trim().split(/\r?\n/).slice(-15).join("\n");
  result.stderrTail = stderr.trim().split(/\r?\n/).slice(-15).join("\n");
} catch (error) {
  check("smoke test completed without error", false, error.message);
  result.stdoutTail = stdout.slice(-2000);
  result.stderrTail = stderr.slice(-2000);
} finally {
  child.kill();
  await sleep(1000);
  if (child.exitCode === null) child.kill("SIGKILL");
}

result.passed = result.checks.length > 0 && result.checks.every((entry) => entry.ok);
writeFileSync(join(here, "boot-smoke.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ passed: result.passed, checks: result.checks }, null, 2));

// Clean the local run directory: it is scratch space, not evidence.
try {
  rmSync(runRoot, { recursive: true, force: true });
} catch {
  // The OS may still hold a handle on the Electron profile; harmless.
}

process.exit(result.passed ? 0 : 1);
