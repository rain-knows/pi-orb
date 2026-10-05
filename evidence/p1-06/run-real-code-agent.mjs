// Real-model code_agent acceptance harness.
//
// This exercises the reference background-session contract through the product's own path:
// real Pi Web + real model -> Pi extension -> named-pipe bridge -> Electron CodeAgentManager
// -> independent Pi Web session -> completion notice back to the Orb session.
// No desktop target is needed; the worker itself never receives GUI tools.

import { spawn, execFileSync } from "node:child_process";
import { connect } from "node:net";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repo = resolve(import.meta.dirname, "..", "..");
const mode = process.argv[2] ?? "complete";
if (!["complete", "stop", "failure"].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
const piWebWorktree = process.env.PI_ORB_EVIDENCE_PI_WEB ?? join(tmpdir(), "pi-orb-p0-head-src");
const runRoot = join("D:\\pi-orb-p1-runs", `p1-06-real-code-agent-${mode}-${Date.now()}`);
const workspace = join(runRoot, "orb-workspace");
const agentDir = join(tmpdir(), `pi-orb-real-code-agent-${mode}-${Date.now()}`);
const shellDataDir = join(runRoot, "shell-data");
const configPath = join(runRoot, "orb-config.json");
const outputPath = join(repo, "evidence", "p1-06", `real-model-code-agent-${mode}-session.json`);
const extensionPath = join(repo, "pi-package", "extensions", "orb.ts");
const electronBinary = join(repo, "node_modules", "electron", "dist", "electron.exe");
const piWebPort = 40_000 + (process.pid % 10_000);
const debugPort = piWebPort + 1;
const password = "p1-06-real-code-agent-password";
const baseUrl = `http://127.0.0.1:${piWebPort}`;
const workspaceMarker = mode === "complete" ? "P1ORBCODEAGENT" : "P1ORBCODEAGENTSTOP";
const markerName = mode === "complete" ? "background-proof.txt" : "must-not-exist-after-stop.txt";
const model = { provider: "TZcode", id: "deepseek-v4.1-flash" };
const realAgentDir = join(process.env.USERPROFILE ?? "", ".pi", "agent");
const failureExtensionPath = join(agentDir, "provider-failure-probe.ts");
const failureProbeLog = join(runRoot, "provider-failure-probe.jsonl");
const rejectedModel = "pi-orb-provider-failure-probe-nonexistent-model";

for (const directory of [runRoot, workspace, agentDir, shellDataDir]) mkdirSync(directory, { recursive: true });

const sleep = (ms) => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
const safe = (value, max = 800) => {
  try {
    const text = JSON.stringify(value, (key, item) => key === "token" ? "<redacted>" : item);
    return text.length > max ? `${text.slice(0, max)}...` : text;
  } catch { return String(value); }
};
const report = {
  capturedAt: new Date().toISOString(),
  verification: {
    chain: "real model -> Pi Web -> orb extension -> named pipe -> Electron CodeAgentManager -> independent Pi Web worker",
    reference: "mini-yifan/dsh-orb-cordis@9cdc50302d202f4497569731be488a8afa500da7",
    model,
    mode,
    marker: workspaceMarker,
  },
  isolation: {
    runRoot,
    workspace,
    shellDataDir,
    agentDir,
    modelsJson: "hard link to the real file (no copy)",
    authJson: "symlink to the real file (no copy)",
  },
  checks: [],
  steps: {},
  passed: false,
};

function check(name, ok, detail) {
  report.checks.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
}

function readJsonl(path) {
  try {
    return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch { return []; }
}

function allSessionFiles() {
  const root = join(agentDir, "sessions");
  if (!existsSync(root)) return [];
  const files = [];
  for (const directory of readdirSync(root, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    for (const file of readdirSync(join(root, directory.name))) {
      if (file.endsWith(".jsonl")) files.push(join(root, directory.name, file));
    }
  }
  return files;
}

function allFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...allFiles(path));
    else files.push(path);
  }
  return files;
}

