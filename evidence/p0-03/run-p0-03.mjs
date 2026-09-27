// P0-03: client API/SSE + native bridge verification.
//
// Answers the P0-03 acceptance items in doc/pi-orb-development-goals.md §5 and the
// seam rules in §4.4:
//   - an Electron-style client (separate process) can authenticate legally, create an
//     independent session, send a message, stream events, reconnect, and stop;
//   - an unauthenticated request, a cross-site request, and a browser-flagged request
//     cannot execute a native operation;
//   - a request bound to an older run generation, or to no task authorization, is
//     refused;
//   - the shell exiting does not kill an already-running pi-web service.
//
// Everything runs against a fixed-HEAD snapshot on a separate loopback port with an
// isolated agent dir and a local fake provider. No real credentials, no desktop
// input, no screenshots, and pi-web's working tree is never modified.

import { readdirSync, createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { connect } from "node:net";
import { createBridgeProbe, runBridgeMatrix, sendBridgeRequest } from "./bridge-probe.mjs";

const repo = resolve(import.meta.dirname, "..", "..");
const piWebRepo = process.env.PI_ORB_P0_PI_WEB ?? "C:\\Users\\JUSTLIKEZYP\\OneDrive\\文档\\daily\\pi-web";
const EXPECTED_HEAD = "95a58744532c7fccaa933aa7757a1419ace67ed2";
const worktree = join(tmpdir(), "pi-orb-p0-head-src");
// Outside the user profile: pi loads `.agents/skills`/instruction files found on
// the working directory's ancestor chain, and %TEMP% sits under C:\Users\<user>.
const runBase = process.env.PI_ORB_P0_RUN_BASE ?? "D:\\pi-orb-p0-runs";
const runRoot = join(runBase, `p0-03-${process.pid}`);
const agentDir = join(runRoot, "agent");
const sessionDir = join(agentDir, "sessions");
const cwd = join(runRoot, "orb");
// Pi loads `HOME/.agents/skills` unconditionally at runtime, regardless of cwd and
// agentDir, so the host user's 16 skills leak into the model prompt unless HOME is
// redirected to an empty isolated directory.
const homeDir = join(runRoot, "home");
const markerDir = join(runRoot, "bridge-markers");
const serverLogPath = join(runRoot, "pi-web.log");
const resultPath = join(repo, "evidence", "p0-03", "result.json");
const port = 31289;
const modelPort = 31290;
const baseUrl = `http://127.0.0.1:${port}`;
const password = "p0-03-isolated-test-password";
const token = "p0-03-bridge-token-9f2a";
const pipeName = `pi-orb-p0-03-${process.pid}`;
const pipePath = `\\\\.\\pipe\\${pipeName}`;

for (const path of [agentDir, sessionDir, cwd, markerDir, homeDir]) mkdirSync(path, { recursive: true });

const piWebHead = execFileSync("git", ["-C", piWebRepo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const safeEnvKeys = [
  "SystemRoot", "SystemDrive", "ComSpec", "Path", "PATHEXT", "TEMP", "TMP",
  "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "ProgramData",
  "ProgramFiles", "ProgramFiles(x86)", "CommonProgramFiles", "CommonProgramW6432",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "OS", "WINDIR",
];
const cleanEnv = Object.fromEntries(safeEnvKeys.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
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
  PATH: process.env.PATH,
});

const authHeader = `Basic ${Buffer.from(`pi:${password}`, "utf8").toString("base64")}`;
const bridgeLog = [];

// ---------------------------------------------------------------------------
// Local fake provider: proves the client drives a real provider call without any
// outside network or credential.
// ---------------------------------------------------------------------------
let modelRequestCount = 0;
const modelServer = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: "p0-model", object: "model", owned_by: "p0-test" }] }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    res.writeHead(404); res.end(); return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  modelRequestCount += 1;
  res.writeHead(200, { "content-type": body.stream ? "text/event-stream" : "application/json", "cache-control": "no-cache" });
  const now = Math.floor(Date.now() / 1000);
  if (!body.stream) {
    res.end(JSON.stringify({ id: "p0", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "p0-ok" }, finish_reason: "stop" }] }));
    return;
  }
  // Two deltas so the client can observe streaming rather than a single blob.
  res.write(`data: ${JSON.stringify({ id: "p0", object: "chat.completion.chunk", created: now, model: "p0-model", choices: [{ index: 0, delta: { role: "assistant", content: "p0-" }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ id: "p0", object: "chat.completion.chunk", created: now, model: "p0-model", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] })}\n\n`);
  res.end("data: [DONE]\n\n");
});

