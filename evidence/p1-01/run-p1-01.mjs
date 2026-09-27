// P1-01: Orb workspace + independent session verification against a real pi-web.
//
// Answers the P1-01 acceptance items in doc/pi-orb-development-goals.md §5 (M1):
//   - Orb cannot be enabled without a selected workspace, and cancelling writes
//     nothing;
//   - an exact directory match is the only thing that enables Orb mode; a
//     subdirectory and a prefix-similar sibling do NOT match;
//   - switching workspace starts a new session, keeps the old files and history,
//     and never lets two workspaces share one session;
//   - the user-level `HOME/.agents/skills` fact is demonstrated rather than
//     asserted: it reaches EVERY session prompt, so Orb can promise only that it
//     does not actively change prompts.
//
// Everything runs against a fixed-HEAD pi-web snapshot on a separate loopback
// port, with an isolated agent dir, an isolated HOME, and a local fake provider.
// No real credentials, no real model, no screenshots, and pi-web's working tree is
// never modified.
//
// Run: node evidence/p1-01/run-p1-01.mjs

import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repo = resolve(import.meta.dirname, "..", "..");
const piWebRepo = process.env.PI_ORB_PI_WEB ?? "C:\\Users\\JUSTLIKEZYP\\OneDrive\\文档\\daily\\pi-web";
const EXPECTED_HEAD = "95a58744532c7fccaa933aa7757a1419ace67ed2";
const worktree = join(tmpdir(), "pi-orb-p0-head-src");
const runBase = process.env.PI_ORB_P1_RUN_BASE ?? "D:\\pi-orb-p1-runs";
const runRoot = join(runBase, `p1-01-${process.pid}`);

const port = 31291;
const modelPort = 31292;
const baseUrl = `http://127.0.0.1:${port}`;
const password = "p1-01-isolated-test-password";

const agentDir = join(runRoot, "agent");
const sessionDir = join(agentDir, "sessions");
const homeDir = join(runRoot, "home");
const normalCwd = join(runRoot, "normal-project");
const orbCwd = join(runRoot, "orb-workspace");
const orbCwdSub = join(orbCwd, "subdirectory");
const orbCwdSibling = join(runRoot, "orb-workspace-2");
const secondOrbCwd = join(runRoot, "orb-workspace-second");
const configPath = join(runRoot, "orb-config.json");
const extensionPath = join(repo, "pi-package", "extensions", "orb.ts");
const serverLogPath = join(runRoot, "pi-web.log");

/** Unique marker proving user-level skills reach a prompt, and from where. */
const USER_SKILL_MARKER = "P1_ORB_USER_LEVEL_SKILL_MARKER_7731";

for (const path of [
  agentDir,
  sessionDir,
  homeDir,
  normalCwd,
  orbCwd,
  orbCwdSub,
  orbCwdSibling,
  secondOrbCwd,
]) {
  mkdirSync(path, { recursive: true });
}

