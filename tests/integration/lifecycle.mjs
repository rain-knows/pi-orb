import { createRunDirectory } from '../../scripts/verify/run-directory.mjs';
// P1-07 lifecycle regression for session-level Access and queued Pi turns.
//
// The current contract keeps Access across normal turn completion, and revokes it on Stop, hide,
// workspace/session changes, and disconnect. This script exercises the shipped Electron/Pi Web
// path rather than trusting the code shape:
//
//   - one session Access grant survives three queued turns and idle;
//   - Stop and hide revoke without silently regranting;
//   - workspace and session changes replace the old grant with a new Full Access default;
//   - a pi-web disconnect revokes the current session grant;
//   - the session survives Stop and Access revocation.
//
// Superseded per-task and DOM experiments are available in Git history.
// This run writes session-access-regression.json.
//
// Run: node tests/integration/lifecycle.mjs

import { spawn, execFileSync } from "node:child_process";
import { connect } from "node:net";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, '../..');
const reportDir = createRunDirectory('access');
const checkWorkspaceUi = process.argv.includes("--workspace-ui");
const runRoot = join("D:\\pi-orb-p1-runs", `p1-07-lifecycle-${Date.now()}`);
const shellDataDir = join(runRoot, "shell-data");
const configPath = join(runRoot, "orb-config.json");
const workspace = join(runRoot, "orb-workspace");
const nextWorkspace = join(runRoot, "orb-workspace-next");
const electronBinary = join(repo, "node_modules", "electron", "dist", "electron.exe");

const DEBUG_PORT = 31421;
const PI_WEB_PORT = 31422;
const MODEL_PORT = 31423;
const PI_WEB_PASSWORD = "p1-07-lifecycle-password";
const piWebBaseUrl = `http://127.0.0.1:${PI_WEB_PORT}`;
const piWebWorktree = process.env.PI_ORB_EVIDENCE_PI_WEB;
if (!piWebWorktree) throw new Error('Set PI_ORB_EVIDENCE_PI_WEB to an installed, production-built Pi Web package.');
const agentDir = join(runRoot, "agent");
const sessionDir = join(agentDir, "sessions");
const homeDir = join(runRoot, "home");

mkdirSync(runRoot, { recursive: true });
mkdirSync(shellDataDir, { recursive: true });
mkdirSync(workspace, { recursive: true });
mkdirSync(nextWorkspace, { recursive: true });
for (const path of [agentDir, sessionDir, homeDir]) mkdirSync(path, { recursive: true });

let piWeb = null;
let modelServer = null;
let modelRequestCount = 0;
let modelResponseDelayMs = 150;

/**
 * Start pi-web and a local model provider.
 *
 * A desktop task is bound to a pi-web session, so without a session the collapse-revokes rule
 * cannot be exercised at all. Starting pi-web is what turns that check from a vacuous pass into a
 * real one.
 */
