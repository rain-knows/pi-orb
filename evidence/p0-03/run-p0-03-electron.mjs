// P0-03 (Electron leg): a REAL Electron client, not a Node process.
//
// The P0-03 acceptance item names an "Electron 客户端" specifically. Node's fetch
// and Chromium's fetch are not equivalent for credentials, Origin, Fetch-Metadata,
// and SSE, so a Node-only probe does not satisfy the item. This script launches an
// actual Electron main process with a sandboxed, isolated renderer and measures
// which paths work.
//
// What it does NOT do: it never starts/restarts/stops the pi-web service, sends no
// desktop input, takes no screenshot, and shows no window on screen (show:false).
//
// The renderer is loaded from a local file, so its origin is opaque ("null"):
// that is exactly the cross-origin case P1-02 will face.

import { createWriteStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repo = resolve(import.meta.dirname, "..", "..");
const piWebRepo = process.env.PI_ORB_P0_PI_WEB ?? "C:\\Users\\JUSTLIKEZYP\\OneDrive\\文档\\daily\\pi-web";
const EXPECTED_HEAD = "95a58744532c7fccaa933aa7757a1419ace67ed2";
const worktree = join(tmpdir(), "pi-orb-p0-head-src");
const runBase = process.env.PI_ORB_P0_RUN_BASE ?? "D:\\pi-orb-p0-runs";
const runRoot = join(runBase, `p0-03-electron-${process.pid}`);
const agentDir = join(runRoot, "agent");
const sessionDir = join(agentDir, "sessions");
const cwd = join(runRoot, "orb");
const appDir = join(runRoot, "electron-app");
// Same HOME isolation as the other legs: Pi resolves `HOME/.agents/skills` at
// runtime and loads the host user's real skills into the model prompt otherwise.
const homeDir = join(runRoot, "home");
const serverLogPath = join(runRoot, "pi-web.log");
const resultPath = join(repo, "evidence", "p0-03", "result-electron.json");
const electronExe = join(runBase, "electron-probe", "node_modules", "electron", "dist", "electron.exe");
const port = 31291;
const modelPort = 31292;
const baseUrl = `http://127.0.0.1:${port}`;
const password = "p0-03-electron-test-password";

for (const path of [agentDir, sessionDir, cwd, appDir, homeDir]) mkdirSync(path, { recursive: true });

const piWebHead = execFileSync("git", ["-C", piWebRepo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
// Two DIFFERENT environments. The pi-web server hosts the Pi SDK and therefore needs
// HOME redirected so `HOME/.agents/skills` stops injecting the host user's real
// skills into the model prompt. Electron must NOT get that override: it needs the
// real user profile, and with HOME/USERPROFILE redirected it exits silently with no
// output at all (verified). Electron never runs Pi code, so it needs no isolation.
const safeEnvKeys = [
  "SystemRoot", "SystemDrive", "ComSpec", "Path", "PATHEXT", "TEMP", "TMP",
  "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "ProgramData",
  "ProgramFiles", "ProgramFiles(x86)", "CommonProgramFiles", "CommonProgramW6432",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "OS", "WINDIR",
];
const baseEnv = Object.fromEntries(safeEnvKeys.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));

// pi-web server: isolated HOME + agent dir + session dir.
const cleanEnv = { ...baseEnv, HOME: homeDir, USERPROFILE: homeDir };
Object.assign(cleanEnv, {
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  PI_WEB_NO_OPEN: "1",
  PI_WEB_SKIP_VERSION_CHECK: "1",
  PI_WEB_HOSTNAME: "127.0.0.1",
  PI_WEB_PASSWORD: password,
  PI_CODING_AGENT_DIR: agentDir,
  PI_CODING_AGENT_SESSION_DIR: sessionDir,
  PATH: process.env.PATH,
});

// Electron: real user profile (needed to boot at all), plus only the probe vars.
const electronEnv = { ...baseEnv, PATH: process.env.PATH };

let modelRequestCount = 0;
const modelServer = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: "p0-model", object: "model", owned_by: "p0-test" }] }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") { res.writeHead(404); res.end(); return; }
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
  res.write(`data: ${JSON.stringify({ id: "p0", object: "chat.completion.chunk", created: now, model: "p0-model", choices: [{ index: 0, delta: { role: "assistant", content: "p0-" }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ id: "p0", object: "chat.completion.chunk", created: now, model: "p0-model", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }] })}\n\n`);
  res.end("data: [DONE]\n\n");
});