function scanSessions() {
  const calls = [];
  const results = [];
  const notices = [];
  for (const file of allSessionFiles()) {
    for (const entry of readJsonl(file)) {
      const message = entry?.message;
      const content = message?.content;
      if (message?.role === "toolResult" && Array.isArray(content)) results.push({
        toolName: message.toolName ?? null,
        toolCallId: message.toolCallId ?? null,
        isError: message.isError === true,
        text: content.filter(block => block?.type === "text").map(block => block.text ?? "").join("\n"),
      });
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "toolCall") {
            const name = block.name ?? block.toolName;
            if (typeof name === "string") calls.push({ name, id: block.id ?? null, arguments: block.arguments ?? null, file });
          }
          if (block?.type === "text" && typeof block.text === "string" && block.text.includes("Background Code agent session")) notices.push(block.text);
        }
      }
      if (typeof message?.text === "string" && message.text.includes("Background Code agent session")) notices.push(message.text);
    }
  }
  return { calls, results, notices };
}

function stageAgentDir() {
  const modelsSource = join(realAgentDir, "models.json");
  const authSource = join(realAgentDir, "auth.json");
  if (!existsSync(modelsSource)) throw new Error(`No real models.json at ${modelsSource}`);
  linkSync(modelsSource, join(agentDir, "models.json"));
  if (existsSync(authSource)) symlinkSync(authSource, join(agentDir, "auth.json"));
  if (mode === "failure") {
    // Use Pi's public hooks only in this disposable worker. The real provider must reject the
    // altered model ID; no errors or lifecycle events are faked, and no credentials are logged.
    writeFileSync(failureExtensionPath, `import { appendFileSync } from "node:fs";
import { backgroundSession } from ${JSON.stringify(join(repo, "pi-package/extensions/code-agent.ts").replaceAll("\\", "/"))};
const log = value => appendFileSync(${JSON.stringify(failureProbeLog)}, JSON.stringify(value) + "\\n");
export default function probe(pi) {
  pi.on("before_provider_request", (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (!backgroundSession(sessionId)) return;
    log({ event: "worker-request", sessionId, rejectedModel: ${JSON.stringify(rejectedModel)} });
    return { ...event.payload, model: ${JSON.stringify(rejectedModel)} };
  });
  pi.on("after_provider_response", (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (backgroundSession(sessionId)) log({ event: "worker-response", sessionId, status: event.status });
  });
  pi.on("agent_end", (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    if (!backgroundSession(sessionId)) return;
    const message = event.messages.findLast(item => item.role === "assistant");
    log({ event: "worker-end", sessionId, stopReason: message?.stopReason, errorMessage: message?.errorMessage });
  });
}
`, "utf8");
  }
  writeFileSync(join(agentDir, "settings.json"), `${JSON.stringify({
    defaultProvider: model.provider,
    defaultModel: model.id,
    defaultThinkingLevel: "off",
    ...(mode === "failure" ? { retry: { enabled: false, provider: { maxRetries: 0 } } } : {}),
    defaultTools: ["read"],
    extensions: [extensionPath, ...(mode === "failure" ? [failureExtensionPath] : [])],
    enableInstallTelemetry: false,
    enableAnalytics: false,
  }, null, 2)}\n`, "utf8");
}

function writeConfig() {
  writeFileSync(configPath, `${JSON.stringify({
    version: 1,
    orbWorkspace: workspace,
    shortcut: "Control+Alt+F11",
    window: { alwaysOnTop: true, x: 60, y: 60, width: 445, height: 632 },
  }, null, 2)}\n`, "utf8");
}

