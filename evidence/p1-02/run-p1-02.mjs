// P1-02: minimum Electron orb window, end to end.
//
// Answers the P1-02 acceptance items in doc/pi-orb-development-goals.md §5 (M1):
//   - the orb window can send text, show streamed output and errors, and be
//     explicitly stopped;
//   - the conversation is an independent Orb session that the normal pi-web UI can
//     still browse;
//   - two clients browsing the same session do not double-send a task;
//   - the security posture holds: the renderer has no Node access, talks only
//     through contextBridge, and pi-web credentials stay in the main process.
//
// The whole chain is real: real Electron, real pi-web (fixed-HEAD snapshot), real
// provider calls captured by a local fake provider. No real model, no real
// credentials, no screenshots, no desktop input.
//
// Run: node evidence/p1-02/run-p1-02.mjs

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repo = resolve(import.meta.dirname, "..", "..");
const piWebRepo = process.env.PI_ORB_PI_WEB ?? "C:\\Users\\JUSTLIKEZYP\\OneDrive\\文档\\daily\\pi-web";
const EXPECTED_HEAD = "95a58744532c7fccaa933aa7757a1419ace67ed2";
const worktree = join(tmpdir(), "pi-orb-p0-head-src");
const runRoot = join("D:\\pi-orb-p1-runs", `p1-02-${Date.now()}`);

const piWebPort = 31293;
const modelPort = 31294;
const debugPort = 31295;
const baseUrl = `http://127.0.0.1:${piWebPort}`;
const password = "p1-02-isolated-test-password";

const agentDir = join(runRoot, "agent");
const sessionDir = join(agentDir, "sessions");
const homeDir = join(runRoot, "home");
const orbWorkspace = join(runRoot, "orb-workspace");
const normalCwd = join(runRoot, "normal-project");
const configPath = join(runRoot, "orb-config.json");
const userDataDir = join(runRoot, "userData");
const serverLogPath = join(runRoot, "pi-web.log");
const extensionPath = join(repo, "pi-package", "extensions", "orb.ts");

for (const path of [agentDir, sessionDir, homeDir, orbWorkspace, normalCwd, userDataDir]) {
  mkdirSync(path, { recursive: true });
}

const piWebHead = execFileSync("git", ["-C", piWebRepo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const safeEnvKeys = [
  "SystemRoot", "SystemDrive", "ComSpec", "Path", "PATHEXT", "TEMP", "TMP",
  "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)",
  "CommonProgramFiles", "CommonProgramW6432", "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "OS", "WINDIR",
];
const cleanEnv = Object.fromEntries(
  safeEnvKeys.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]),
);
Object.assign(cleanEnv, {
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  PI_WEB_NO_OPEN: "1",
  PI_WEB_SKIP_VERSION_CHECK: "1",
  PI_WEB_HOSTNAME: "127.0.0.1",
  PI_WEB_PASSWORD: password,
  PI_CODING_AGENT_DIR: agentDir,
  PI_CODING_AGENT_SESSION_DIR: sessionDir,
  HOME: homeDir,
  USERPROFILE: homeDir,
  PI_ORB_CONFIG: configPath,
  PATH: process.env.PATH,
});

const authHeader = `Basic ${Buffer.from(`pi:${password}`, "utf8").toString("base64")}`;