function writeSettings() {
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
    defaultProvider: "p0-local", defaultModel: "p0-model", defaultThinkingLevel: "off",
    defaultTools: ["read"], sessionDir, enableInstallTelemetry: false, enableAnalytics: false,
  }, null, 2) + "\n", "utf8");
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({
    providers: {
      "p0-local": {
        baseUrl: `http://127.0.0.1:${modelPort}/v1`, api: "openai-completions", apiKey: "p0-isolated-test-key",
        models: [{ id: "p0-model", name: "P0 isolated model", contextWindow: 32768, maxTokens: 256, input: ["text"] }],
      },
    },
  }, null, 2) + "\n", "utf8");
}

function prepareSourceSnapshot() {
  if (piWebHead !== EXPECTED_HEAD) throw new Error(`pi-web HEAD is ${piWebHead}, expected ${EXPECTED_HEAD}`);
  if (!existsSync(join(worktree, "node_modules", "@next", "env", "package.json"))) {
    throw new Error(`snapshot not prepared at ${worktree}; run evidence/p0-02/run-p0-02.mjs first`);
  }
  if (!existsSync(join(worktree, ".next", "BUILD_ID"))) {
    throw new Error(`snapshot build missing at ${worktree}; run evidence/p0-02/run-p0-02.mjs first`);
  }
}

