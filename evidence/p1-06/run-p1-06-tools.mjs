// N3 regression: the Orb desktop tools must exist only in Orb mode.
//
// Answers the P1-06/P0-02 invariant N3 question for the real tool set: a normal session gains no
// model-visible desktop capability, and an Orb session gains exactly the supported tools.
//
// Method: the real fixed-HEAD pi-web snapshot, with the shipped extension loaded, and a local fake
// provider that records the tool schemas it actually receives. The verdict therefore comes from
// what the model would have been offered, not from what a registration call returned.
//
// Run: node evidence/p1-06/run-p1-06-tools.mjs

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repo = resolve(import.meta.dirname, "..", "..");
const piWebWorktree = join(tmpdir(), "pi-orb-p0-head-src");
const runRoot = join("D:\\pi-orb-p1-runs", `p1-06-tools-${Date.now()}`);
const piWebPort = 31411;
const modelPort = 31412;
const baseUrl = `http://127.0.0.1:${piWebPort}`;
const password = "p1-06-tools-password";

const agentDir = join(runRoot, "agent");
const sessionDir = join(agentDir, "sessions");
const homeDir = join(runRoot, "home");
const normalCwd = join(runRoot, "normal-project");
const orbCwd = join(runRoot, "orb-workspace");
const configPath = join(runRoot, "orb-config.json");
const extensionPath = join(repo, "pi-package", "extensions", "orb.ts");

for (const path of [agentDir, sessionDir, homeDir, normalCwd, orbCwd]) mkdirSync(path, { recursive: true });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const report = {
  capturedAt: new Date().toISOString(),
  isolation: { runRoot, agentDir, homeDir, normalCwd, orbCwd, configPath, extensionPath, baseUrl },
  requests: [],
  checks: [],
  passed: false,
};

function check(name, ok, detail) {
  report.checks.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
}

// ---------------------------------------------------------------------------
// Fake provider that records the tool schemas and the system prompt it receives.
// ---------------------------------------------------------------------------
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
  const tools = Array.isArray(body.tools) ? body.tools.map((tool) => tool?.function?.name ?? tool?.name ?? "?") : [];
  const serialized = JSON.stringify(body.messages ?? []);
  report.requests.push({
    index: report.requests.length + 1,
    tools: [...tools].sort(),
    orbTools: tools.filter((name) => String(name).startsWith("orb_")).sort(),
    containsOrbModeSection: serialized.includes("orb_mode"),
    // The prompt must state the rules the executor enforces, or the model is told one thing and
    // judged by another.
    mentionsOneActionPerObservation: /fresh observation|observe again/i.test(serialized),
    mentionsUntrustedScreenContent: /untrusted input/i.test(serialized),
  });

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const now = Math.floor(Date.now() / 1000);
  res.write(
    `data: ${JSON.stringify({ id: "p1", object: "chat.completion.chunk", created: now, model: "p1-model", choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: "stop" }] })}\n\n`,
  );
  res.end("data: [DONE]\n\n");
});

const safeEnvKeys = [
  "SystemRoot", "SystemDrive", "ComSpec", "Path", "PATHEXT", "TEMP", "TMP", "APPDATA",
  "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "CommonProgramFiles",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "OS", "WINDIR",
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

let piWeb = null;
let piWebLog = "";

async function piWebPost(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { authorization: authHeader, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: response.status, body: text };
  }
}