// ---------------------------------------------------------------------------
// Agent settings + Orb config, written before either process starts so the app
// comes up already configured for its workspace.
// ---------------------------------------------------------------------------
writeFileSync(
  join(agentDir, "settings.json"),
  `${JSON.stringify({
    defaultProvider: "p1-local",
    defaultModel: "p1-model",
    defaultThinkingLevel: "off",
    defaultTools: ["read"],
    sessionDir,
    extensions: [extensionPath],
    enableInstallTelemetry: false,
    enableAnalytics: false,
  }, null, 2)}\n`,
  "utf8",
);
writeFileSync(
  join(agentDir, "models.json"),
  `${JSON.stringify({
    providers: {
      "p1-local": {
        baseUrl: `http://127.0.0.1:${modelPort}/v1`,
        api: "openai-completions",
        apiKey: "p1-isolated-test-key",
        models: [{ id: "p1-model", name: "P1 isolated model", contextWindow: 32768, maxTokens: 256, input: ["text"] }],
      },
    },
  }, null, 2)}\n`,
  "utf8",
);
writeFileSync(
  configPath,
  `${JSON.stringify({
    version: 1,
    orbWorkspace,
    shortcut: "CommandOrControl+Shift+Space",
    window: { alwaysOnTop: true, x: 40, y: 40, width: 460, height: 640 },
  }, null, 2)}\n`,
  "utf8",
);

// ---------------------------------------------------------------------------
// Fake provider. A "SLOW" prompt streams over several seconds so a mid-turn stop
// can be observed; everything else answers immediately.
// ---------------------------------------------------------------------------
const modelRequests = [];
const modelServer = createServer(async (req, res) => {
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
  const messages = JSON.stringify(body.messages ?? []);
  const tools = Array.isArray(body.tools) ? body.tools.map((t) => t?.function?.name ?? t?.name ?? "?") : [];
  // Decide from the LAST user message only. The whole transcript is resent on every
  // turn, so matching the full history would flag an unrelated later turn as slow
  // purely because an earlier slow request is still part of the conversation.
  const lastUserText = (() => {
    if (!Array.isArray(body.messages)) return "";
    for (let index = body.messages.length - 1; index >= 0; index -= 1) {
      const message = body.messages[index];
      if (message?.role !== "user") continue;
      const content = message.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
      }
    }
    return "";
  })();
  const isSlow = lastUserText.includes("SLOW");
  const requestRecord = {
    index: modelRequests.length + 1,
    tools: [...tools].sort(),
    containsOrbModeSection: messages.includes("orb_mode"),
    isSlow,
    lastUserText: lastUserText.slice(0, 120),
    startedAt: Date.now(),
    clientDisconnected: false,
  };
  modelRequests.push(requestRecord);

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const now = Math.floor(Date.now() / 1000);
  const send = (delta, finish) => {
    res.write(
      `data: ${JSON.stringify({
        id: "p1",
        object: "chat.completion.chunk",
        created: now,
        model: "p1-model",
        choices: [{ index: 0, delta, finish_reason: finish ?? null }],
      })}\n\n`,
    );
  };

  if (!isSlow) {
    send({ role: "assistant", content: "p1-" }, null);
    send({ content: "ok" }, "stop");
    res.end("data: [DONE]\n\n");
    return;
  }

  // Slow stream: one token every 700 ms for about 8 seconds.
  const tokens = ["SLOW-", "STREAM-", "PART-1-", "PART-2-", "PART-3-", "PART-4-", "PART-5-", "END"];
  send({ role: "assistant", content: tokens[0] }, null);
  let index = 1;
  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(timer);
      return;
    }
    if (index >= tokens.length) {
      clearInterval(timer);
      send({}, "stop");
      res.end("data: [DONE]\n\n");
      return;
    }
    send({ content: tokens[index] }, null);
    index += 1;
  }, 700);
  req.on("close", () => {
    clearInterval(timer);
    if (!res.writableEnded) {
      // The client (pi-web) hung up mid-stream, which is what an abort looks like
      // from the provider's side.
      requestRecord.clientDisconnected = true;
    }
  });
});

// ---------------------------------------------------------------------------
// pi-web lifecycle
// ---------------------------------------------------------------------------
let server;
let serverLog;

async function startPiWeb() {
  serverLog = existsSync(serverLogPath) ? "" : "";
  server = spawn(
    process.execPath,
    [join(worktree, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(piWebPort), "-H", "127.0.0.1"],
    { cwd: worktree, env: cleanEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  server.stdout.on("data", (chunk) => (serverLog += chunk.toString()));
  server.stderr.on("data", (chunk) => (serverLog += chunk.toString()));
  await waitFor(async () => {
    try {
      return (await fetch(`${baseUrl}/login`)).status < 500;
    } catch {
      return false;
    }
  }, 180000, "pi-web start");
}

async function stopPiWeb() {
  if (!server || server.killed) return;
  try {
    execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    try {
      server.kill();
    } catch {
      // Already gone.
    }
  }
  await sleep(1200);
  server = undefined;
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError}` : ""}`);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function piWebRequest(path, { method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: authHeader,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}

// ---------------------------------------------------------------------------
// CDP plumbing
// ---------------------------------------------------------------------------
async function fetchTargets() {
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

async function evaluate(client, expression) {
  const outcome = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (outcome.exceptionDetails) {
    throw new Error(outcome.exceptionDetails.exception?.description ?? "evaluation failed");
  }
  return outcome.result.value;
}

/**
 * Type into the React-controlled textarea and submit the form.
 *
 * Setting `.value` directly does not notify React, so the value is written through
 * the prototype setter and an `input` event is dispatched.
 */
const TYPE_AND_SUBMIT = (text) => `
(() => {
  const area = document.querySelector('textarea');
  if (!area) return 'no-textarea';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(area, ${JSON.stringify(text)});
  area.dispatchEvent(new Event('input', { bubbles: true }));
  const form = document.querySelector('form');
  if (!form) return 'no-form';
  form.requestSubmit();
  return 'submitted';
})()`;

const BODY_TEXT = "document.body.innerText";

async function status(client) {
  const raw = await evaluate(client, "window.orb.getStatus().then((s) => JSON.stringify(s))");
  return JSON.parse(raw);
}

const result = {
  capturedAt: new Date().toISOString(),
  isolation: {
    piWebRepo,
    runRoot,
    agentDir,
    sessionDir,
    homeDir,
    orbWorkspace,
    normalCwd,
    configPath,
    extensionPath,
    piWebUrl: baseUrl,
    piWebPort,
    modelPort,
    debugPort,
    credentialSource: "isolated test password in the child env only",
    realUserProfileTouched: false,
    screenshots: false,
    desktopInput: false,
    realModel: false,
  },
  checks: [],
  passed: false,
};

function check(name, ok, detail) {
  result.checks.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
}

const electronBinary = join(repo, "node_modules", "electron", "dist", "electron.exe");
let electron;
let electronOut = "";
let electronErr = "";

try {
  if (piWebHead !== EXPECTED_HEAD) {
    throw new Error(`pi-web HEAD is ${piWebHead}, expected ${EXPECTED_HEAD}`);
  }
  if (!existsSync(join(worktree, ".next", "BUILD_ID"))) {
    throw new Error(`pi-web snapshot at ${worktree} is not built; run node evidence/p0-02/run-p0-02.mjs once first`);
  }

  await new Promise((done, fail) => modelServer.listen(modelPort, "127.0.0.1", (e) => (e ? fail(e) : done())));
  await startPiWeb();

  // Electron must keep the real user profile: overriding HOME makes it exit
  // silently (measured in P0-03). It runs no Pi code, so it needs no isolation.
  electron = spawn(
    electronBinary,
    [".", `--user-data-dir=${userDataDir}`, `--remote-debugging-port=${debugPort}`],
    {
      cwd: repo,
      env: {
        ...process.env,
        NODE_ENV: "development",
        PI_ORB_CONFIG: configPath,
        PI_ORB_PI_WEB_URL: baseUrl,
        PI_ORB_PI_WEB_PASSWORD: password,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  electron.stdout.on("data", (chunk) => (electronOut += chunk.toString()));
  electron.stderr.on("data", (chunk) => (electronErr += chunk.toString()));

  let pageTarget = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await sleep(500);
    if (electron.exitCode !== null) break;
    try {
      const targets = await fetchTargets();
      pageTarget = targets.find((target) => target.type === "page") ?? null;
      if (pageTarget) break;
    } catch {
      // Debug endpoint not up yet.
    }
  }
  if (!pageTarget) throw new Error(`no page target; exitCode=${electron.exitCode} stderr=${electronErr.slice(-600)}`);

  const client = await connect(pageTarget.webSocketDebuggerUrl);
  const orbSdk = (expression) => evaluate(client, `window.orb.${expression}`);
  const type = (text) => evaluate(client, TYPE_AND_SUBMIT(text));
  const bodyText = () => evaluate(client, BODY_TEXT);

  // --- A. window and security posture --------------------------------------
  check("electron shell is alive", electron.exitCode === null, `exitCode=${electron.exitCode}`);
  check("orb window exists", pageTarget.title === "pi-orb", pageTarget.title);
  check("preload bridge is exposed", (await evaluate(client, "typeof window.orb")) === "object");
  const sandbox = JSON.parse(
    await evaluate(client, "JSON.stringify({require: typeof require, process: typeof process, module: typeof module, Buffer: typeof Buffer})"),
  );
  check(
    "renderer has no Node access",
    sandbox.require === "undefined" && sandbox.process === "undefined" && sandbox.module === "undefined" && sandbox.Buffer === "undefined",
    JSON.stringify(sandbox),
  );
  const bridgeKeys = JSON.parse(await evaluate(client, "JSON.stringify(Object.keys(window.orb).sort())"));
  check(
    "the bridge surface is a fixed, small set with no generic IPC passthrough",
    !bridgeKeys.includes("ipcRenderer") &&
      !bridgeKeys.includes("invoke") &&
      !bridgeKeys.includes("send") &&
      !bridgeKeys.includes("require") &&
      bridgeKeys.length <= 12,
    JSON.stringify(bridgeKeys),
  );
  const directFetch = await evaluate(
    client,
    `fetch('${baseUrl}/api/agent/running').then((r) => 'HTTP-' + r.status).catch((e) => 'blocked:' + e.name)`,
  );
  check(
    "renderer cannot reach pi-web directly (opaque origin)",
    directFetch !== "HTTP-200",
    String(directFetch),
  );

  // --- B. the shell reports a live, configured run --------------------------
  await sleep(2500); // let the main process finish authenticating
  const initialStatus = await status(client);
  check("workspace is configured and reported", initialStatus.configured === true && initialStatus.workspace !== null, JSON.stringify(initialStatus));
  check("pi-web connection is reported reachable", initialStatus.piWeb.reachable === true, JSON.stringify(initialStatus.piWeb));
  check("status exposes a usable run generation", Number.isInteger(initialStatus.generation) && initialStatus.generation > 0, `generation=${initialStatus.generation}`);
  check("no stale workspace problem is reported", initialStatus.problem === null, String(initialStatus.problem));

  // --- C. send text and observe a streamed reply ---------------------------
  const beforeFirst = modelRequests.length;
  const submitResult = await type("hello from the orb");
  check("the composer accepted the text", submitResult === "submitted", String(submitResult));

  await waitFor(() => modelRequests.length > beforeFirst, 60000, "first provider call");
  const firstRequest = modelRequests.at(-1);
  check("the Orb session ran in Orb mode", firstRequest.containsOrbModeSection === true, JSON.stringify(firstRequest));

  await waitFor(async () => (await bodyText()).includes("p1-ok"), 60000, "streamed assistant reply");
  const afterFirst = await bodyText();
  check("the user message is shown", afterFirst.includes("hello from the orb"), afterFirst.slice(-300));
  check("the assistant reply is shown", afterFirst.includes("p1-ok"), afterFirst.slice(-300));

  const sessionNotice = /Session ([0-9a-f]{8}) ready/.test(afterFirst);
  check("the shell reports the session it is using", sessionNotice, afterFirst.slice(-300));

  // --- D. the same conversation is browsable from pi-web -------------------
  const sessionList = await piWebRequest("/api/sessions");
  const reported = initialStatus.sessionId ?? (await status(client)).sessionId;
  check(
    "the shell reports the session it created",
    typeof reported === "string" && reported.length > 0,
    String(reported),
  );
  const ours = Array.isArray(sessionList.body?.sessions)
    ? sessionList.body.sessions.find((entry) => JSON.stringify(entry).includes(String(reported)))
    : undefined;
  check("pi-web lists the Orb session", sessionList.status === 200 && Boolean(ours), `status=${sessionList.status} matched=${Boolean(ours)}`);

  // Prefer the shell's own report; fall back to the session file name.
  let sessionId = typeof reported === "string" && reported.length > 0 ? reported : null;
  if (!sessionId) {
    const files = readdirSync(sessionDir, { recursive: true }).map(String).filter((entry) => entry.endsWith(".jsonl"));
    const match = /_([0-9a-f-]{36})\.jsonl$/.exec(files[0] ?? "");
    sessionId = match ? match[1] : null;
  }
  check("the Orb session id was resolved", typeof sessionId === "string" && sessionId.length > 0, String(sessionId));

  if (sessionId) {
    const detail = await piWebRequest(`/api/sessions/${encodeURIComponent(sessionId)}`);
    const detailText = JSON.stringify(detail.body ?? "");
    check("pi-web can read the Orb session history", detail.status === 200, `status=${detail.status}`);
    check("the browsed history contains the conversation", detailText.includes("hello from the orb"), detailText.slice(0, 300));
  }

  // --- E. a second client on the same session does not double-send ---------
  const beforeSecond = modelRequests.length;
  if (sessionId) {
    // A browsing client (this process) only reads; the app owns the task.
    const browsing = await piWebRequest(`/api/sessions/${encodeURIComponent(sessionId)}`);
    check("a second client can browse while the app owns the session", browsing.status === 200, `status=${browsing.status}`);
  }
  check("browsing produced no extra model call", modelRequests.length === beforeSecond, `before=${beforeSecond} after=${modelRequests.length}`);

  // --- F. explicit stop of a running turn ----------------------------------
  await type("SLOW please stream for a while");
  await waitFor(() => modelRequests.some((request) => request.isSlow), 60000, "slow provider call");
  await waitFor(async () => (await bodyText()).includes("SLOW-STREAM-"), 30000, "partial slow output");
  const partial = await bodyText();
  check("streamed partial output is visible mid-turn", partial.includes("SLOW-STREAM-"), partial.slice(-300));

  const busyDuringTurn = await status(client);
  check("the shell reports a busy turn", busyDuringTurn.busy === true, `busy=${busyDuringTurn.busy}`);
  check(
    "the shell reports the session id it is bound to",
    typeof busyDuringTurn.sessionId === "string" && busyDuringTurn.sessionId.length > 0,
    `sessionId=${busyDuringTurn.sessionId}`,
  );

  const stopClicked = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Stop');
      if (!button) return 'no-stop-button';
      if (button.disabled) return 'stop-disabled';
      button.click();
      return 'clicked';
    })()`,
  );
  check("the stop control was available during the turn", stopClicked === "clicked", String(stopClicked));

  await waitFor(async () => (await status(client)).busy === false, 30000, "the turn to stop");
  check("the turn stopped and the shell is no longer busy", (await status(client)).busy === false);

  // The user-visible guarantee of an explicit stop: the output stops growing.
  const textAtStop = await bodyText();
  await sleep(3000); // longer than three stream intervals
  const textAfterStop = await bodyText();
  check(
    "streamed output stops growing after the stop",
    textAfterStop === textAtStop,
    `atStop=${JSON.stringify(textAtStop.slice(-80))} afterStop=${JSON.stringify(textAfterStop.slice(-80))}`,
  );
  check(
    "the stopped turn never reached its final token",
    !textAfterStop.includes("PART-5-END"),
    textAfterStop.slice(-120),
  );

  // The probe must discriminate, or the two checks above prove nothing. Exactly one
  // request is the deliberately slow one; the transcript is resent each turn, so a
  // whole-history match would have flagged later turns too.
  check(
    "the slow-stream probe flagged exactly one request",
    modelRequests.filter((request) => request.isSlow).length === 1,
    JSON.stringify(modelRequests.map((request) => ({ index: request.index, isSlow: request.isSlow, lastUserText: request.lastUserText }))),
  );

  // Whether pi-web tears down the in-flight provider request is pi-web's own
  // abort semantics, so it is recorded as an observation instead of being
  // asserted. What is asserted above is what the user observes.
  await waitFor(
    () => modelRequests.some((request) => request.isSlow && request.clientDisconnected),
    10000,
    "provider disconnect",
  ).catch(() => {});
  const slowRequest = modelRequests.find((request) => request.isSlow);
  result.stopPropagation = {
    modelAcceptedRequest: slowRequest !== undefined,
    providerStreamDisconnectedByPiWeb: slowRequest?.clientDisconnected === true,
    note: "pi-web's abort is cooperative: the agent loop stops at the next checkpoint. A false value here means the in-flight provider request was allowed to finish rather than being torn down, which is pi-web behaviour and not a pi-orb guarantee.",
  };

  // The lock must be free again: a later message has to be accepted, not refused.
  const beforeAfterStop = modelRequests.length;
  await type("after the stop");
  await waitFor(() => modelRequests.length > beforeAfterStop, 60000, "provider call after stop");
  check("a new message is accepted after a stop (the task lock was released)", modelRequests.length > beforeAfterStop);

  // --- G. the normal pi-web path still works -------------------------------
  const normal = await piWebRequest("/api/agent/new", { method: "POST", body: { cwd: normalCwd, type: "ensure_session" } });
  check("a normal, non-Orb session can still be created", normal.status === 200 && typeof normal.body?.sessionId === "string", `status=${normal.status}`);
  if (normal.status === 200 && normal.body?.sessionId) {
    const normalPrompt = await piWebRequest(`/api/agent/${encodeURIComponent(normal.body.sessionId)}`, {
      method: "POST",
      body: { type: "prompt", message: "normal prompt" },
    });
    check("a normal session can still prompt", normalPrompt.status === 200, `status=${normalPrompt.status}`);
  }

  // --- H. the shell's own health -------------------------------------------
  check("electron is still alive after the whole flow", electron.exitCode === null, `exitCode=${electron.exitCode}`);
  check("no renderer crash was reported", !/crash/i.test(electronErr), electronErr.slice(-300));

  client.close();
  result.modelRequests = modelRequests;
  result.sessionId = sessionId;
  result.electronStderrTail = electronErr.trim().split(/\r?\n/).slice(-10).join("\n");
} catch (error) {
  check("P1-02 end-to-end verification completed without error", false, error?.message ?? String(error));
  result.electronStderrTail = electronErr.slice(-2000);
  result.piWebLogTail = (serverLog ?? "").slice(-2000);
} finally {
  try {
    electron?.kill();
    await sleep(1200);
    if (electron && electron.exitCode === null) electron.kill("SIGKILL");
  } catch {
    // Best effort.
  }
  try {
    await stopPiWeb();
  } catch {
    // Best effort.
  }
  try {
    modelServer.close();
  } catch {
    // Best effort.
  }
  mkdirSync(join(repo, "evidence", "p1-02"), { recursive: true });
  result.passed = result.checks.length > 0 && result.checks.every((entry) => entry.ok);
  writeFileSync(join(repo, "evidence", "p1-02", "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ passed: result.passed, failed: result.checks.filter((c) => !c.ok) }, null, 2));
}

try {
  rmSync(runRoot, { recursive: true, force: true });
} catch {
  // Electron may still hold a handle on its profile directory.
}

process.exit(result.passed ? 0 : 1);