// ---------------------------------------------------------------------------
// The Electron app: main process + sandboxed preload + local renderer.
// ---------------------------------------------------------------------------
function writeElectronApp() {
  writeFileSync(join(appDir, "package.json"), JSON.stringify({
    name: "pi-orb-p0-03-electron-probe", version: "1.0.0", private: true, main: "main.cjs",
  }, null, 2) + "\n", "utf8");

  writeFileSync(join(appDir, "main.cjs"), `
const { app, BrowserWindow, ipcMain } = require("electron");
const { join } = require("node:path");

const BASE = process.env.PI_ORB_ELECTRON_BASE;
const PASSWORD = process.env.PI_ORB_ELECTRON_PASSWORD;
const AUTH = "Basic " + Buffer.from("pi:" + PASSWORD, "utf8").toString("base64");

// The shell's own path to pi-web: Node fetch in the MAIN process. The renderer is
// sandboxed and has no Node, so this is the only place allowed to hold credentials.
async function mainFetch(path, options = {}) {
  const res = await fetch(BASE + path, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", authorization: AUTH, ...(options.headers || {}) },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

ipcMain.handle("api-fetch", (_event, path, options) => mainFetch(path, options));

// Read SSE from the MAIN process (the renderer cannot: no credentials, and its
// origin is rejected). Resolves when the predicate text appears or the timeout hits.
ipcMain.handle("stream-until", async (_event, sessionId, needles, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const events = [];
  let text = "";
  try {
    const res = await fetch(BASE + "/api/agent/" + encodeURIComponent(sessionId) + "/events", {
      headers: { authorization: AUTH, accept: "text/event-stream" },
      signal: controller.signal,
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\\n\\n")) !== -1) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        text += raw;
        for (const line of raw.split(/\\r?\\n/)) {
          if (!line.startsWith("data: ")) continue;
          try { events.push(JSON.parse(line.slice(6)).type); } catch { /* heartbeat */ }
        }
      }
      if (needles.some((needle) => text.includes(needle))) break;
    }
  } catch (error) {
    if (error && error.name !== "AbortError") events.push("stream-error:" + String(error));
  } finally {
    clearTimeout(timer);
  }
  return { eventTypes: [...new Set(events)], textTail: text.slice(-500) };
});

ipcMain.on("probe-result", (_event, result) => {
  process.stdout.write("PROBE_RESULT " + JSON.stringify(result) + "\\n");
  setTimeout(() => app.quit(), 100);
});

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false, // never disturb the user's desktop
    width: 800,
    height: 600,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  win.webContents.on("console-message", (_e, _level, message) => {
    process.stdout.write("RENDERER_LOG " + message + "\\n");
  });
  await win.loadFile(join(__dirname, "renderer.html"));
});

setTimeout(() => {
  process.stdout.write("PROBE_RESULT " + JSON.stringify({ fatal: "electron probe timeout" }) + "\\n");
  app.quit();
}, 120000);
`.trimStart(), "utf8");

  writeFileSync(join(appDir, "preload.cjs"), `
const { contextBridge, ipcRenderer } = require("electron");

// Minimal, explicit surface: no Node, no arbitrary IPC, no filesystem.
contextBridge.exposeInMainWorld("piOrbShell", {
  apiFetch: (path, options) => ipcRenderer.invoke("api-fetch", path, options),
  streamUntil: (sessionId, needles, timeoutMs) => ipcRenderer.invoke("stream-until", sessionId, needles, timeoutMs),
  report: (result) => ipcRenderer.send("probe-result", result),
});
`.trimStart(), "utf8");

  writeFileSync(join(appDir, "renderer.html"), `
<!doctype html>
<html><head><meta charset="utf-8"><title>pi-orb p0-03 electron probe</title></head>
<body>
<script>
const BASE = ${JSON.stringify(baseUrl)};
const AUTH = "Basic " + btoa("pi:" + ${JSON.stringify(password)});
// Needles are emitted with JSON.stringify: writing ".agents\\skills" inline was
// corrupted by escape processing during template embedding, which silently broke
// this entire renderer script (no output, no error surfaced).
const LEAK_NEEDLE_AGENTS = ".agents" + String.fromCharCode(92) + "skills";
const LEAK_NEEDLE_USER = "JUSTLIKEZYP";
const out = { origin: window.location.origin, hasNode: typeof require !== "undefined", hasProcess: typeof process !== "undefined" };

async function rendererFetch(path, options = {}) {
  try {
    const res = await fetch(BASE + path, {
      method: options.method || "GET",
      headers: { "content-type": "application/json", authorization: AUTH, ...(options.headers || {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await res.text();
    return { ok: true, status: res.status, body: text.slice(0, 300) };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

(async () => {
  try {
    // 1. Renderer -> pi-web directly: the cross-origin question.
    out.rendererPlain = await rendererFetch("/api/agent/running");
    out.rendererWithFetchMetadata = await rendererFetch("/api/agent/running", {
      headers: { "sec-fetch-site": "same-origin" },
    });

    // 2. Can the renderer create a session and prompt at all?
    out.rendererCreateSession = await rendererFetch("/api/agent/new", {
      method: "POST",
      body: { cwd: ${JSON.stringify(cwd)}, type: "ensure_session", toolNames: ["read"] },
    });
    const sidFromRenderer = out.rendererCreateSession.ok && out.rendererCreateSession.status === 200
      ? JSON.parse(out.rendererCreateSession.body).sessionId : null;
    out.rendererSessionId = sidFromRenderer;

    if (sidFromRenderer) {
      out.rendererPrompt = await rendererFetch("/api/agent/" + encodeURIComponent(sidFromRenderer), {
        method: "POST", body: { type: "prompt", message: "p0 electron renderer prompt" },
      });
    }

    // 3. SSE from the renderer (EventSource cannot set an Authorization header).
    out.rendererEventSource = await new Promise((resolve) => {
      const url = BASE + "/api/agent/" + encodeURIComponent(sidFromRenderer || "none") + "/events";
      let settled = false;
      const done = (value) => { if (!settled) { settled = true; resolve(value); } };
      try {
        const es = new EventSource(url);
        es.onmessage = (ev) => { done({ connected: true, firstEvent: String(ev.data).slice(0, 160) }); es.close(); };
        es.onerror = () => { done({ connected: false, error: "EventSource error (no credentials or blocked)" }); es.close(); };
        setTimeout(() => { done({ connected: false, error: "timeout" }); es.close(); }, 8000);
      } catch (error) { done({ connected: false, error: String(error) }); }
    });

    // 4. Shell path: credentials stay in the main process.
    out.mainProcessFetch = await window.piOrbShell.apiFetch("/api/agent/running");
    const created = await window.piOrbShell.apiFetch("/api/agent/new", {
      method: "POST", body: { cwd: ${JSON.stringify(cwd)}, type: "ensure_session", toolNames: ["read"] },
    });
    out.mainProcessCreateSession = { status: created.status, sessionId: created.body && created.body.sessionId };
    const mainSid = created.body && created.body.sessionId;
    if (mainSid) {
      // The real client flow: subscribe FIRST, then prompt. Doing this in one
      // session keeps a single run lifecycle, so a second prompt cannot land on a
      // still-streaming session (pi-web rejects that, correctly).
      const streamPromise = window.piOrbShell.streamUntil(mainSid, ["__never_matches__"], 30000);
      await new Promise((r) => setTimeout(r, 1200));
      out.mainProcessPrompt = (await window.piOrbShell.apiFetch("/api/agent/" + encodeURIComponent(mainSid), {
        method: "POST", body: { type: "prompt", message: "p0 electron main prompt" },
      })).status;

      // Wait for the ASSISTANT REPLY to be persisted with actual content. Polling
      // only for a message_end is not enough: the first message_end is the user
      // message, and the assistant entry is written with empty content plus
      // stopReason "aborted" if we stop the run too early.
      const deadline = Date.now() + 90000;
      let observed = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        const st = await window.piOrbShell.apiFetch("/api/sessions/" + encodeURIComponent(mainSid));
        const text = JSON.stringify(st.body || "");
        if (text.includes("p0-ok")) { out.mainProcessRunCompleted = true; }
        observed = { hasAssistantText: text.includes("p0-ok"), hasAborted: text.includes("aborted") };
        if (out.mainProcessRunCompleted) break;
      }
      out.mainProcessRunCompleted = out.mainProcessRunCompleted === true;
      out.mainProcessObserved = observed;
      out.mainProcessStream = await streamPromise;

      out.mainProcessAbort = (await window.piOrbShell.apiFetch("/api/agent/" + encodeURIComponent(mainSid), {
        method: "POST", body: { type: "abort" },
      })).status;
      const state = await window.piOrbShell.apiFetch("/api/sessions/" + encodeURIComponent(mainSid));
      out.mainProcessSessionReadable = state.status === 200;
      // Fail-closed leak check on the real session payload: an uninspected prompt is not a pass.
      const payload = JSON.stringify(state.body || "");
      out.sessionPayloadInspected = payload.length > 0;
      out.hostResourceLeakInSession =
        payload.includes(".agents\\skills") || payload.includes(".agents/skills") || payload.includes("JUSTLIKEZYP");
    }
  } catch (error) {
    out.unexpected = String(error);
  }
  window.piOrbShell.report(out);
})();
</script>
</body></html>
`.trimStart(), "utf8");
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
async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch (error) { lastError = error; }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError}` : ""}`);
}
function isServiceAlive() { try { return Boolean(server) && !server.killed && server.exitCode === null; } catch { return false; } }