function startPiWeb() {
  const safeKeys = [
    "SystemRoot", "SystemDrive", "ComSpec", "Path", "PATHEXT", "TEMP", "TMP", "APPDATA",
    "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "CommonProgramFiles",
    "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "OS", "WINDIR",
  ];
  const env = Object.fromEntries(safeKeys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  Object.assign(env, {
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    PI_WEB_NO_OPEN: "1",
    PI_WEB_SKIP_VERSION_CHECK: "1",
    PI_WEB_HOSTNAME: "127.0.0.1",
    PI_WEB_PASSWORD: password,
    PI_CODING_AGENT_DIR: agentDir,
    PI_ORB_CONFIG: configPath,
    PI_ORB_BRIDGE_TOKEN_FILE: join(shellDataDir, "bridge-token.json"),
    HOME: process.env.USERPROFILE,
    USERPROFILE: process.env.USERPROFILE,
    PATH: process.env.PATH,
  });
  return spawn(process.execPath, [join(piWebWorktree, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(piWebPort), "-H", "127.0.0.1"], {
    cwd: piWebWorktree,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function startShell() {
  return spawn(electronBinary, [".", `--user-data-dir=${shellDataDir}`, `--remote-debugging-port=${debugPort}`], {
    cwd: repo,
    env: { ...process.env, PI_ORB_CONFIG: configPath, PI_ORB_PI_WEB_URL: baseUrl, PI_ORB_PI_WEB_PASSWORD: password },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForService() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(`${baseUrl}/login`); if (response.status < 500) return true; } catch { /* starting */ }
    await sleep(400);
  }
  return false;
}

async function waitForHandshake() {
  const paths = [join(shellDataDir, "bridge-token.json"), join(shellDataDir, "pi-orb", "bridge-token.json")];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    for (const path of paths) {
      if (!existsSync(path)) continue;
      try {
        const value = JSON.parse(readFileSync(path, "utf8"));
        if (value.token && value.pipePath) return value;
      } catch { /* still being written */ }
    }
    await sleep(500);
  }
  return null;
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP socket error")), { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data.toString());
    if (typeof message.id !== "number" || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
  });
  return {
    send(method, params = {}) {
      return new Promise((resolvePromise, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve: resolvePromise, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function attachRenderer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const pages = response.ok ? await response.json() : [];
      const page = pages.find(value => value.type === "page" && value.webSocketDebuggerUrl);
      if (page) return connectCdp(page.webSocketDebuggerUrl);
    } catch { /* renderer not ready */ }
    await sleep(500);
  }
  return null;
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return result?.result?.value;
}

async function orb(client, expression) {
  const value = await evaluate(client, `(async () => { try { return JSON.stringify(await (${expression})); } catch (error) { return JSON.stringify({ __error: String(error?.message ?? error) }); } })()`);
  try { return JSON.parse(value); } catch { return { __unparsed: value }; }
}

async function bridgeCodeAgent(handshake, sessionId, generation, command, argumentsValue) {
  const requestId = `control-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const payload = `${JSON.stringify({
    version: 2,
    type: "code-agent",
    token: handshake.token,
    sessionId,
    generation,
    command,
    arguments: argumentsValue,
    requestId,
  })}\n`;
  return await new Promise((resolvePromise, reject) => {
    const socket = connect(handshake.pipePath);
    let data = "";
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("control bridge timed out")); }, 30_000);
    socket.on("connect", () => socket.write(payload));
    socket.on("data", chunk => {
      data += chunk.toString("utf8");
      const newline = data.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      socket.destroy();
      try { resolvePromise(JSON.parse(data.slice(0, newline))); }
      catch (error) { reject(error); }
    });
    socket.on("error", error => { clearTimeout(timer); reject(error); });
  });
}

let piWeb;
let shell;
let piWebOutput = "";
let shellOutput = "";
function shutdown(code) {
  for (const child of [shell, piWeb]) {
    if (!child?.pid) continue;
    try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch { /* already gone */ }
  }
  try { rmSync(agentDir, { recursive: true, force: true }); } catch { /* evidence remains */ }
  process.exit(code);
}

try {
  if (!existsSync(join(piWebWorktree, ".next", "BUILD_ID"))) throw new Error(`The pi-web snapshot at ${piWebWorktree} is not built.`);
  stageAgentDir();
  writeConfig();
  piWeb = startPiWeb();
  piWeb.stdout?.on("data", chunk => { piWebOutput += chunk.toString(); });
  piWeb.stderr?.on("data", chunk => { piWebOutput += chunk.toString(); });
  if (!await waitForService()) throw new Error("pi-web did not start");
  shell = startShell();
  shell.stdout?.on("data", chunk => { shellOutput += chunk.toString(); });
  shell.stderr?.on("data", chunk => { shellOutput += chunk.toString(); });
  const handshake = await waitForHandshake();
  check("the isolated shell published a bridge handshake", Boolean(handshake), safe(handshake));
  const client = await attachRenderer();
  if (!check("the isolated Orb renderer is reachable over CDP", Boolean(client), "no renderer")) throw new Error("no renderer");

  const workspaceStatus = await orb(client, `window.orb.setWorkspace(${JSON.stringify(workspace)}, true)`);
  report.steps.workspace = workspaceStatus;
  const sessionId = await orb(client, "window.orb.ensureSession()");
  report.steps.sessionId = sessionId;
  const status = await orb(client, "window.orb.getStatus()");
  const generation = status?.generation;
  report.steps.generation = generation;
  check("the isolated Orb session has a generation", typeof generation === "number", safe(status));
  const access = await orb(client, `window.orb.setOrbAccess({ generation: ${generation}, level: 'workspace-write' })`);
  report.steps.access = access;
  check("Workspace Write is granted to the owner session", access?.authorized === true && access?.sessionId === sessionId, safe(access));

  const prompt = mode === "failure" ? [
    "Use code_agent exactly once for this task; do not use bash, write, edit, or any GUI tool yourself.",
    "Ask the background worker to report its current working directory in one sentence.",
    "After code_agent accepts, end the turn. Do not poll. If a failure notice arrives, tell the user that it failed and stop; do not retry or start another worker.",
  ].join("\n") : mode === "complete" ? [
    "Use the code_agent tool exactly once for this task; do not use bash, write, edit, or any GUI tool yourself.",
    `Ask the background worker to create a file named ${markerName} in its assigned cwd containing exactly ${workspaceMarker}.`,
    "After code_agent accepts the task, end this turn. Do not poll with wait or code_agent_status.",
  ].join("\n") : [
    "Use the code_agent tool exactly once for this task; do not use bash, write, edit, or any GUI tool yourself.",
    `Ask the background worker to run a 120-second sleep before creating ${markerName}; it must not finish before the sleep.`,
    "After code_agent accepts the task, end this turn. Do not poll with wait or code_agent_status.",
  ].join("\n");
  const sent = await orb(client, `window.orb.sendPrompt({ generation: ${generation}, text: ${JSON.stringify(prompt)} })`);
  report.steps.prompt = sent;
  check("the owner prompt was accepted", sent?.accepted !== false, safe(sent));

  const deadline = Date.now() + (mode === "stop" ? 120_000 : 420_000);
  let latest = { calls: [], results: [], notices: [] };
  let markerPath = null;
  let stopResponse = null;
  let workerSessionId = null;
  while (Date.now() < deadline) {
    await sleep(mode === "complete" ? 5000 : 2000);
    latest = scanSessions();
    markerPath = allFiles(workspace).find(path => path.endsWith(markerName) && readFileSync(path, "utf8").trim() === workspaceMarker) ?? null;
    const dispatchCall = latest.calls.find(call => call.name === "code_agent");
    const dispatchResult = dispatchCall && latest.results.find(result => result.toolCallId === dispatchCall.id);
    if (dispatchResult && !workerSessionId) {
      try { workerSessionId = JSON.parse(dispatchResult.text.split(/\r?\n/u, 1)[0]).session_id ?? null; } catch { /* keep polling */ }
    }
    if (mode === "stop" && workerSessionId && !stopResponse) {
      stopResponse = await bridgeCodeAgent(handshake, sessionId, generation, "stop", { session_id: workerSessionId });
      report.steps.stopResponse = stopResponse;
      break;
    }
    if (mode === "failure" && latest.notices.some(text => /failed this task/u.test(text))) break;
    if (mode === "failure" && latest.notices.some(text => /finished this task/u.test(text))) break;
    if (markerPath && latest.notices.length > 0) break;
    if (dispatchResult?.isError === true) break;
  }
  report.steps.registryFiles = allFiles(runRoot).filter(path => path.endsWith("code-agent-sessions.json")).map(path => path.replace(runRoot, "<runRoot>"));
  report.steps.markerPath = markerPath?.replace(runRoot, "<runRoot>") ?? null;
  report.modelToolCalls = latest.calls.map(call => ({ name: call.name, arguments: call.arguments, file: call.file.replace(agentDir, "<agentDir>") }));
  report.modelToolResults = latest.results;
  report.completionNotices = latest.notices;
  report.steps.workerSessionId = workerSessionId;
  report.steps.registry = allFiles(runRoot)
    .filter(path => path.endsWith("code-agent-sessions.json"))
    .flatMap(path => { try { return [{ path: path.replace(runRoot, "<runRoot>"), value: JSON.parse(readFileSync(path, "utf8")) }]; } catch { return []; } });
  report.steps.shellTail = shellOutput.slice(-4000);
  report.steps.piWebTail = piWebOutput.slice(-4000);
  const dispatch = latest.calls.find(call => call.name === "code_agent");
  check("the real model called code_agent", Boolean(dispatch), safe(latest.calls.map(call => call.name)));
  if (mode === "failure") {
    const registryTask = report.steps.registry.flatMap(entry => Array.isArray(entry.value) ? entry.value : []).find(task => task.session_id === workerSessionId);
    const probe = readJsonl(failureProbeLog);
    const providerError = probe.findLast(entry => entry.event === "worker-end" && entry.sessionId === workerSessionId && entry.stopReason === "error")?.errorMessage;
    report.steps.failureProbe = probe;
    check("the real worker request used the isolated invalid model ID", probe.some(entry => entry.event === "worker-request" && entry.sessionId === workerSessionId && entry.rejectedModel === rejectedModel), safe(probe));
    check("the real provider error reached the worker's final assistant message", probe.some(entry => entry.event === "worker-end" && entry.sessionId === workerSessionId && entry.stopReason === "error" && /\b(?:4\d\d|5\d\d)\b/u.test(entry.errorMessage ?? "")), safe(probe));
    check("the exact provider failure is stored in the persistent registry", registryTask?.status === "error" && Boolean(providerError) && registryTask.outcome === providerError, safe(registryTask));
    check("the owner received exactly one notice with the real provider error", Boolean(providerError) && latest.notices.filter(text => /failed this task/u.test(text)).length === 1 && latest.notices.some(text => /failed this task/u.test(text) && text.includes(providerError)), safe(latest.notices));
    check("the failed worker did not emit a successful completion notice", !latest.notices.some(text => /finished this task/u.test(text)), safe(latest.notices));
    check("the owner did not retry the background task", latest.calls.filter(call => call.name === "code_agent").length === 1, safe(latest.calls.map(call => call.name)));
  } else if (mode === "complete") {
    check("the worker produced the requested marker file", Boolean(markerPath), safe({ markerPath, workspace }));
    check("the owner received exactly one successful completion notice", latest.notices.length === 1 && /finished this task/u.test(latest.notices[0]), safe(latest.notices));
  } else {
    const registryTask = report.steps.registry.flatMap(entry => Array.isArray(entry.value) ? entry.value : []).find(task => task.session_id === workerSessionId);
    check("the product bridge accepted code_agent_stop", stopResponse?.ok === true && stopResponse?.result?.accepted === true, safe(stopResponse));
    check("the stopped worker is idle in the persistent registry", registryTask?.status === "idle" && registryTask?.pending === false, safe(registryTask));
    check("the stopped worker did not produce the marker", !markerPath, safe({ markerPath, workspace }));
    check("stopping did not deliver a completion notice", latest.notices.length === 0, safe(latest.notices));
  }
  report.passed = report.checks.every(entry => entry.ok);
  report.finishedAt = new Date().toISOString();
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`checks: ${report.checks.filter(entry => entry.ok).length}/${report.checks.length}`);
  for (const entry of report.checks) console.log(`  [${entry.ok ? "PASS" : "FAIL"}] ${entry.name}`);
  console.log(`written: ${outputPath}`);
  client.close();
  shutdown(report.passed ? 0 : 1);
} catch (error) {
  report.error = String(error?.message ?? error);
  report.finishedAt = new Date().toISOString();
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`ABORTED: ${report.error}`);
  console.log(`written: ${outputPath}`);
  shutdown(1);
}
