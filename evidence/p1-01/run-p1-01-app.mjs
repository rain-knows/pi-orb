// P1-01 application-level workspace verification.
//
// The session and mode-matching behaviour is verified against a real pi-web in
// run-p1-01.mjs. This script covers the part that only the real Electron app can
// prove: the workspace *write* path.
//
//   - with nothing selected, Orb is disabled and NO configuration file exists
//     (selection is not implied by starting the app);
//   - a relative path, a missing directory and a file are all refused;
//   - a Windows junction and a differently-cased spelling resolve to ONE identity,
//     so one directory cannot become two different Orb modes;
//   - committing a workspace persists it, and the persisted value is the resolved
//     path;
//   - cancelling writes nothing at all: the configuration file is byte-identical
//     and no directory is created.
//
// Run: node evidence/p1-01/run-p1-01-app.mjs

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repo = resolve(import.meta.dirname, "..", "..");
const runRoot = join("D:\\pi-orb-p1-runs", `p1-01-app-${Date.now()}`);
const configPath = join(runRoot, "orb-config.json");
const userDataDir = join(runRoot, "userData");
const UNUSED_PI_WEB_PORT = 31990;
const DEBUG_PORT = 31991;

mkdirSync(runRoot, { recursive: true });

const realWorkspace = join(runRoot, "real-workspace");
const linkedWorkspace = join(runRoot, "linked-workspace");
const neverChosen = join(runRoot, "never-chosen");
const aFile = join(runRoot, "a-file.txt");
mkdirSync(realWorkspace, { recursive: true });
writeFileSync(aFile, "not a directory", "utf8");

// A junction is the Windows directory-link form that does not require elevation,
// which is why it is used here instead of a symbolic link.
let junctionCreated = false;
let junctionError = null;
try {
  symlinkSync(realWorkspace, linkedWorkspace, "junction");
  junctionCreated = true;
} catch (error) {
  junctionError = error.message;
}

const result = {
  capturedAt: new Date().toISOString(),
  runRoot,
  isolation: {
    configPath,
    userDataDir,
    realWorkspace,
    linkedWorkspace,
    neverChosen,
    piWebUrl: `http://127.0.0.1:${UNUSED_PI_WEB_PORT}`,
    note: "no pi-web service is started; this run only exercises the workspace write path",
  },
  checks: [],
  passed: false,
};

