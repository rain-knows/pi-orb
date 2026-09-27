import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repo = resolve(import.meta.dirname, "..", "..");
const piWebRepo = process.env.PI_ORB_P0_PI_WEB ?? "C:\\Users\\JUSTLIKEZYP\\OneDrive\\文档\\daily\\pi-web";
const piWebHead = execFileSync("git", ["-C", piWebRepo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const EXPECTED_HEAD = "95a58744532c7fccaa933aa7757a1419ace67ed2";
// Fixed-HEAD source snapshot on the same drive as node_modules: Turbopack rejects
// a symlinked node_modules that points outside the project filesystem root, and
// webpack mis-resolves client entrypoints across Windows drives.
const worktree = join(tmpdir(), "pi-orb-p0-head-src");
const piWebNodeModules = join(piWebRepo, "node_modules");
const extension = join(repo, "evidence", "p0-02", "orb-probe-extension.ts");
// Run cwds must sit OUTSIDE the user profile. Pi discovers `.agents/skills` and
// agent-instruction files by walking up the working directory's ancestors, so a
// cwd under C:\Users\<user> silently loads that user's real skills into the
// session system prompt. %TEMP% is under the profile and did exactly that.
const runBase = process.env.PI_ORB_P0_RUN_BASE ?? "D:\\pi-orb-p0-runs";
const runRoot = join(runBase, `p0-02-${process.pid}`);
const agentDir = join(runRoot, "agent");
// Pi resolves the user-level Agent Skills directory as `HOME/.agents/skills` at
// RUNTIME (see package-manager.js getHomeDir), and loads it unconditionally - it
// ignores both cwd and agentDir. Moving cwd alone therefore does NOT isolate it:
// an earlier run kept inheriting the real C:\Users\<user>\.agents\skills (16 skills)
// into the model prompt. Pointing HOME at an empty isolated dir is what actually
// isolates it.
const homeDir = join(runRoot, "home");
const normalCwd = join(runRoot, "normal");
const orbCwd = join(runRoot, "orb");
const childCwd = join(orbCwd, "child");
const siblingCwd = join(runRoot, "orb-sibling");
const sessionDir = join(agentDir, "sessions");
const logPath = join(runRoot, "extension.ndjson");
const resultPath = join(repo, "evidence", "p0-02", "result.json");
const serverLogPath = join(runRoot, "pi-web-dev.log");
const port = 31287;
const modelPort = 31288;
const baseUrl = `http://127.0.0.1:${port}`;

for (const path of [agentDir, normalCwd, orbCwd, childCwd, siblingCwd, sessionDir, homeDir]) mkdirSync(path, { recursive: true });

function prepareSourceSnapshot() {
  if (piWebHead !== EXPECTED_HEAD) {
    throw new Error(`pi-web HEAD is ${piWebHead}, expected ${EXPECTED_HEAD}; refusing to test an unverified revision`);
  }
  const alreadyPrepared = existsSync(join(worktree, "node_modules", "@next", "env", "package.json"))
    && existsSync(join(worktree, "next.config.ts"));
  if (!alreadyPrepared) {
    rmSync(worktree, { recursive: true, force: true });
    mkdirSync(worktree, { recursive: true });
    // Read-only export of the committed tree into a temp snapshot; pi-web's working
    // tree and .git metadata are never modified.
    const archive = execFileSync("git", ["-C", piWebRepo, "archive", "--format=tar", EXPECTED_HEAD], { maxBuffer: 512 * 1024 * 1024 });
    execFileSync("tar", ["-x", "-f", "-", "-C", worktree], { input: archive, maxBuffer: 512 * 1024 * 1024 });
    // A fresh dependency install inside the snapshot. The pi-web node_modules is not
    // reusable here: it is missing @next/env, so neither `next dev` nor `next start`
    // can boot from it. npm ci writes only inside this temp directory.
    execFileSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: worktree, stdio: "inherit", shell: true });
  }
  if (!existsSync(join(worktree, ".next", "BUILD_ID"))) {
    execFileSync("npm", ["run", "build"], {
      cwd: worktree,
      stdio: "inherit",
      shell: true,
      env: { ...cleanEnv, NODE_OPTIONS: "--max-old-space-size=12288" },
    });
  }
  const status = execFileSync("git", ["-C", piWebRepo, "status", "--porcelain"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
  return { sourceSnapshot: worktree, sourceHead: EXPECTED_HEAD, piWebWorkingTreeChanges: status, reusedSnapshot: alreadyPrepared };
}

const safeEnvKeys = [
  "SystemRoot", "SystemDrive", "ComSpec", "Path", "PATHEXT", "TEMP", "TMP",
  "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "ProgramData",
  "ProgramFiles", "ProgramFiles(x86)", "CommonProgramFiles", "CommonProgramW6432",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER",
  "OS", "WINDIR",
];
const cleanEnv = Object.fromEntries(safeEnvKeys.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
Object.assign(cleanEnv, {
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  PI_WEB_NO_OPEN: "1",
  PI_WEB_SKIP_VERSION_CHECK: "1",
  PI_WEB_HOSTNAME: "127.0.0.1",
  PI_CODING_AGENT_DIR: agentDir,
  PI_CODING_AGENT_SESSION_DIR: sessionDir,
  PI_ORB_P0_ORB_CWD: orbCwd,
  PI_ORB_P0_LOG: logPath,
  HOME: homeDir,
  USERPROFILE: homeDir,
  PATH: process.env.PATH,
});

const capturedModelRequests = [];
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
  capturedModelRequests.push({
    stream: body.stream,
    messages: body.messages,
    tools: Array.isArray(body.tools) ? body.tools.map((tool) => tool.function?.name ?? tool.name) : [],
  });
  res.writeHead(200, { "content-type": body.stream ? "text/event-stream" : "application/json", "cache-control": "no-cache", connection: "keep-alive" });
  if (!body.stream) {
    res.end(JSON.stringify({ id: "p0-response", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "p0-ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const first = { id: "p0-response", object: "chat.completion.chunk", created: now, model: "p0-model", choices: [{ index: 0, delta: { role: "assistant", content: "p0-ok" }, finish_reason: null }] };
  const last = { id: "p0-response", object: "chat.completion.chunk", created: now, model: "p0-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  res.write(`data: ${JSON.stringify(first)}\n\n`);
  res.write(`data: ${JSON.stringify(last)}\n\n`);
  res.end("data: [DONE]\n\n");
});

function writeSettings(withExtension) {
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
    defaultProvider: "p0-local",
    defaultModel: "p0-model",
    defaultThinkingLevel: "off",
    defaultTools: ["read"],
    sessionDir,
    extensions: withExtension ? [extension] : [],
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

let server;
let serverOutput;
async function startPiWeb() {
  serverOutput = createWriteStream(serverLogPath, { flags: "a" });
  server = spawn(process.execPath, [join(worktree, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: worktree,
    env: cleanEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.stdout.on("data", (chunk) => serverOutput.write(chunk));
  server.stderr.on("data", (chunk) => serverOutput.write(chunk));
  await waitFor(async () => {
    try { return (await fetch(`${baseUrl}/api/agent/running`)).ok; } catch { return false; }
  }, 120000, "pi-web dev server");
}

async function stopPiWeb() {
  if (!server || server.killed) return;
  const pid = server.pid;
  try { execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch { try { server.kill(); } catch {} }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  serverOutput?.end();
  server = undefined;
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch (error) { lastError = error; }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError}` : ""}`);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

async function newSession(cwd, toolNames = ["read"]) {
  const body = await request("/api/agent/new", { method: "POST", body: JSON.stringify({ cwd, type: "ensure_session", toolNames }) });
  return body.sessionId;
}
async function command(sessionId, body) {
  return (await request(`/api/agent/${encodeURIComponent(sessionId)}`, { method: "POST", body: JSON.stringify(body) })).data;
}
async function inspect(sessionId) {
  const [tools, commandsResult, state] = await Promise.all([
    command(sessionId, { type: "get_tools" }),
    command(sessionId, { type: "get_commands" }),
    command(sessionId, { type: "get_state" }),
  ]);
  const commands = Array.isArray(commandsResult) ? commandsResult : commandsResult?.commands ?? [];
  return {
    tools: tools.map((tool) => ({ name: tool.name, active: tool.active })),
    commands: commands.map((entry) => typeof entry === "string" ? entry : entry.name),
    state: { sessionId: state.sessionId, sessionFile: state.sessionFile, model: state.model, systemPrompt: state.systemPrompt, extensionStatuses: state.extensionStatuses },
  };
}
async function prompt(sessionId, message) {
  return command(sessionId, { type: "prompt", message });
}
function hasTool(snapshot, name = "orb_probe") { return snapshot.tools.some((tool) => tool.name === name); }
function hasCommand(snapshot, name = "orb-probe") { return snapshot.commands.includes(name); }
/** Read a session JSONL file into entries (used by the fork test). */
function readJsonlEntries(sessionFile) {
  if (!sessionFile || !existsSync(sessionFile)) return [];
  return readFileSync(sessionFile, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
/**
 * Detect a leak of the host user's own resources into what the model actually sees.
 * The first version checked `snapshot.state.systemPrompt`, which is EMPTY (length 0)
 * in these phases - so the assertion passed vacuously while the real captured
 * provider request still contained all 16 user skills. Assert against the real
 * model input instead, and fail closed when there is no request to inspect.
 */
function leakedInto(requests, snapshot) {
  const needles = [".agents\\skills", ".agents/skills", "JUSTLIKEZYP", homeDir];
  const haystacks = [];
  for (const request of requests ?? []) haystacks.push(JSON.stringify(request));
  const prompt = snapshot?.state?.systemPrompt ?? "";
  if (prompt) haystacks.push(prompt);
  if (haystacks.length === 0) return { inspected: 0, leaked: false, vacuous: true };
  const leaked = haystacks.some((text) => needles.some((needle) => text.includes(needle)));
  return { inspected: haystacks.length, leaked, vacuous: false };
}

const evidence = {
  capturedAt: new Date().toISOString(),
  isolation: {
    agentDir,
    sessionDir,
    cwd: [normalCwd, orbCwd, childCwd, siblingCwd],
    inheritedSecretEnv: false,
    screenshots: false,
    desktopInput: false,
    sourceSnapshot: worktree,
    piWebRepo,
    piWebHead: EXPECTED_HEAD,
    piWebWorkingTreeChanges: [],
    runBaseOutsideUserProfile: true,
  },
  build: {
    productionBuild: "fixed-HEAD snapshot (git archive + npm ci) built with `next build --webpack` at --max-old-space-size=12288",
    runMode: "snapshot `next start` on 127.0.0.1:31287",
    devServerUnusable: "`next dev` crashes on this host: Turbopack rejects the linked node_modules, webpack mis-resolves across drives, and the temp-dir dev watcher hits a libuv fs-event assertion",
    piWebNodeModulesUnusable: "pi-web node_modules is missing @next/env; the snapshot uses its own npm ci install",
    piWebNodeModulesPath: piWebNodeModules,
  },
  phases: {},
  assertions: [],
  capturedModelRequests,
};

try {
  Object.assign(evidence.isolation, prepareSourceSnapshot());
  await new Promise((resolvePromise, reject) => modelServer.listen(modelPort, "127.0.0.1", (error) => error ? reject(error) : resolvePromise()));

  writeSettings(false);
  await startPiWeb();
  const baselineNormal = await newSession(normalCwd);
  const baselineOrb = await newSession(orbCwd);
  evidence.phases.baselineNoExtension = {
    normal: await inspect(baselineNormal),
    orb: await inspect(baselineOrb),
  };
  await stopPiWeb();

  writeSettings(true);
  await startPiWeb();
  const normal = await newSession(normalCwd);
  const orb = await newSession(orbCwd);
  const orbSecond = await newSession(orbCwd);
  const child = await newSession(childCwd);
  const sibling = await newSession(siblingCwd);
  evidence.phases.extensionInstalled = {
    normal: { sessionId: normal, snapshot: await inspect(normal) },
    orb: { sessionId: orb, snapshot: await inspect(orb) },
    orbSecond: { sessionId: orbSecond, snapshot: await inspect(orbSecond) },
    child: { sessionId: child, snapshot: await inspect(child) },
    sibling: { sessionId: sibling, snapshot: await inspect(sibling) },
  };

  await prompt(normal, "p0 normal prompt");
  await prompt(orb, "p0 orb prompt");
  // pi-web's prompt command returns after admission, not after the provider call, so
  // captured requests are classified once the run has settled (see below).
  evidence.phases.promptCapture = {
    normal: await inspect(normal),
    orb: await inspect(orb),
  };

  await command(orb, { type: "set_tools", toolNames: [] });
  const chatOnly = await inspect(orb);
  await command(orb, { type: "set_tools", toolNames: ["read"] });
  const restoredSnapshot = await inspect(orb);
  await command(orb, { type: "reload" });
  const reloadedSnapshot = await inspect(orb);
  evidence.phases.chatOnlyRestoreReload = { chatOnly, restored: restoredSnapshot, reloaded: reloadedSnapshot };

  const orbSessionFile = reloadedSnapshot.state.sessionFile;
  const entries = readJsonlEntries(orbSessionFile);
  const forkEntry = [...entries].reverse().find((entry) => entry.type === "message" && entry.id);
  if (!forkEntry) throw new Error("No message entry available for fork test");
  const forkResult = await command(orb, { type: "fork", entryId: forkEntry.id, position: "at" });
  evidence.phases.fork = { sourceSessionId: orb, entryId: forkEntry.id, result: forkResult };
  const forkedSessionId = forkResult?.newSessionId;
  if (forkedSessionId) evidence.phases.fork.snapshot = await inspect(forkedSessionId);

  await stopPiWeb();
  await startPiWeb();
  evidence.phases.resumeAfterRestart = { sessionId: orb, snapshot: await inspect(orb) };
  await stopPiWeb();

  writeSettings(false);
  await startPiWeb();
  evidence.phases.extensionRemoved = {
    resumedOrb: { sessionId: orb, snapshot: await inspect(orb) },
    newOrb: { sessionId: await newSession(orbCwd), snapshot: null },
  };
  evidence.phases.extensionRemoved.newOrb.snapshot = await inspect(evidence.phases.extensionRemoved.newOrb.sessionId);

  const normalBaseline = evidence.phases.baselineNoExtension.normal;
  // Classify captured provider requests only after every prompt has settled.
  await waitFor(() => capturedModelRequests.length >= 2, 60000, "captured provider requests");
  const normalRequests = capturedModelRequests.filter((request) => request.messages.some((message) => JSON.stringify(message).includes("p0 normal prompt")));
  const orbRequests = capturedModelRequests.filter((request) => request.messages.some((message) => JSON.stringify(message).includes("p0 orb prompt")));
  evidence.phases.promptCapture.normalRequests = normalRequests;
  evidence.phases.promptCapture.orbRequests = orbRequests;
  evidence.phases.promptCapture.allRequests = capturedModelRequests.map((request) => ({ stream: request.stream, tools: request.tools }));
  const installedNormal = evidence.phases.extensionInstalled.normal.snapshot;
  const installedOrb = evidence.phases.extensionInstalled.orb.snapshot;
  const installedOrbSecond = evidence.phases.extensionInstalled.orbSecond.snapshot;
  const installedChild = evidence.phases.extensionInstalled.child.snapshot;
  const installedSibling = evidence.phases.extensionInstalled.sibling.snapshot;
  const forkedSnapshot = evidence.phases.fork?.snapshot;
  const chatOnlySnapshot = evidence.phases.chatOnlyRestoreReload.chatOnly;
  const restoredForAssertions = evidence.phases.chatOnlyRestoreReload.restored;
  const reloadedForAssertions = evidence.phases.chatOnlyRestoreReload.reloaded;
  const removed = evidence.phases.extensionRemoved.resumedOrb.snapshot;
  // Inspect the REAL provider payloads, not the (empty) SDK state field.
  const leakChecks = {
    normal: leakedInto(normalRequests, installedNormal),
    orb: leakedInto(orbRequests, installedOrb),
  };
  evidence.leakChecks = leakChecks;
  evidence.isolation.homeDir = homeDir;
  evidence.assertions = [
    // Real-input leak checks (fail closed: an uninspected leak is not a pass).
    ["normal cwd model input inspected for host-resource leak", leakChecks.normal.inspected > 0],
    ["normal cwd model input has no host-resource leak", !leakChecks.normal.leaked],
    ["Orb cwd model input inspected for host-resource leak", leakChecks.orb.inspected > 0],
    ["Orb cwd model input has no host-resource leak", !leakChecks.orb.leaked],
    ["baseline normal has no orb tool", !hasTool(normalBaseline)],
    ["baseline normal has no orb command", !hasCommand(normalBaseline)],
    ["installed normal has no orb tool", !hasTool(installedNormal)],
    ["installed normal has no orb command", !hasCommand(installedNormal)],
    ["installed exact Orb cwd has orb tool", hasTool(installedOrb)],
    ["installed exact Orb cwd has orb command", hasCommand(installedOrb)],
    ["Orb child cwd does not match", !hasTool(installedChild) && !hasCommand(installedChild)],
    ["prefix-similar sibling cwd does not match", !hasTool(installedSibling) && !hasCommand(installedSibling)],
    ["two sessions on the same Orb cwd both receive tool", hasTool(installedOrbSecond) && hasCommand(installedOrbSecond)],
    ["fork inherits conditional extension", Boolean(forkedSnapshot) && hasTool(forkedSnapshot) && hasCommand(forkedSnapshot)],
    ["fork produced a distinct session id", Boolean(evidence.phases.fork?.result?.newSessionId) && evidence.phases.fork.result.newSessionId !== evidence.phases.fork.sourceSessionId],
    ["chat-only removes extension tool and command", !hasTool(chatOnlySnapshot) && !hasCommand(chatOnlySnapshot)],
    ["restoring tools restores extension tool", hasTool(restoredForAssertions) && hasCommand(restoredForAssertions)],
    ["reload preserves conditional extension", hasTool(reloadedForAssertions) && hasCommand(reloadedForAssertions)],
    ["resume preserves conditional extension", hasTool(evidence.phases.resumeAfterRestart.snapshot)],
    ["removing extension restores ordinary behavior", !hasTool(removed) && !hasCommand(removed)],
    ["model request captured Orb tool schema", orbRequests.some((request) => request.tools.includes("orb_probe"))],
    ["model request captured structured Orb prompt", orbRequests.some((request) => request.messages.some((message) => JSON.stringify(message).includes("orb_p0_probe")))],
    ["normal cwd model request exists", normalRequests.length > 0],
    ["normal cwd model request has no Orb tool", normalRequests.every((request) => !request.tools.includes("orb_probe"))],
    ["normal cwd model request has no Orb prompt section", normalRequests.every((request) => !request.messages.some((message) => JSON.stringify(message).includes("orb_p0_probe")))],
    ["normal cwd system prompt has no Orb section", !installedNormal.state.systemPrompt.includes("orb_p0_probe")],
    ["Orb cwd session prompt exposes Orb section", evidence.phases.extensionInstalled.orb.snapshot.state.systemPrompt.includes("orb_p0_probe") || orbRequests.some((request) => request.messages.some((message) => JSON.stringify(message).includes("orb_p0_probe")))],
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

if (!evidence.passed) process.exitCode = 1;