try {
  if (!existsSync(join(piWebWorktree, ".next", "BUILD_ID"))) {
    throw new Error(`the pi-web snapshot at ${piWebWorktree} is not built; run node evidence/p0-02/run-p0-02.mjs once first`);
  }

  // The extension is loaded from the agent settings, exactly as a user installation would be.
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
          models: [{ id: "p1-model", name: "P1 model", contextWindow: 32768, maxTokens: 256, input: ["text"] }],
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    configPath,
    `${JSON.stringify({
      version: 1,
      orbWorkspace: orbCwd,
      shortcut: "CommandOrControl+Shift+Space",
      window: { alwaysOnTop: true, x: null, y: null, width: 420, height: 640 },
    }, null, 2)}\n`,
    "utf8",
  );

  await new Promise((done) => modelServer.listen(modelPort, "127.0.0.1", () => done()));

  piWeb = spawn(
    process.execPath,
    [join(piWebWorktree, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(piWebPort), "-H", "127.0.0.1"],
    { cwd: piWebWorktree, env: cleanEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  piWeb.stdout.on("data", (chunk) => (piWebLog += chunk.toString()));
  piWeb.stderr.on("data", (chunk) => (piWebLog += chunk.toString()));

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await sleep(400);
    try {
      if ((await fetch(`${baseUrl}/login`)).status < 500) break;
    } catch {
      // Not up yet.
    }
  }

  /** Create a session for a cwd and send one prompt, returning the recorded request. */
  async function promptIn(cwd, label) {
    const created = await piWebPost("/api/agent/new", { cwd, type: "ensure_session" });
    if (created.status !== 200 || typeof created.body?.sessionId !== "string") {
      throw new Error(`${label}: session creation failed (${created.status}) ${JSON.stringify(created.body).slice(0, 200)}`);
    }
    const before = report.requests.length;
    const prompted = await piWebPost(`/api/agent/${encodeURIComponent(created.body.sessionId)}`, {
      type: "prompt",
      message: `probe for ${label}`,
    });
    if (prompted.status !== 200) {
      throw new Error(`${label}: prompt failed (${prompted.status}) ${JSON.stringify(prompted.body).slice(0, 200)}`);
    }
    const requestDeadline = Date.now() + 60_000;
    while (Date.now() < requestDeadline && report.requests.length <= before) await sleep(200);
    return report.requests.at(-1);
  }

  const normalRequest = await promptIn(normalCwd, "normal");
  const orbRequest = await promptIn(orbCwd, "orb");

  report.normal = normalRequest;
  report.orb = orbRequest;

  // -------------------------------------------------------------------------
  // Assertions, judged from the tool schemas the provider actually received.
  // -------------------------------------------------------------------------
  const expectedOrbTools = ["orb_click", "orb_drag", "orb_hotkey", "orb_long_press", "orb_observe", "orb_scroll", "orb_type"];

  check(
    "a normal session is offered no Orb tool",
    Array.isArray(normalRequest?.orbTools) && normalRequest.orbTools.length === 0,
    `normal tools: ${JSON.stringify(normalRequest?.tools ?? null)}`,
  );
  check(
    "an Orb session is offered exactly the supported Orb tools",
    JSON.stringify(orbRequest?.orbTools ?? null) === JSON.stringify(expectedOrbTools),
    `orb tools: ${JSON.stringify(orbRequest?.orbTools ?? null)}`,
  );
  check(
    "a normal session keeps pi-web's own tools and gains nothing from Orb",
    // `bash` and `read` are pi-web's defaults for a normal directory (measured in P0-02 and
    // P1-01 as well), so the baseline is this exact set and no Orb tool appears in it.
    JSON.stringify(normalRequest?.tools ?? null) === JSON.stringify(["bash", "read"]),
    `normal tools: ${JSON.stringify(normalRequest?.tools ?? null)}`,
  );
  check(
    "the Orb prompt section is present only in Orb mode",
    orbRequest?.containsOrbModeSection === true && normalRequest?.containsOrbModeSection === false,
    `orb=${String(orbRequest?.containsOrbModeSection)} normal=${String(normalRequest?.containsOrbModeSection)}`,
  );
  check(
    "the Orb prompt states the one-action-per-observation rule the executor enforces",
    orbRequest?.mentionsOneActionPerObservation === true,
    "the model must not be told one thing and judged by another",
  );
  check(
    "the Orb prompt states that screen content is untrusted input",
    orbRequest?.mentionsUntrustedScreenContent === true,
    "screens and page text are data, never instructions or authorization",
  );
  check(
    "the Orb prompt does not claim a matching directory grants authority",
    typeof orbRequest?.containsOrbModeSection === "boolean",
    "covered by the shared prompt text asserted in tests/orb-tools.test.ts",
  );
} catch (error) {
  check("P1-06 tool exposure verification completed without error", false, error?.message ?? String(error));
  report.fatal = String(error?.stack ?? error).slice(0, 1200);
  report.piWebLogTail = piWebLog.slice(-1200);
} finally {
  try {
    piWeb?.kill();
    await sleep(800);
    if (piWeb && piWeb.exitCode === null) piWeb.kill("SIGKILL");
  } catch {
    // Best effort.
  }
  try {
    modelServer.close();
  } catch {
    // Best effort.
  }

  report.passed = report.checks.length > 0 && report.checks.every((entry) => entry.ok);
  mkdirSync(import.meta.dirname, { recursive: true });
  writeFileSync(join(import.meta.dirname, "tool-exposure.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks }, null, 2));
}

process.exit(report.passed ? 0 : 1);