function writeSettings() {
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
    defaultProvider: "p0-local",
    defaultModel: "p0-model",
    defaultThinkingLevel: "off",
    defaultTools: ["read"],
    sessionDir,
    enableInstallTelemetry: false,
    enableAnalytics: false,
  }, null, 2) + "\n", "utf8");
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({
    providers: {
      "p0-local": {
        baseUrl: `http://127.0.0.1:${modelPort}/v1`,
        api: "openai-completions",
        apiKey: "p0-isolated-test-key",
        models: [{ id: "p0-model", name: "P0 isolated model", contextWindow: 32768, maxTokens: 256, input: ["text"] }],
      },
    },
  }, null, 2) + "\n", "utf8");
}

/** Fixed-HEAD snapshot (git archive + npm ci + next build), reused across P0 runs. */
function prepareSourceSnapshot() {
  if (piWebHead !== EXPECTED_HEAD) {
    throw new Error(`pi-web HEAD is ${piWebHead}, expected ${EXPECTED_HEAD}; refusing to test an unverified revision`);
  }
  const alreadyPrepared = existsSync(join(worktree, "node_modules", "@next", "env", "package.json"))
    && existsSync(join(worktree, "next.config.ts"));
  if (!alreadyPrepared) {
    rmSync(worktree, { recursive: true, force: true });
    mkdirSync(worktree, { recursive: true });
    const archive = execFileSync("git", ["-C", piWebRepo, "archive", "--format=tar", EXPECTED_HEAD], { maxBuffer: 512 * 1024 * 1024 });
    execFileSync("tar", ["-x", "-f", "-", "-C", worktree], { input: archive, maxBuffer: 512 * 1024 * 1024 });
    execFileSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: worktree, stdio: "inherit", shell: true });
  }
  if (!existsSync(join(worktree, ".next", "BUILD_ID"))) {
    execFileSync("npm", ["run", "build"], {
      cwd: worktree, stdio: "inherit", shell: true,
      env: { ...cleanEnv, NODE_OPTIONS: "--max-old-space-size=12288" },
    });
  }
  const status = execFileSync("git", ["-C", piWebRepo, "status", "--porcelain"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
  return { sourceSnapshot: worktree, sourceHead: EXPECTED_HEAD, piWebWorkingTreeChanges: status, reusedSnapshot: alreadyPrepared };
}

let server;
let serverOutput;
async function startPiWeb() {
  serverOutput = createWriteStream(serverLogPath, { flags: "a" });
  server = spawn(process.execPath, [join(worktree, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: worktree, env: cleanEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  server.stdout.on("data", (chunk) => serverOutput.write(chunk));
  server.stderr.on("data", (chunk) => serverOutput.write(chunk));
  await waitFor(async () => { try { return (await fetch(`${baseUrl}/login`)).status < 500; } catch { return false; } }, 120000, "pi-web start");
}
async function stopPiWeb() {
  if (!server || server.killed) return;
  try { execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { try { server.kill(); } catch {} }
  await new Promise((r) => setTimeout(r, 1000));
  serverOutput?.end();
  server = undefined;
}
function isServiceAlive() {
  try { return Boolean(server) && !server.killed && server.exitCode === null; } catch { return false; }
}
async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch (error) { lastError = error; }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError}` : ""}`);
}

/**
 * Send a request with a literal Host header. `fetch`/undici always writes the
 * real authority, so a raw socket is the only way to exercise host validation.
 */
function rawHttpRequest({ path, method = "GET", headers = {}, body = "" }) {
  return new Promise((resolvePromise, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      const lines = [`${method} ${path} HTTP/1.1`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), "Connection: close", "", body];
      socket.write(lines.join("\r\n"));
    });
    let data = "";
    socket.on("data", (chunk) => { data += chunk.toString("utf8"); });
    socket.on("end", () => {
      const statusLine = data.split("\r\n", 1)[0] ?? "";
      const match = /HTTP\/1\.[01] (\d{3})/.exec(statusLine);
      resolvePromise({ status: match ? Number(match[1]) : 0, raw: data.slice(0, 400) });
    });
    socket.on("error", reject);
  });
}