function check(name, ok, detail) {
  result.checks.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function fetchTargets() {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
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

async function evaluate(client, expression) {
  const outcome = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (outcome.exceptionDetails) {
    // Surface a rejected promise as data so a refusal can be asserted on.
    return { __exception: outcome.exceptionDetails.exception?.description ?? "evaluation failed" };
  }
  return outcome.result.value;
}

const electronBinary = join(repo, "node_modules", "electron", "dist", "electron.exe");
const child = spawn(electronBinary, [".", `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${DEBUG_PORT}`], {
  cwd: repo,
  env: {
    ...process.env,
    NODE_ENV: "development",
    PI_ORB_CONFIG: configPath,
    PI_ORB_PI_WEB_URL: `http://127.0.0.1:${UNUSED_PI_WEB_PORT}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

try {
  let pageTarget = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(500);
    if (child.exitCode !== null) break;
    try {
      const targets = await fetchTargets();
      pageTarget = targets.find((target) => target.type === "page") ?? null;
      if (pageTarget) break;
    } catch {
      // Debug endpoint not up yet.
    }
  }
  if (!pageTarget) throw new Error(`no page target; exitCode=${child.exitCode} stderr=${stderr.slice(-500)}`);

  const client = await connect(pageTarget.webSocketDebuggerUrl);
  const orb = (expression) => evaluate(client, `window.orb.${expression}`);

  // --- 1. nothing selected -------------------------------------------------
  const initialStatus = await orb("getStatus().then((s) => JSON.stringify(s))");
  const initial = JSON.parse(initialStatus);
  check("starting the app selects no workspace", initial.configured === false && initial.workspace === null, initialStatus);
  check(
    "no configuration file exists before a selection",
    !existsSync(configPath),
    existsSync(configPath) ? readFileSync(configPath, "utf8") : "absent",
  );

  // --- 2. refusals ---------------------------------------------------------
  const relative = await orb("validateWorkspace('relative\\\\dir').then((r) => JSON.stringify(r))");
  const relativeResult = JSON.parse(relative);
  check("relative path refused", relativeResult.ok === false && relativeResult.resolved === null, relative);

  const missing = await orb(`validateWorkspace(${JSON.stringify(join(runRoot, "does-not-exist"))}).then((r) => JSON.stringify(r))`);
  const missingResult = JSON.parse(missing);
  check("missing directory refused", missingResult.ok === false && missingResult.resolved === null, missing);
  check("refusing a missing directory creates nothing", !existsSync(join(runRoot, "does-not-exist")));

  const file = await orb(`validateWorkspace(${JSON.stringify(aFile)}).then((r) => JSON.stringify(r))`);
  const fileResult = JSON.parse(file);
  check("a file is refused as a workspace", fileResult.ok === false, file);

  // --- 3. identity: junction and case ---------------------------------------
  const real = JSON.parse(await orb(`validateWorkspace(${JSON.stringify(realWorkspace)}).then((r) => JSON.stringify(r))`));
  check("a real directory is accepted", real.ok === true, JSON.stringify(real));

  if (junctionCreated) {
    const linked = JSON.parse(await orb(`validateWorkspace(${JSON.stringify(linkedWorkspace)}).then((r) => JSON.stringify(r))`));
    check(
      "a junction resolves to the same workspace identity as its target",
      linked.ok === true && linked.resolved !== null && linked.resolved.toLowerCase() === real.resolved.toLowerCase(),
      JSON.stringify({ linked, real }),
    );
  } else {
    check("junction check skipped: creating a junction failed", false, junctionError);
  }

  const upper = JSON.parse(await orb(`validateWorkspace(${JSON.stringify(realWorkspace.toUpperCase())}).then((r) => JSON.stringify(r))`));
  check(
    "an upper-cased spelling of the same directory is one identity",
    upper.ok === true && upper.resolved.toLowerCase() === real.resolved.toLowerCase(),
    JSON.stringify(upper),
  );

  // --- 4. commit, then cancel ----------------------------------------------
  const committed = await orb(`setWorkspace(${JSON.stringify(realWorkspace)}, false).then((s) => JSON.stringify(s))`);
  const committedStatus = JSON.parse(committed);
  check("committing a workspace enables Orb", committedStatus.configured === true, committed);
  check(
    "the committed workspace is the resolved path",
    committedStatus.workspace?.toLowerCase() === real.resolved.toLowerCase(),
    `${committedStatus.workspace} vs ${real.resolved}`,
  );
  check("the configuration file was written", existsSync(configPath), configPath);

  const persisted = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const persistedConfig = persisted ? JSON.parse(persisted) : {};
  check(
    "the persisted workspace matches the resolved path",
    String(persistedConfig.orbWorkspace ?? "").toLowerCase() === real.resolved.toLowerCase(),
    persisted,
  );
  check("the persisted file keeps the schema version", persistedConfig.version === 1, persisted);

  // Cancelling: an empty candidate must not touch the file or create anything.
  const beforeBytes = readFileSync(configPath, "utf8");
  const cancelled = await orb("setWorkspace('', false).then((s) => JSON.stringify(s))");
  const afterBytes = readFileSync(configPath, "utf8");
  check("cancelling does not change the configuration file", beforeBytes === afterBytes, cancelled);
  check("cancelling creates no directory", !existsSync(neverChosen));
  check(
    "cancelling leaves the previously committed workspace in place",
    JSON.parse(cancelled).workspace?.toLowerCase() === real.resolved.toLowerCase(),
    cancelled,
  );

  // A missing directory must not be created without explicit confirmation.
  const refusedCreate = await orb(
    `setWorkspace(${JSON.stringify(neverChosen)}, false).then((s) => JSON.stringify(s))`,
  );
  check("a missing workspace is not created without confirmation", !existsSync(neverChosen), refusedCreate);
  check(
    "the rejected selection is reported to the user",
    JSON.parse(refusedCreate).problem !== null,
    refusedCreate,
  );
  check(
    "the rejected selection leaves the committed workspace intact",
    JSON.parse(refusedCreate).workspace?.toLowerCase() === real.resolved.toLowerCase(),
    refusedCreate,
  );

  // --- 5. no pi-web service: a clear failure, not a crash -------------------
  const ensure = await orb("ensureSession().then((id) => 'OK:' + id).catch((e) => 'ERR:' + e.message)");
  check(
    "a session request against an unreachable pi-web fails with a message instead of crashing",
    typeof ensure === "string" && ensure.startsWith("ERR:"),
    String(ensure).slice(0, 200),
  );
  check("the shell is still alive after that failure", child.exitCode === null && (await orb("getStatus().then(() => 'alive')")) === "alive");

  client.close();
  result.detail = { initial, real, persistedConfig };
  result.stdoutTail = stdout.trim().split(/\r?\n/).slice(-10).join("\n");
  result.stderrTail = stderr.trim().split(/\r?\n/).slice(-10).join("\n");
} catch (error) {
  check("workspace verification completed without error", false, error.message);
  result.stdoutTail = stdout.slice(-2000);
  result.stderrTail = stderr.slice(-2000);
} finally {
  child.kill();
  await sleep(1200);
  if (child.exitCode === null) child.kill("SIGKILL");
}

result.passed = result.checks.length > 0 && result.checks.every((entry) => entry.ok);
mkdirSync(join(repo, "evidence", "p1-01"), { recursive: true });
writeFileSync(join(repo, "evidence", "p1-01", "workspace-app.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ passed: result.passed, failed: result.checks.filter((c) => !c.ok) }, null, 2));

try {
  rmSync(runRoot, { recursive: true, force: true });
} catch {
  // Electron may still hold a handle on its profile directory.
}

process.exit(result.passed ? 0 : 1);