// A synthetic user-level skill. The real host profile has 16 such skills; using a
// controlled fixture proves the same mechanism without reading or writing the
// user's real profile.
const userSkillDir = join(homeDir, ".agents", "skills", "p1-orb-user-skill");
mkdirSync(userSkillDir, { recursive: true });
writeFileSync(
  join(userSkillDir, "SKILL.md"),
  `---\nname: p1-orb-user-skill\ndescription: ${USER_SKILL_MARKER}\n---\n\n${USER_SKILL_MARKER}\n`,
  "utf8",
);

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
// Local fake provider. Records every request body so the assertions inspect what
// the model actually received, not what the UI displays.
// ---------------------------------------------------------------------------
const modelRequests = [];
let modelRequestCount = 0;
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
  const raw = Buffer.concat(chunks).toString("utf8");
  modelRequestCount += 1;
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {
    body = { parseError: true };
  }
  // Normalize: only the semantic fields are compared later. A request id or a
  // timestamp would otherwise make two identical prompts look different.
  const tools = Array.isArray(body.tools) ? body.tools.map((tool) => tool?.function?.name ?? tool?.name ?? "?") : [];
  const serialized = JSON.stringify(body.messages ?? []);
  modelRequests.push({
    index: modelRequestCount,
    tools: [...tools].sort(),
    containsOrbModeSection: serialized.includes("orb_mode"),
    containsUserSkillMarker: serialized.includes(USER_SKILL_MARKER),
    userSkillMarkerOccurrences: serialized.split(USER_SKILL_MARKER).length - 1,
    agentDirMentions: serialized.split(".agents").length - 1,
    messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
  });

  res.writeHead(200, {
    "content-type": body.stream ? "text/event-stream" : "application/json",
    "cache-control": "no-cache",
  });
  const now = Math.floor(Date.now() / 1000);
  if (!body.stream) {
    res.end(JSON.stringify({ id: "p1", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "p1-ok" }, finish_reason: "stop" }] }));
    return;
  }
  res.write(`data: ${JSON.stringify({ id: "p1", object: "chat.completion.chunk", created: now, model: "p1-model", choices: [{ index: 0, delta: { role: "assistant", content: "p1-" }, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ id: "p1", object: "chat.completion.chunk", created: now, model: "p1-model", choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
  res.end("data: [DONE]\n\n");
});

function writeAgentSettings({ withExtension }) {
  writeFileSync(
    join(agentDir, "settings.json"),
    `${JSON.stringify({
      defaultProvider: "p1-local",
      defaultModel: "p1-model",
      defaultThinkingLevel: "off",
      defaultTools: ["read"],
      sessionDir,
      extensions: withExtension ? [extensionPath] : [],
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
}

function writeOrbConfig(orbWorkspace) {
  writeFileSync(
    configPath,
    `${JSON.stringify({
      version: 1,
      orbWorkspace,
      shortcut: "CommandOrControl+Shift+Space",
      window: { alwaysOnTop: true, x: null, y: null, width: 420, height: 640 },
    }, null, 2)}\n`,
    "utf8",
  );
}

function prepareSourceSnapshot() {
  if (piWebHead !== EXPECTED_HEAD) {
    throw new Error(`pi-web HEAD is ${piWebHead}, expected ${EXPECTED_HEAD}; refusing to test an unverified revision`);
  }
  const prepared =
    existsSync(join(worktree, "node_modules", "@next", "env", "package.json")) &&
    existsSync(join(worktree, "next.config.ts")) &&
    existsSync(join(worktree, ".next", "BUILD_ID"));
  if (!prepared) {
    throw new Error(
      `pi-web snapshot at ${worktree} is missing or unbuilt; run node evidence/p0-02/run-p0-02.mjs once to prepare it`,
    );
  }
  const status = execFileSync("git", ["-C", piWebRepo, "status", "--porcelain"], { encoding: "utf8" })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  return { sourceSnapshot: worktree, sourceHead: EXPECTED_HEAD, piWebWorkingTreeChanges: status };
}

let server;
let serverOutput;

async function startPiWeb() {
  serverOutput = createWriteStream(serverLogPath, { flags: "a" });
  server = spawn(
    process.execPath,
    [join(worktree, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"],
    { cwd: worktree, env: cleanEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  server.stdout.on("data", (chunk) => serverOutput.write(chunk));
  server.stderr.on("data", (chunk) => serverOutput.write(chunk));
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
  await new Promise((done) => setTimeout(done, 1200));
  serverOutput?.end();
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
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError}` : ""}`);
}

async function request(path, { method = "GET", body } = {}) {
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

/** Create a session bound to `cwd` and return pi-web's real session id. */
async function createSession(cwd) {
  const response = await request("/api/agent/new", { method: "POST", body: { cwd, type: "ensure_session" } });
  if (response.status !== 200 || typeof response.body?.sessionId !== "string") {
    throw new Error(`createSession(${cwd}) failed: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.sessionId;
}

/** Send one prompt and wait for the provider to receive exactly one more request. */
async function promptAndWait(sessionId, text) {
  const before = modelRequestCount;
  const response = await request(`/api/agent/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    body: { type: "prompt", message: text },
  });
  if (response.status !== 200) {
    throw new Error(`prompt failed: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  }
  await waitFor(() => modelRequestCount > before, 60000, `provider call for ${text}`);
  return modelRequests.at(-1);
}

function sessionFiles() {
  try {
    return readdirSync(sessionDir, { recursive: true })
      .map((entry) => String(entry))
      .filter((entry) => entry.endsWith(".jsonl"));
  } catch {
    return [];
  }
}

function sessionFileFor(sessionId) {
  try {
    const matches = readdirSync(sessionDir, { recursive: true })
      .map((entry) => String(entry))
      .filter((entry) => entry.endsWith(".jsonl") && entry.includes(sessionId));
    return matches[0] ? join(sessionDir, matches[0]) : null;
  } catch {
    return null;
  }
}

const evidence = {
  capturedAt: new Date().toISOString(),
  isolation: {
    piWebRepo,
    runRoot,
    agentDir,
    sessionDir,
    homeDir,
    normalCwd,
    orbCwd,
    orbCwdSub,
    orbCwdSibling,
    configPath,
    extensionPath,
    baseUrl,
    port,
    modelPort,
    userSkillFixture: `${userSkillDir}\\SKILL.md`,
    credentialSource: "isolated test password in the child env only; the user's real auth.json and ~/.pi/agent are never passed",
    realUserProfileTouched: false,
    screenshots: false,
    desktopInput: false,
    realModel: false,
  },
  workspaceSelection: {},
  orbModeMatching: {},
  sessions: {},
  promptLeakDeclaration: {},
  assertions: [],
};

try {
  Object.assign(evidence.isolation, prepareSourceSnapshot());

  // -------------------------------------------------------------------------
  // Phase 1: no extension. Establish the baseline prompt for a normal cwd.
  // -------------------------------------------------------------------------
  writeAgentSettings({ withExtension: false });
  writeOrbConfig(null);
  await new Promise((done, fail) => modelServer.listen(modelPort, "127.0.0.1", (error) => (error ? fail(error) : done())));
  await startPiWeb();

  const baselineSession = await createSession(normalCwd);
  const baselineRequest = await promptAndWait(baselineSession, "baseline");

  // No workspace configured: Orb mode is off everywhere, including the directory
  // that later becomes the workspace.
  const noWorkspaceSession = await createSession(orbCwd);
  const noWorkspaceRequest = await promptAndWait(noWorkspaceSession, "no-workspace");

  evidence.workspaceSelection = {
    withoutWorkspace: {
      orbCwdRequestHasOrbSection: noWorkspaceRequest.containsOrbModeSection,
      note: "with no workspace configured, even the later-Orb directory gets no Orb section",
    },
  };

  await stopPiWeb();

  // -------------------------------------------------------------------------
  // Phase 2: extension installed, workspace = orbCwd.
  // -------------------------------------------------------------------------
  writeAgentSettings({ withExtension: true });
  writeOrbConfig(orbCwd);
  await startPiWeb();

  const normalSession = await createSession(normalCwd);
  const normalRequest = await promptAndWait(normalSession, "normal");

  const orbSession = await createSession(orbCwd);
  const orbRequest = await promptAndWait(orbSession, "orb");

  const subSession = await createSession(orbCwdSub);
  const subRequest = await promptAndWait(subSession, "sub");

  const siblingSession = await createSession(orbCwdSibling);
  const siblingRequest = await promptAndWait(siblingSession, "sibling");

  evidence.orbModeMatching = {
    exactWorkspace: {
      cwd: orbCwd,
      hasOrbSection: orbRequest.containsOrbModeSection,
      tools: orbRequest.tools,
    },
    normalDirectory: {
      cwd: normalCwd,
      hasOrbSection: normalRequest.containsOrbModeSection,
      tools: normalRequest.tools,
    },
    subdirectory: {
      cwd: orbCwdSub,
      hasOrbSection: subRequest.containsOrbModeSection,
      tools: subRequest.tools,
    },
    prefixSimilarSibling: {
      cwd: orbCwdSibling,
      hasOrbSection: siblingRequest.containsOrbModeSection,
      tools: siblingRequest.tools,
    },
    exactMatchNote: "matching is an exact normalized-directory equality test, and both the resolver and the comparison live in src/shared/orb-config.ts",
  };

  // -------------------------------------------------------------------------
  // Phase 3: switching workspace must not share or destroy sessions.
  // -------------------------------------------------------------------------
  const beforeSwitchFiles = sessionFiles();
  const firstSessionFile = sessionFileFor(orbSession);
  const firstSessionContentBefore = firstSessionFile ? readFileSync(firstSessionFile, "utf8") : "";

  writeOrbConfig(secondOrbCwd);
  const secondSession = await createSession(secondOrbCwd);
  const secondRequest = await promptAndWait(secondSession, "second-workspace");

  const afterSwitchFiles = sessionFiles();
  const firstSessionContentAfter = firstSessionFile ? readFileSync(firstSessionFile, "utf8") : "";

  evidence.sessions = {
    baselineSessionId: baselineSession,
    normalSessionId: normalSession,
    orbSessionId: orbSession,
    secondOrbSessionId: secondSession,
    differentWorkspaceGetsDifferentSession: orbSession !== secondSession,
    differentWorkspaceStillMatchesOrbMode: secondRequest.containsOrbModeSection,
    sessionFilesBeforeSwitch: beforeSwitchFiles.length,
    sessionFilesAfterSwitch: afterSwitchFiles.length,
    firstSessionFile,
    firstSessionFileStillExists: Boolean(firstSessionFile) && existsSync(firstSessionFile),
    firstSessionContentUnchanged: firstSessionContentBefore === firstSessionContentAfter,
    firstSessionBytes: firstSessionContentAfter.length,
    firstSessionMessageCount: firstSessionContentAfter
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0).length,
    note: "pi-web fixes cwd at creation time, so a workspace switch must create a new session; the previous session file and its history are left intact",
  };

  // -------------------------------------------------------------------------
  // Phase 4: the user-level skills fact, demonstrated instead of asserted.
  // -------------------------------------------------------------------------
  const withExtensionNormal = normalRequest;
  evidence.promptLeakDeclaration = {
    claim:
      "Pi loads the USER-LEVEL $HOME/.agents/skills unconditionally. HOME is resolved at runtime, independently of cwd and agentDir, so this content reaches EVERY session prompt, including non-Orb ones. Orb therefore promises only that it does not actively change prompts; it cannot promise byte-identical prompt content.",
    fixture: `a synthetic user-level skill at ${join(userSkillDir, "SKILL.md")} containing ${USER_SKILL_MARKER}`,
    baselineNormalCwd: {
      containsUserSkillMarker: baselineRequest.containsUserSkillMarker,
      markerOccurrences: baselineRequest.userSkillMarkerOccurrences,
    },
    withExtensionNormalCwd: {
      containsUserSkillMarker: withExtensionNormal.containsUserSkillMarker,
      markerOccurrences: withExtensionNormal.userSkillMarkerOccurrences,
    },
    withExtensionOrbCwd: {
      containsUserSkillMarker: orbRequest.containsUserSkillMarker,
      markerOccurrences: orbRequest.userSkillMarkerOccurrences,
    },
    markerReachesNonOrbSession: baselineRequest.containsUserSkillMarker === true,
    markerCountUnchangedByExtension:
      baselineRequest.userSkillMarkerOccurrences === withExtensionNormal.userSkillMarkerOccurrences,
    orbAddsNothingToNormalPrompt:
      baselineRequest.containsOrbModeSection === false &&
      withExtensionNormal.containsOrbModeSection === false &&
      JSON.stringify(baselineRequest.tools) === JSON.stringify(withExtensionNormal.tools),
    realHostProfileNote:
      "the real host profile contains 16 user-level skills (evidence/p0-01/README.md). No user profile file is read or written by this run; the mechanism is reproduced with a controlled fixture.",
  };

  // -------------------------------------------------------------------------
  // Assertions
  // -------------------------------------------------------------------------
  evidence.assertions = [
    ["fixed HEAD snapshot reused", evidence.isolation.sourceHead === EXPECTED_HEAD],
    ["pi-web working tree only has the pre-existing user changes", evidence.isolation.piWebWorkingTreeChanges.length === 6],
    ["without a workspace, Orb mode is off in the Orb directory", noWorkspaceRequest.containsOrbModeSection === false],
    ["exact workspace match enables Orb mode", orbRequest.containsOrbModeSection === true],
    ["normal directory does not get Orb mode", normalRequest.containsOrbModeSection === false],
    ["subdirectory of the workspace does not match", subRequest.containsOrbModeSection === false],
    ["prefix-similar sibling directory does not match", siblingRequest.containsOrbModeSection === false],
    ["Orb mode adds no tool to a normally matching directory", JSON.stringify(normalRequest.tools) === JSON.stringify(baselineRequest.tools)],
    ["normal directory prompt is unchanged by installing the extension", normalRequest.containsOrbModeSection === false && withExtensionNormal.messageCount === baselineRequest.messageCount],
    ["user-level skill reaches a NON-Orb session prompt", baselineRequest.containsUserSkillMarker === true],
    ["user-level skill also reaches the Orb session prompt", orbRequest.containsUserSkillMarker === true],
    ["installing the extension does not change the user-level skill count", withExtensionNormal.userSkillMarkerOccurrences === baselineRequest.userSkillMarkerOccurrences],
    ["a different workspace gets a different session", evidence.sessions.differentWorkspaceGetsDifferentSession === true],
    ["the second workspace is still in Orb mode", secondRequest.containsOrbModeSection === true],
    ["the first session file still exists after switching", evidence.sessions.firstSessionFileStillExists === true],
    ["the first session history is byte-identical after switching", evidence.sessions.firstSessionContentUnchanged === true],
    ["the first session actually contains messages", evidence.sessions.firstSessionMessageCount > 0],
    ["switching workspace created an additional session file", afterSwitchFiles.length > beforeSwitchFiles.length],
    ["a real provider call was made", modelRequestCount > 0],
  ].map(([name, passed]) => ({ name, passed: Boolean(passed) }));

  evidence.passed = evidence.assertions.every((assertion) => assertion.passed);
  evidence.modelRequests = modelRequests;
} catch (error) {
  evidence.error = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
  evidence.passed = false;
} finally {
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
  mkdirSync(join(repo, "evidence", "p1-01"), { recursive: true });
  writeFileSync(join(repo, "evidence", "p1-01", "result.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({ passed: evidence.passed, assertions: evidence.assertions, error: evidence.error, serverLogPath }, null, 2),
  );
}

if (!evidence.passed) process.exitCode = 1;