/** Raw call with explicit headers so denials can be asserted precisely. */
async function raw(path, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, setCookie: res.headers.get("set-cookie") };
}
async function authed(path, options = {}) {
  return raw(path, { ...options, headers: { authorization: authHeader, ...(options.headers ?? {}) } });
}

const evidence = {
  capturedAt: new Date().toISOString(),
  isolation: {
    piWebRepo, agentDir, sessionDir, cwd, baseUrl, port, modelPort, pipeName,
    runBaseOutsideUserProfile: true,
    credentialSource: "isolated test password in child env only; user's real auth.json and ~/.pi/agent are not passed",
    screenshots: false, desktopInput: false, realModel: false,
  },
  authentication: {}, shellClient: {}, generation: {}, bridge: {}, ownership: {}, assertions: [],
};

try {
  Object.assign(evidence.isolation, prepareSourceSnapshot());
  writeSettings();
  await new Promise((r, j) => modelServer.listen(modelPort, "127.0.0.1", (e) => e ? j(e) : r()));
  await startPiWeb();

  // --- A. unauthenticated / cross-site / browser-flagged access -----------------
  const unauth = await raw("/api/agent/new", { method: "POST", body: { cwd, type: "ensure_session" } });
  const crossSite = await raw("/api/agent/running", { headers: { origin: "http://evil.example", "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" } });
  const badHost = await rawHttpRequest({ path: "/api/agent/running", headers: { Host: "attacker.example" } });
  evidence.authentication.denials = {
    unauthenticatedApi: unauth.status,
    crossSiteGet: crossSite.status,
    foreignHostHeader: badHost.status,
    foreignHostEvidence: badHost.raw.split("\r\n")[0],
  };

  // --- B. cookie login flow -----------------------------------------------------
  const login = await raw("/api/web-auth", { method: "POST", body: { password } });
  const cookie = login.setCookie?.split(";")[0] ?? "";
  const cookieAuthed = await raw("/api/agent/running", { headers: { cookie } });
  evidence.authentication.cookieFlow = { loginStatus: login.status, cookieIssued: Boolean(cookie), authenticatedRequestStatus: cookieAuthed.status };

  // --- C. separate client process: create, prompt, stream, stop ------------------
  const shell = execFileSync(process.execPath, [join(repo, "evidence", "p0-03", "shell-sim.mjs")], {
    encoding: "utf8",
    env: { ...cleanEnv, PI_WEB_URL: baseUrl, PI_WEB_PASSWORD: password, PI_ORB_P0_CWD: cwd },
    timeout: 120000,
  });
  const shellReport = JSON.parse(shell.trim().split(/\r?\n/).at(-1));
  evidence.shellClient = shellReport;
  const sessionId = shellReport.sessionId;
  const serviceAliveAfterShellExit = isServiceAlive();
  const sessionAfterShellExit = await authed(`/api/agent/${encodeURIComponent(sessionId)}`);
  const sessionDetail = await authed(`/api/sessions/${encodeURIComponent(sessionId)}`);
  const promptLeakCheck = JSON.stringify(sessionDetail.body ?? "");
  evidence.isolation.userProfileSkillLeakInSession =
    promptLeakCheck.includes(".agents\\skills") || promptLeakCheck.includes(".agents/skills") || promptLeakCheck.includes("JUSTLIKEZYP");
  evidence.isolation.homeDir = homeDir;

  // --- D. per-run generation is bound to the request, not inherited -------------
  // Two live wrappers for the same session id would mean two runtimes writing one
  // session file (N5). A reload must replace the runtime rather than double it, and
  // two browsing clients must observe the SAME session id.
  const beforeReload = await authed(`/api/sessions/${encodeURIComponent(sessionId)}`);
  await authed(`/api/agent/${encodeURIComponent(sessionId)}`, { method: "POST", body: { type: "reload" } });
  const afterReload = await authed(`/api/sessions/${encodeURIComponent(sessionId)}`);
  const secondClient = await authed(`/api/sessions/${encodeURIComponent(sessionId)}`);
  evidence.generation = {
    sessionIdFromSessionsApi: afterReload.body?.sessionId ?? null,
    sessionIdStableAcrossReload: afterReload.body?.sessionId === sessionId,
    twoBrowsingClientsSeeSameSession: secondClient.body?.sessionId === afterReload.body?.sessionId,
    revisionBefore: beforeReload.body?.snapshotRevision ?? null,
    revisionAfter: afterReload.body?.snapshotRevision ?? null,
    note: "snapshotRevision is an opaque cache-freshness token (lib/session-revision.ts), NOT a permission or run-generation check; per-task authorization is enforced by the bridge/executor layer and verified in section E",
  };

  // --- E. native bridge ---------------------------------------------------------
  const bridge = createBridgeProbe({ pipePath, token, markerDir, log: (entry) => bridgeLog.push(entry) });
  await bridge.listen();
  const generation0 = bridge.registerSession(sessionId);
  const authorizedBeforeGenerationBump = await sendBridgeRequest(pipePath, { token, sessionId, generation: generation0, action: "no-auth" });
  const grant = bridge.authorizeTask(sessionId, generation0);
  const matrix = await runBridgeMatrix({ pipePath, token, markerDir, sessionId });
  const generation1 = bridge.bumpGeneration(sessionId);
  const staleGeneration = await sendBridgeRequest(pipePath, { token, sessionId, generation: generation0, action: "observe" });
  const afterBumpNoAuth = await sendBridgeRequest(pipePath, { token, sessionId, generation: generation1, action: "observe" });
  bridge.authorizeTask(sessionId, generation1);
  const currentGenerationAuthorized = await sendBridgeRequest(pipePath, { token, sessionId, generation: generation1, action: "observe" });
  // Disconnect/reload must drop task authorization.
  bridge.revokeAll();
  const afterRevoke = await sendBridgeRequest(pipePath, { token, sessionId, generation: generation1, action: "observe" });
  const markers = existsSync(markerDir) ? readdirSync(markerDir) : [];
  evidence.bridge = {
    transport: "Windows named pipe (no TCP listener, unreachable from a browser page)",
    taskAuthorizedBeforeGrant: { reason: authorizedBeforeGenerationBump.reason, executed: authorizedBeforeGenerationBump.executed },
    grantAccepted: grant,
    denialMatrix: matrix.results,
    generationBefore: generation0,
    generationAfter: generation1,
    staleGeneration: { reason: staleGeneration.reason, executed: staleGeneration.executed },
    freshGenerationWithoutAuthorization: { reason: afterBumpNoAuth.reason, executed: afterBumpNoAuth.executed },
    freshGenerationWithAuthorization: { reason: currentGenerationAuthorized.reason, executed: currentGenerationAuthorized.executed },
    afterRevoke: { reason: afterRevoke.reason, executed: afterRevoke.executed },
    executedCount: matrix.results.filter((r) => r.executed).length + (currentGenerationAuthorized.executed ? 1 : 0),
    refusedCount: matrix.results.filter((r) => !r.executed).length + [staleGeneration, afterBumpNoAuth, afterRevoke].filter((r) => !r.executed).length,
    requestLog: bridgeLog,
    markersWritten: markers.length,
  };
  await bridge.close();

  // --- F. wrong password last: it trips the shared auth throttle ----------------
  const wrongPassword = await raw("/api/agent/running", { headers: { authorization: `Basic ${Buffer.from("pi:wrong-password", "utf8").toString("base64")}` } });
  evidence.authentication.wrongPassword = { status: wrongPassword.status, note: "requested last because Basic failures share one global backoff; it does not touch pi-web's own configuration" };

  // --- Assertions --------------------------------------------------------------
  const sseTypes = shellReport.sse?.eventTypes ?? [];
  evidence.assertions = [
    ["unauthenticated API request refused", unauth.status === 401],
    ["cross-site request refused", crossSite.status === 403],
    ["foreign Host header refused", badHost.status === 403],
    ["cookie login issues a session cookie", login.status === 200 && Boolean(cookie)],
    ["cookie session authenticates a later request", cookieAuthed.status === 200],
    ["no user-profile skill leak in session", evidence.isolation.userProfileSkillLeakInSession === false],
    ["separate client process created a session", Boolean(sessionId)],
    ["client triggered a real provider call", modelRequestCount > 0],
    ["SSE delivered a connected event", sseTypes.includes("connected")],
    ["client streamed a run to completion", sseTypes.includes("message_end")],
    ["client reconnected without disturbing the session", shellReport.reconnect?.connected === true],
    ["client stopped the run via abort", shellReport.steps?.some((step) => step.step === "abort" && step.status === 200) === true],
    ["shell exit did not kill the running service", serviceAliveAfterShellExit && serverAlive()],
    ["session still reachable after shell exit", sessionAfterShellExit.status === 200],
    ["session id is stable across reload", evidence.generation.sessionIdStableAcrossReload === true],
    ["two browsing clients see one session", evidence.generation.twoBrowsingClientsSeeSameSession === true],
    ["bridge refuses a task without authorization", authorizedBeforeGenerationBump.executed === false && authorizedBeforeGenerationBump.reason === "no-task-authorization"],
    ["bridge refuses a missing token", matrix.results.some((r) => r.name === "missing token" && r.reason === "bad-token" && !r.executed)],
    ["bridge refuses a wrong token", matrix.results.some((r) => r.name === "wrong token" && !r.executed)],
    ["bridge refuses an unknown session", matrix.results.some((r) => r.name === "unknown session" && r.reason === "unknown-session" && !r.executed)],
    ["bridge refuses a browser-originated request", matrix.results.some((r) => r.name === "browser-originated request" && r.reason === "browser-originated-request" && !r.executed)],
    ["bridge refuses a stale run generation", staleGeneration.executed === false && staleGeneration.reason === "stale-generation"],
    ["generation bump clears task authorization", afterBumpNoAuth.executed === false && afterBumpNoAuth.reason === "no-task-authorization"],
    ["bridge executes a fully authorized request", currentGenerationAuthorized.executed === true],
    ["revoking authorization stops execution", afterRevoke.executed === false],
    ["only authorized requests wrote markers", markers.length === 2],
    ["wrong password refused", wrongPassword.status === 401],
  ].map(([name, passed]) => ({ name, passed: Boolean(passed) }));
  evidence.passed = evidence.assertions.every((assertion) => assertion.passed);
} catch (error) {
  evidence.error = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
  evidence.passed = false;
} finally {
  try { await stopPiWeb(); } catch {}
  try { modelServer.close(); } catch {}
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ resultPath, passed: evidence.passed, assertions: evidence.assertions, error: evidence.error, serverLogPath }, null, 2));
}

function serverAlive() { return isServiceAlive(); }

if (!evidence.passed) process.exitCode = 1;