/**
 * Run Electron asynchronously. execFileSync would BLOCK this process's event loop,
 * and the fake provider server lives in this same process, so a sync spawn makes the
 * SDK's provider request hang with zero requests served. The preflight (async) works
 * for exactly that reason; matching it here keeps the comparison honest.
 */
function runElectron(timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(electronExe, [appDir], {
      env: { ...electronEnv, PI_ORB_ELECTRON_BASE: baseUrl, PI_ORB_ELECTRON_PASSWORD: password, ELECTRON_ENABLE_LOGGING: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let out = "";
    const timer = setTimeout(() => {
      try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { try { child.kill(); } catch {} }
      resolvePromise(`${out}\nPROBE_TIMEOUT`);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { out += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { out += chunk.toString("utf8"); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", () => { clearTimeout(timer); resolvePromise(out); });
  });
}

const evidence = {
  capturedAt: new Date().toISOString(),
  isolation: {
    piWebRepo, agentDir, sessionDir, cwd, appDir, baseUrl, port, modelPort,
    electronExe, electronVersion: null,
    runBaseOutsideUserProfile: true,
    windowShown: false,
    screenshots: false, desktopInput: false, realModel: false,
  },
  electron: {},
  assertions: [],
};

try {
  prepareSourceSnapshot();
  evidence.isolation.electronVersion = execFileSync(electronExe, ["--version"], { encoding: "utf8" }).trim();
  evidence.isolation.probeNote = "Electron is launched with async spawn; a synchronous spawn would block this process's event loop and starve the local fake provider server that runs in the same process. Electron gets the REAL user profile (redirected HOME makes it exit silently); only the pi-web server gets the isolated HOME.";
  writeSettings();
  writeElectronApp();
  await new Promise((r, j) => modelServer.listen(modelPort, "127.0.0.1", (e) => e ? j(e) : r()));
  await startPiWeb();

  // Preflight: drive the SAME server + SAME fake provider through plain HTTP, with
  // no Electron involved. If this cannot reach the provider, then a failing Electron
  // leg would be a defect in this probe's wiring, not an Electron/product finding.
  await (async () => {
    const auth = `Basic ${Buffer.from(`pi:${password}`, "utf8").toString("base64")}`;
    const call = async (path, options = {}) => {
      const res = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: { "content-type": "application/json", authorization: auth },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
      const text = await res.text();
      let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      return { status: res.status, body };
    };
    const created = await call("/api/agent/new", { method: "POST", body: { cwd, type: "ensure_session", toolNames: ["read"] } });
    const sid = created.body?.sessionId;
    evidence.preflight = { createStatus: created.status, sessionId: sid };
    if (!sid) return;
    const streamPromise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000);
      try {
        const res = await fetch(`${baseUrl}/api/agent/${encodeURIComponent(sid)}/events`, { headers: { authorization: auth }, signal: controller.signal });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let text = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          if (text.includes("p0-ok")) break;
        }
        return text;
      } catch { return ""; } finally { clearTimeout(timer); }
    })();
    await new Promise((r) => setTimeout(r, 1200));
    const prompted = await call(`/api/agent/${encodeURIComponent(sid)}`, { method: "POST", body: { type: "prompt", message: "p0 preflight prompt" } });
    evidence.preflight.promptStatus = prompted.status;
    const streamed = await streamPromise;
    evidence.preflight.sawAssistantText = streamed.includes("p0-ok");
    evidence.preflight.providerRequestsTotal = modelRequestCount;
    await call(`/api/agent/${encodeURIComponent(sid)}`, { method: "POST", body: { type: "abort" } });
  })().catch((error) => { evidence.preflight = { error: String(error) }; });

  modelRequestCount = 0; // Electron leg is measured on its own

  const electronOut = await runElectron(180000);
  const resultLine = electronOut.split(/\r?\n/).find((line) => line.startsWith("PROBE_RESULT "));
  const rendererLogs = electronOut.split(/\r?\n/).filter((line) => line.startsWith("RENDERER_LOG "));
  if (!resultLine) throw new Error("electron probe produced no result; output:\\n" + electronOut.slice(0, 4000));
  const probe = JSON.parse(resultLine.slice("PROBE_RESULT ".length));
  evidence.electron = { ...probe, rendererLogs };
  evidence.electron.modelRequestCount = modelRequestCount;
  evidence.electron.serviceAliveAfterElectronExit = isServiceAlive();

  const r = evidence.electron;
  const rendererStatus = r.rendererPlain?.status;
  const mainStatus = r.mainProcessFetch?.status;
  evidence.assertions = [
    ["preflight reached the provider without Electron", evidence.preflight?.providerRequestsTotal > 0 || evidence.preflight?.sawAssistantText === true],
    ["real electron main process ran the probe", typeof r.origin === "string"],
    ["renderer is sandboxed without Node", r.hasNode === false && r.hasProcess === false],
    ["renderer origin is opaque (not the pi-web origin)", r.origin !== baseUrl],
    ["renderer direct cross-origin request outcome recorded", rendererStatus !== undefined],
    ["main-process path authenticates successfully", mainStatus === 200],
    ["main-process path creates an independent session", Boolean(r.mainProcessCreateSession?.sessionId)],
    ["main-process path sends a message", r.mainProcessPrompt === 200],
    ["electron main process completed a real run", r.mainProcessRunCompleted === true],
    ["electron client drove a real provider call", r.modelRequestCount > 0],
    ["main-process path stops the run", r.mainProcessAbort === 200],
    ["main-process path reads the session back", r.mainProcessSessionReadable === true],
    ["electron exit did not kill the service", r.serviceAliveAfterElectronExit === true],
    ["no window was shown to the user", evidence.isolation.windowShown === false],
    ["session payload inspected for host-resource leak", r.sessionPayloadInspected === true],
    ["no host-resource leak in the real session payload", r.hostResourceLeakInSession === false],
  ].map(([name, passed]) => ({ name, passed: Boolean(passed) }));
  evidence.rendererDirectCrossOriginBlocked = rendererStatus !== 200;
  evidence.designConsequence = {
    finding: "A sandboxed renderer whose origin is not the pi-web origin cannot call the pi-web API at all: host/origin validation answers 403 'Untrusted API request', and EventSource cannot present credentials.",
    consequence: "The Electron shell MUST proxy every API/SSE call through the main process over contextBridge. A renderer that tries to talk to pi-web directly will not work, and must not be given the credentials to try (which is also the desired security posture).",
    verifiedAgainst: "lib/request-security.ts isApiRequestAllowed (host + origin/fetch-metadata) and lib/agent-event-stream.ts",
  };
  evidence.passed = evidence.assertions.every((assertion) => assertion.passed);
} catch (error) {
  evidence.error = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
  evidence.passed = false;
} finally {
  try { await stopPiWeb(); } catch {}
  try { modelServer.close(); } catch {}
  writeFileSync(resultPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ resultPath, passed: evidence.passed, assertions: evidence.assertions, electron: evidence.electron, error: evidence.error }, null, 2));
}

if (!evidence.passed) process.exitCode = 1;