async function startPiWebAndProvider() {
  if (!existsSync(join(piWebWorktree, ".next", "BUILD_ID"))) {
    throw new Error(
      `the pi-web snapshot at ${piWebWorktree} is not built; build this Pi Web package first`,
    );
  }

  modelServer = await new Promise((done) => {
    const server = createServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: [{ id: "p1-model", object: "model", owned_by: "p1-test" }] }));
        return;
      }
      if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
        res.writeHead(404);
        res.end();
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      modelRequestCount += 1;
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(200, {
          "content-type": body.stream ? "text/event-stream" : "application/json",
          "cache-control": "no-cache",
        });
        res.write(
          `data: ${JSON.stringify({ id: "p1", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "p1-model", choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: "stop" }] })}\n\n`,
        );
        res.end("data: [DONE]\n\n");
      }, modelResponseDelayMs);
    });
    server.listen(MODEL_PORT, "127.0.0.1", () => done(server));
  });

  writeFileSync(
    join(agentDir, "settings.json"),
    `${JSON.stringify({ defaultProvider: "p1-local", defaultModel: "p1-model", defaultThinkingLevel: "off", defaultTools: ["read"], sessionDir, enableInstallTelemetry: false, enableAnalytics: false }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(agentDir, "models.json"),
    `${JSON.stringify({ providers: { "p1-local": { baseUrl: `http://127.0.0.1:${MODEL_PORT}/v1`, api: "openai-completions", apiKey: "p1-isolated-test-key", models: [{ id: "p1-model", name: "P1 model", contextWindow: 32768, maxTokens: 256, input: ["text"] }] } } }, null, 2)}\n`,
    "utf8",
  );

  const safeEnvKeys = ["SystemRoot", "SystemDrive", "ComSpec", "Path", "PATHEXT", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "CommonProgramFiles", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "OS", "WINDIR"];
  const cleanEnv = Object.fromEntries(
    safeEnvKeys.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]),
  );
  Object.assign(cleanEnv, {
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    PI_WEB_NO_OPEN: "1",
    PI_WEB_SKIP_VERSION_CHECK: "1",
    PI_WEB_HOSTNAME: "127.0.0.1",
    PI_WEB_PASSWORD,
    PI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_SESSION_DIR: sessionDir,
    HOME: homeDir,
    USERPROFILE: homeDir,
    PATH: process.env.PATH,
  });

  piWeb = spawn(
    process.execPath,
    [join(piWebWorktree, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PI_WEB_PORT), "-H", "127.0.0.1"],
    { cwd: piWebWorktree, env: cleanEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  piWeb.stdout.on("data", () => {});
  piWeb.stderr.on("data", () => {});

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await sleep(400);
    try {
      if ((await fetch(`${piWebBaseUrl}/login`)).status < 500) return;
    } catch {
      // Not up yet.
    }
  }
  throw new Error("pi-web did not start");
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const report = {
  capturedAt: new Date().toISOString(),
  checks: [],
  passed: false,
};

function check(name, ok, detail) {
  report.checks.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
}

const safe = (value, max = 300) => {
  try {
    const text = JSON.stringify(value, (_key, node) => (typeof node === "bigint" ? `${node}n` : node));
    return text === undefined ? String(value) : text.length > max ? `${text.slice(0, max)}…` : text;
  } catch (error) {
    return `<unserializable: ${error.message}>`;
  }
};

async function fetchTargets() {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  if (!response.ok) throw new Error(`DevTools endpoint returned ${response.status}`);
  return response.json();
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
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

let shell = null;
let target = null;
let shellErr = "";

try {
  // pi-web first: Access grants are bound to a real Pi session and generation.
  await startPiWebAndProvider();

  writeFileSync(
    configPath,
    `${JSON.stringify({
      version: 1,
      orbWorkspace: workspace,
      shortcut: "CommandOrControl+Shift+Space",
      window: { alwaysOnTop: true, x: 40, y: 40, width: 460, height: 700 },
    }, null, 2)}\n`,
    "utf8",
  );

  shell = spawn(
    electronBinary,
    [join(import.meta.dirname, "fixtures/bootstrap.cjs"), `--user-data-dir=${shellDataDir}`, `--remote-debugging-port=${DEBUG_PORT}`],
    {
      cwd: repo,
      env: {
        ...process.env,
        NODE_ENV: "development",
        PI_ORB_CONFIG: configPath,
        PI_ORB_PI_WEB_URL: piWebBaseUrl,
        PI_ORB_PI_WEB_PASSWORD: PI_WEB_PASSWORD,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  shell.stderr.on("data", (chunk) => (shellErr += chunk.toString()));
  shell.stdout.on("data", () => {});

  let pageTarget = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await sleep(500);
    if (shell.exitCode !== null) break;
    try {
      const targets = await fetchTargets();
      pageTarget = targets.find((target) => target.type === "page") ?? null;
      if (pageTarget) break;
    } catch {
      // Not up yet.
    }
  }
  if (!pageTarget) throw new Error(`no page target; stderr=${shellErr.slice(-400)}`);
  const cdp = await connectCdp(pageTarget.webSocketDebuggerUrl);

  const evaluate = async (expression) => {
    const outcome = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (outcome.exceptionDetails) {
      return { __exception: outcome.exceptionDetails.exception?.description ?? "failed" };
    }
    return outcome.result.value;
  };
  const status = async () => JSON.parse(await evaluate("window.orb.getStatus().then((s) => JSON.stringify(s))"));

  await sleep(2500);
  const initial = await status();
  const generation = initial.generation;

  // Establish the session before granting Access. The session is then kept across ordinary turns.
  const ensured = await evaluate("window.orb.ensureSession().then((id) => id).catch((e) => 'ERR:' + e.message)");
  report.environment = {
    generation,
    ensureResult: String(ensured).slice(0, 120),
    piWebReachable: initial.piWeb?.reachable ?? null,
  };

  // The session id the bridge is addressed with.
  const sessionId = typeof ensured === "string" && !ensured.startsWith("ERR:") ? ensured : null;
  const defaultStatus = await status();
  if (checkWorkspaceUi) {
    const fullSelected = await evaluate("document.getElementById('permission-label').textContent === '完全访问' && document.getElementById('access-full').getAttribute('aria-selected') === 'true'");
    check("real renderer displays Full Access selected at startup", fullSelected === true, "actual main grant and actual renderer");
    const noChange = JSON.parse(await evaluate(`window.orb.setWorkspace(${JSON.stringify(workspace)}, false).then(s => JSON.stringify(s))`));
    check("selecting the current workspace preserves session and generation", noChange.sessionId === defaultStatus.sessionId && noChange.generation === defaultStatus.generation, "no new session");
  }
  check("new Orb session defaults to Full Access bound to its session and generation", defaultStatus.desktopTask?.authorized === true && defaultStatus.desktopTask?.level === "full-access" && defaultStatus.desktopTask?.sessionId === sessionId && defaultStatus.desktopTask?.generation === generation, safe(defaultStatus.desktopTask));

  /** The bridge handshake written by the shell, used to read state from the main process. */
  function handshake() {
    const path = join(shellDataDir, "bridge-token.json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  }

  /**
   * Ask the bridge (main process) for the Access grant state.
   *
   * This goes through the named pipe rather than the renderer on purpose: once the window is hidden
   * its renderer can be suspended, so a renderer-based read would never resolve after a collapse.
   */
  async function bridgeStatus(session, generationForStatus, type = "status", extra = {}) {
    const handshakeData = handshake();
    if (!session || !handshakeData) return null;
    return new Promise((done) => {
      const socket = connect(handshakeData.pipePath);
      let data = "";
      const timer = setTimeout(() => {
        socket.destroy();
        done({ ok: false, reason: "timeout" });
      }, 5000);
      socket.on("connect", () =>
        socket.write(
          `${JSON.stringify({ version: 2, requestId: `status-${Date.now()}`, type, token: handshakeData.token, sessionId: session, generation: generationForStatus, ...extra })}\n`,
        ),
      );
      socket.on("data", (chunk) => (data += chunk.toString("utf8")));
      socket.on("end", () => {
        clearTimeout(timer);
        const line = data.split(/\r?\n/).find((entry) => entry.trim().startsWith("{"));
        try {
          done(line ? JSON.parse(line) : { ok: false, reason: "malformed" });
        } catch {
          done({ ok: false, reason: "malformed" });
        }
      });
      socket.on("error", (error) => {
        clearTimeout(timer);
        done({ ok: false, reason: "unreachable", message: String(error.message) });
      });
    });
  }

  const setAccess = async (runGeneration = generation) => JSON.parse(await evaluate(
    `window.orb.setOrbAccess({ generation: ${runGeneration}, level: 'workspace-write' }).then((s) => JSON.stringify(s))`,
  ));
  const access = await setAccess();
  report.access = access;
  check("a session exists before Access is granted", sessionId !== null, String(ensured).slice(0, 120));
  check("Workspace Write binds to the current session and generation", access.authorized === true && access.level === "workspace-write" && access.sessionId === sessionId && access.generation === generation, safe(access).slice(0, 250));

  // Queue three prompts in one session; normal idle must keep the selected Access grant.
  for (const text of ["first queued turn", "second queued turn", "third queued turn"]) {
    await evaluate(`window.orb.sendPrompt({ generation: ${generation}, text: ${JSON.stringify(text)} })`);
  }
  let sawBusy = false;
  let afterQueue = await status();
  for (let attempt = 0; attempt < 120; attempt += 1) {
    sawBusy ||= afterQueue.busy === true;
    if (sawBusy && afterQueue.busy === false && modelRequestCount >= 3) break;
    await sleep(100);
    afterQueue = await status();
  }
  report.queuedTurns = { modelRequestCount, status: afterQueue };
  check("three queued prompts used the local Pi model", modelRequestCount >= 3, `requests=${modelRequestCount}`);
  check("the same session and Workspace Write grant survive queued turns and idle", afterQueue.sessionId === sessionId && afterQueue.generation === generation && afterQueue.busy === false && afterQueue.desktopTask?.authorized === true && afterQueue.desktopTask?.level === "workspace-write", safe(afterQueue).slice(0, 350));

  // Stop a live turn. The stub delays its response long enough for the real Stop route to cancel it.
  modelResponseDelayMs = 5000;
  await evaluate(`window.orb.sendPrompt({ generation: ${generation}, text: "stop this turn" })`);
  let running = await status();
  for (let attempt = 0; attempt < 40 && !running.busy; attempt += 1) {
    await sleep(50);
    running = await status();
  }
  const stopped = await evaluate(`window.orb.abort({ generation: ${generation} }).then(() => true).catch(() => false)`);
  const afterStop = await status();
  report.stop = { runningBeforeStop: running.busy, stopped, status: afterStop };
  check("Stop was exercised while a prompt was running", running.busy === true && stopped === true, safe(report.stop).slice(0, 350));
  check("Stop revokes Access but preserves the Pi session and generation", afterStop.desktopTask?.authorized === false && afterStop.sessionId === sessionId && afterStop.generation === generation && afterStop.busy === false, safe(afterStop).slice(0, 350));
  await evaluate("window.orb.ensureSession()");
  const afterEnsure = await status();
  check("ensuring the stopped session does not silently restore Full Access", afterEnsure.desktopTask?.authorized === false, safe(afterEnsure.desktopTask));

  // A real native observation finishes while the model is still thinking. The frame must outlive
  // that tool, then disappear on idle. The target is disposable; no user app receives input.
  await evaluate(`window.orb.setOrbAccess({ generation: ${generation}, level: 'full-access' })`);
  const targetEnv = { ...process.env, PI_ORB_SPEED_ROOT: runRoot };
  delete targetEnv.ELECTRON_RUN_AS_NODE;
  target = spawn(electronBinary, [join(repo, "tests/integration/fixtures/lifecycle-target")], { env: targetEnv, windowsHide: true, stdio: "ignore" });
  for (let attempt = 0; attempt < 60 && !existsSync(join(runRoot, "geometry.json")); attempt++) await sleep(100);
  const hwnd = Number(execFileSync("powershell.exe", ["-NoProfile", "-Command", `(Get-Process -Id ${target.pid}).MainWindowHandle.ToInt64()`], { encoding: "utf8", windowsHide: true }).trim());
  modelResponseDelayMs = 6000;
  await evaluate(`window.orb.sendPrompt({ generation: ${generation}, text: "observation frame lifetime" })`);
  execFileSync("powershell.exe", ["-NoProfile", "-File", join(repo, "tests/integration/fixtures/activate-window.ps1"), "-Hwnd", String(hwnd), "-ForegroundOnly"], { windowsHide: true, encoding: "utf8" });
  const observed = await bridgeStatus(sessionId, generation, "observe");
  const frames = () => JSON.parse(readFileSync(join(shellDataDir, "probe-windows.json"), "utf8")).filter(w => w.url.endsWith("observation-frame.html"));
  await sleep(2200);
  const duringThinking = { busy: (await status()).busy, frames: frames() };
  check("observation succeeds on a disposable native target", observed.ok === true && observed.result?.window?.pid === target.pid, safe(observed.result?.window));
  check("frame persists after the native tool while the model is thinking", duringThinking.busy && duringThinking.frames.some(w => w.visible), safe(duringThinking));
  for (let attempt = 0; attempt < 90 && (await status()).busy; attempt++) await sleep(100);
  await sleep(150);
  check("frame disappears when the Pi turn becomes idle", frames().length > 0 && frames().every(w => !w.visible), safe(frames()));

  // -------------------------------------------------------------------------
  // Collapse revokes. The collapse is triggered through the window's own control, which is the
  // same lifecycle routine the shortcut and the tray use — so this exercises the real route rather
  // than a proxy for it.
  //
  // Important: once the window is hidden its renderer can be suspended, so the effect is read back
  // through the *bridge* (main process), which cannot be suspended by the window being hidden.
  // -------------------------------------------------------------------------
  await setAccess();
  const beforeCollapse = await status();
  const bridgeStatusBefore = await bridgeStatus(sessionId, generation);

  report.collapse = {
    beforeAuthorized: beforeCollapse.desktopTask?.authorized ?? null,
    bridgeAuthorizedBefore: bridgeStatusBefore?.result?.authorized ?? null,
  };

  // The window's own hide control. The call returns the post-collapse state from the main process,
  // so the assertion does not depend on the (possibly suspended) renderer answering again.
  const collapseResult = JSON.parse(
    await evaluate("window.orb.collapseOrb().then((s) => JSON.stringify(s))"),
  );
  report.collapse.collapseResponse = safe(collapseResult).slice(0, 300);
  await sleep(800);

  const bridgeStatusAfter = await bridgeStatus(sessionId, generation);
  report.collapse.bridgeAuthorizedAfter = bridgeStatusAfter?.result?.authorized ?? null;
  report.collapse.bridgeStatusAfter = safe(bridgeStatusAfter).slice(0, 300);

  const revokedByCollapse =
    report.collapse.bridgeAuthorizedBefore === true &&
    (report.collapse.bridgeAuthorizedAfter === false || collapseResult.authorized === false);
  check("collapsing the orb revokes session Access", revokedByCollapse, safe(report.collapse));
  check("collapse clears the observation frame", frames().every(w => !w.visible), safe(frames()));
  writeFileSync(join(shellDataDir, "probe-control.json"), JSON.stringify({ nonce: Date.now(), wake: true }));
  await sleep(1500);
  const afterReopen = await status();
  check("explicitly reopening the hidden Orb selects Full Access on the same session", afterReopen.sessionId === sessionId && afterReopen.desktopTask?.authorized === true && afterReopen.desktopTask?.level === "full-access", safe(afterReopen.desktopTask));

  // A workspace switch replaces the old grant with the new session's default.
  const beforeWorkspaceSwitch = await status();
  await setAccess(beforeWorkspaceSwitch.generation);
  let switchingActiveTurn = false;
  if (checkWorkspaceUi) {
    modelResponseDelayMs = 10000;
    await evaluate(`window.orb.sendPrompt({ generation: ${beforeWorkspaceSwitch.generation}, text: 'cancel this turn when switching workspace' })`);
    for (let attempt = 0; attempt < 40; attempt++) {
      switchingActiveTurn = (await status()).busy === true;
      if (switchingActiveTurn) break;
      await sleep(50);
    }
  }
  await evaluate(`window.orb.setWorkspace(${JSON.stringify(nextWorkspace)}, true)`);
  const afterWorkspaceSwitch = await status();
  if (checkWorkspaceUi) {
    check("workspace switching stops a real active local-provider turn", switchingActiveTurn && !afterWorkspaceSwitch.busy && afterWorkspaceSwitch.sessionId !== beforeWorkspaceSwitch.sessionId, "active before switch, idle new session after switch");
    const fullSelected = await evaluate("document.getElementById('permission-label').textContent === '完全访问' && document.getElementById('access-full').getAttribute('aria-selected') === 'true'");
    check("real renderer selects the new workspace's Full Access grant", fullSelected === true, "actual access update event");
  }
  report.workspaceSwitch = { before: beforeWorkspaceSwitch, after: afterWorkspaceSwitch };
  check("workspace switch replaces the old grant with Full Access for the new session generation", afterWorkspaceSwitch.desktopTask?.authorized === true && afterWorkspaceSwitch.desktopTask?.level === "full-access" && afterWorkspaceSwitch.desktopTask?.sessionId === afterWorkspaceSwitch.sessionId && afterWorkspaceSwitch.desktopTask?.generation === afterWorkspaceSwitch.generation && afterWorkspaceSwitch.workspace === nextWorkspace && afterWorkspaceSwitch.sessionId !== sessionId && afterWorkspaceSwitch.generation !== generation, safe({ before: beforeWorkspaceSwitch, after: afterWorkspaceSwitch }).slice(0, 500));

  // A new conversation also changes the session and receives its own default grant.
  const workspaceSessionId = afterWorkspaceSwitch.sessionId;
  const workspaceGeneration = afterWorkspaceSwitch.generation;
  await setAccess(workspaceGeneration);
  await evaluate("window.orb.newConversation()");
  const afterNewSession = await status();
  report.newSession = afterNewSession;
  check("new conversation replaces the old grant with its own Full Access default", afterNewSession.desktopTask?.authorized === true && afterNewSession.desktopTask?.level === "full-access" && afterNewSession.desktopTask?.sessionId === afterNewSession.sessionId && afterNewSession.sessionId !== workspaceSessionId && afterNewSession.generation === workspaceGeneration, safe(afterNewSession).slice(0, 350));

  check("the shell survived the lifecycle sequence", shell.exitCode === null, `exitCode=${shell.exitCode}`);

  // -------------------------------------------------------------------------
  // Disconnect revokes. The contract (§6.1, P1-07) says a lost connection clears desktop
  // authority: the grant belonged to a session in a run that no longer exists.
  //
  // The renderer is read with a timeout guard, because a hidden window's renderer can be suspended
  // and a hung `evaluate` would stall the whole run rather than reporting a result.
  // -------------------------------------------------------------------------
  const guardedEvaluate = async (expression) =>
    Promise.race([
      evaluate(expression),
      sleep(5000).then(() => "TIMEOUT"),
    ]);

  // Re-grant to the new session so the disconnect revocation is observable.
  const current = await status();
  const regranted = await guardedEvaluate(
    `window.orb.setOrbAccess({ generation: ${current.generation}, level: 'workspace-write' }).then((s) => JSON.stringify(s))`,
  );
  const currentSessionId = current.sessionId;
  const bridgeBeforeDisconnect = await bridgeStatus(currentSessionId, current.generation);
  report.disconnect = {
    regranted: safe(regranted).slice(0, 200),
    bridgeAuthorizedBefore: bridgeBeforeDisconnect?.result?.authorized ?? null,
    piWebPid: piWeb?.pid ?? null,
    sessionId: currentSessionId,
    generation: current.generation,
  };

  if (report.disconnect.bridgeAuthorizedBefore === true) {
    // Kill pi-web: the connection is now genuinely gone, not merely reported.
    try {
      piWeb?.kill();
    } catch {
      // Best effort.
    }
    await sleep(2500);

    const refreshed = await guardedEvaluate(
      "window.orb.refreshConnection().then((s) => JSON.stringify(s.desktopTask)).catch((e) => 'ERR:' + e.message)",
    );
    report.disconnect.refreshResult = safe(refreshed).slice(0, 250);

    const bridgeAfterDisconnect = await bridgeStatus(currentSessionId, current.generation);
    report.disconnect.bridgeAuthorizedAfter = bridgeAfterDisconnect?.result?.authorized ?? null;
    report.disconnect.bridgeStatusAfter = safe(bridgeAfterDisconnect).slice(0, 250);

    const revoked =
      report.disconnect.bridgeAuthorizedAfter === false ||
      (typeof refreshed === "string" && refreshed.includes('"authorized":false'));
    check("losing the pi-web connection revokes desktop authority", revoked, safe(report.disconnect));
  } else {
    check(
      "losing the pi-web connection revokes desktop authority",
      report.disconnect.bridgeAuthorizedAfter !== true,
      `not exercised: no authority existed to revoke (${safe(report.disconnect)})`,
    );
    report.disconnect.note = "not exercised: no session Access grant existed to revoke in this environment";
  }

  cdp.close();
} catch (error) {
  if (error?.stdout) report.nativeForegroundFailure = String(error.stdout).trim().slice(0, 600);
  check("the lifecycle regression completed without error", false, error?.message ?? String(error));
  report.fatal = String(error?.stack ?? error).slice(0, 1000);
  report.stderrTail = shellErr.slice(-600);
} finally {
  await sleep(300);
  if (target?.pid) try { execFileSync("taskkill.exe", ["/PID", String(target.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch { /* Already exited. */ }
  try {
    shell?.kill();
    await sleep(1000);
    if (shell && shell.exitCode === null) shell.kill("SIGKILL");
  } catch {
    // Best effort.
  }
  try {
    piWeb?.kill();
    await sleep(800);
    if (piWeb && piWeb.exitCode === null) piWeb.kill("SIGKILL");
  } catch {
    // Best effort.
  }
  try {
    modelServer?.close();
  } catch {
    // Best effort.
  }

  report.passed = report.checks.length > 0 && report.checks.every((entry) => entry.ok);
  mkdirSync(reportDir, { recursive: true });
  const output = process.argv.find(argument => argument.startsWith("--output="))?.slice(9) ?? join(reportDir, "session-access-regression.json");
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks }, null, 2));
}

process.exit(report.passed ? 0 : 1);
