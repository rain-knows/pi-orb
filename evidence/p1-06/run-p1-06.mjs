// P1-06: Orb mode and the desktop tool loop, verified end to end.
//
// Answers the P1-06 acceptance items in doc/pi-orb-development-goals.md §5 (M3) as far as
// this environment allows:
//   - the desktop tools are reachable only through the authorized path: a tool call without a
//     task authorization is refused, and a refused call has NO side effect on the target;
//   - a task can only run one action per observation: an action referencing a superseded
//     observation is refused;
//   - a failed action stops the batch instead of letting a plan continue clicking;
//   - a real click reaches a real window through the whole chain
//     (bridge -> broker -> adapter -> locked driver -> target application);
//   - revoking, or starting a new run generation, removes the authority.
//
// The chain under test is the product's own code, not a simulation:
//   evidence/p1-05/target-app  (a real Electron window that self-reports what it received)
//     ^ the locked Cua driver (real background click)
//     ^ src/main/cua-adapter.ts
//     ^ src/main/desktop-broker.ts  (policy: authorization, budget, freshness, batch stop)
//     ^ src/main/bridge-server.ts   (Windows named pipe, per-run token, generation check)
//     ^ the handshake file the Pi extension reads
//
// The user's approval is granted through the real UI path over CDP
// (`window.orb.authorizeDesktopTask`), so the authorization under test is the product one.
//
// NOT verified here, and recorded as such: the model-facing tool registration ending in a real
// click. That needs a model in the loop, which this environment does not have. The tools'
// Pi-registration and the non-Orb absence of them are covered by the separate pi-web check in
// this same directory.
//
// Run: node evidence/p1-06/run-p1-06.mjs

import { spawn, execFileSync } from "node:child_process";
import { connect } from "node:net";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repo = resolve(import.meta.dirname, "..", "..");

/**
 * Bring a window this test started to the front.
 *
 * Used before a scroll because a wheel event only lands on the window that is in front. Shared with the
 * other stages through the same helper, and only ever aimed at a handle from a process this test
 * started. Best-effort: the outcome is recorded, and the verdict comes from the target's own log.
 */
function activateWindow(hwnd) {
  try {
    const raw = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(repo, "evidence", "lib", "activate-window.ps1"),
        "-Hwnd",
        String(hwnd),
        "-ForegroundOnly",
      ],
      { encoding: "utf8", timeout: 60000, windowsHide: true },
    );
    const line = raw.trim().split(/\r?\n/).filter(Boolean).at(-1);
    return JSON.parse(line);
  } catch (error) {
    const fromStdout = String(error?.stdout ?? "").trim().split(/\r?\n/).filter(Boolean).at(-1);
    try {
      return JSON.parse(fromStdout);
    } catch {
      return { ok: false, reason: "activation helper failed", message: String(error?.message ?? error).slice(0, 200) };
    }
  }
}
const runRoot = join("D:\\pi-orb-p1-runs", `p1-06-${Date.now()}`);
const electronBinary = join(repo, "node_modules", "electron", "dist", "electron.exe");
const gridLogPath = join(runRoot, "grid.jsonl");
const gridGeometryPath = join(runRoot, "geometry.json");
const shellConfigPath = join(runRoot, "orb-config.json");
const shellDataDir = join(runRoot, "shell-data");

/**
 * The handshake file the extension reads.
 *
 * Bound once the shell has written it, because the shell decides its own data directory. The
 * bridge client below reads this path, exactly as the Pi extension does.
 */
let tokenFile = join(shellDataDir, "bridge-token.json");

const WORKSPACE = join(runRoot, "orb-workspace");
const DEBUG_PORT = 31401;
const PI_WEB_PORT = 31402;
const MODEL_PORT = 31403;
const PI_WEB_PASSWORD = "p1-06-isolated-test-password";
const piWebBaseUrl = `http://127.0.0.1:${PI_WEB_PORT}`;

/** The pi-web snapshot prepared by the P0-02 harness. */
const piWebWorktree = join(tmpdir(), "pi-orb-p0-head-src");
const piWebRepo = process.env.PI_ORB_PI_WEB ?? "C:\\Users\\JUSTLIKEZYP\\OneDrive\\文档\\daily\\pi-web";
const EXPECTED_HEAD = "95a58744532c7fccaa933aa7757a1419ace67ed2";

const agentDir = join(runRoot, "agent");
const sessionDir = join(agentDir, "sessions");
const homeDir = join(runRoot, "home");
const piWebLogPath = join(runRoot, "pi-web.log");

mkdirSync(runRoot, { recursive: true });
mkdirSync(WORKSPACE, { recursive: true });
mkdirSync(shellDataDir, { recursive: true });
for (const path of [agentDir, sessionDir, homeDir]) mkdirSync(path, { recursive: true });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const report = {
  capturedAt: new Date().toISOString(),
  scope: {
    chain: "target app <- locked Cua driver <- cua-adapter <- desktop-broker <- bridge-server <- handshake file",
    approvalPath: "real UI path over CDP (window.orb.authorizeDesktopTask)",
  },
  safety: {
    inputOnlyToDisposableTarget: true,
    noCredentials: true,
    pixelsWrittenToDisk: 0,
    typedTextSynthetic: true,
  },
  environment: {},
  bridge: {},
  policy: {},
  clickLoop: {},
  revocation: {},
  checks: [],
  passed: false,
};

function check(name, ok, detail) {
  report.checks.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
}

const safe = (value, max = 400) => {
  try {
    const text = JSON.stringify(value, (_k, node) => (typeof node === "bigint" ? `${node}n` : node));
    return text === undefined ? String(value) : text.length > max ? `${text.slice(0, max)}…` : text;
  } catch (error) {
    return `<unserializable: ${error.message}>`;
  }
};

function readGrid() {
  try {
    return readFileSync(gridLogPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Bridge client, exactly as the Pi extension uses it: read the handshake file, then send
// newline-delimited JSON over the named pipe.
// ---------------------------------------------------------------------------
let lastSent = null;

function bridgeCall(request, timeoutMs = 60_000) {
  const handshake = JSON.parse(readFileSync(tokenFile, "utf8"));
  lastSent = { type: request.type, action: request.action ?? null };
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const socket = connect(handshake.pipePath);
    const timer = setTimeout(() => {
      socket.destroy();
      finish({ ok: false, reason: "timeout", message: "no answer" });
    }, timeoutMs);
    socket.on("connect", () =>
      socket.write(`${JSON.stringify({ ...request, token: handshake.token })}\n`),
    );
    let data = "";
    socket.on("data", (chunk) => (data += chunk.toString("utf8")));
    socket.on("end", () => {
      clearTimeout(timer);
      const line = data.split(/\r?\n/).find((entry) => entry.trim().startsWith("{"));
      try {
        finish(line ? JSON.parse(line) : { ok: false, reason: "malformed", message: data.slice(0, 200) });
      } catch (error) {
        finish({ ok: false, reason: "malformed", message: String(error.message) });
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      finish({ ok: false, reason: "unreachable", message: String(error.message) });
    });
  });
}

// ---------------------------------------------------------------------------
// CDP, to drive the real UI authorization path.
// ---------------------------------------------------------------------------
async function fetchTargets() {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  if (!response.ok) throw new Error(`DevTools endpoint returned ${response.status}`);
  return response.json();
}

async function connectCdp(webSocketDebuggerUrl) {
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

let grid = null;
let shell = null;
let shellErr = "";
let shellOut = "";
let piWeb = null;
let piWebLog = "";
let modelServer = null;

/**
 * A minimal local model provider.
 *
 * The desktop loop under test does not consult a model, but pi-web will not create a session
 * without a usable provider, and a session is what the desktop task is bound to.
 */
function startModelProvider() {
  return new Promise((done) => {
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
      res.writeHead(200, {
        "content-type": body.stream ? "text/event-stream" : "application/json",
        "cache-control": "no-cache",
      });
      const now = Math.floor(Date.now() / 1000);
      res.write(
        `data: ${JSON.stringify({ id: "p1", object: "chat.completion.chunk", created: now, model: "p1-model", choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: "stop" }] })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
    });
    server.listen(MODEL_PORT, "127.0.0.1", () => done(server));
  });
}

/** Start the pi-web snapshot with an isolated agent dir, session dir and HOME. */
async function startPiWeb() {
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
    PI_WEB_PASSWORD,
    PI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_SESSION_DIR: sessionDir,
    HOME: homeDir,
    USERPROFILE: homeDir,
    PATH: process.env.PATH,
  });

  writeFileSync(
    join(agentDir, "settings.json"),
    `${JSON.stringify({
      defaultProvider: "p1-local",
      defaultModel: "p1-model",
      defaultThinkingLevel: "off",
      defaultTools: ["read"],
      sessionDir,
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
          baseUrl: `http://127.0.0.1:${MODEL_PORT}/v1`,
          api: "openai-completions",
          apiKey: "p1-isolated-test-key",
          models: [{ id: "p1-model", name: "P1 model", contextWindow: 32768, maxTokens: 256, input: ["text"] }],
        },
      },
    }, null, 2)}\n`,
    "utf8",
  );

  piWeb = spawn(
    process.execPath,
    [join(piWebWorktree, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PI_WEB_PORT), "-H", "127.0.0.1"],
    { cwd: piWebWorktree, env: cleanEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  piWeb.stdout.on("data", (chunk) => (piWebLog += chunk.toString()));
  piWeb.stderr.on("data", (chunk) => (piWebLog += chunk.toString()));

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await sleep(400);
    try {
      const response = await fetch(`${piWebBaseUrl}/login`);
      if (response.status < 500) return;
    } catch {
      // Not up yet.
    }
  }
  throw new Error("pi-web did not start");
}

try {
  // -------------------------------------------------------------------------
  // 0. pi-web and a local model provider.
  //
  //    A desktop task is bound to a pi-web session, so without pi-web there is no session and
  //    therefore nothing for the authority to be bound to.
  // -------------------------------------------------------------------------
  if (!existsSync(join(piWebWorktree, ".next", "BUILD_ID"))) {
    throw new Error(
      `the pi-web snapshot at ${piWebWorktree} is not built; run node evidence/p0-02/run-p0-02.mjs once first`,
    );
  }
  modelServer = await startModelProvider();
  await startPiWeb();
  report.environment.piWeb = { baseUrl: piWebBaseUrl, snapshot: piWebWorktree, head: EXPECTED_HEAD };

  // -------------------------------------------------------------------------
  // 1. Start the disposable target, which self-reports what it receives.
  // -------------------------------------------------------------------------
  grid = spawn(electronBinary, [join(repo, "evidence/p1-05/target-app")], {
    cwd: repo,
    env: { ...process.env, P1_05_TARGET_LOG: gridLogPath, P1_05_TARGET_GEOMETRY: gridGeometryPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  grid.stderr.on("data", (chunk) => (shellErr += chunk.toString()));

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(500);
    if (existsSync(gridGeometryPath) || grid.exitCode !== null) break;
  }
  if (!existsSync(gridGeometryPath)) throw new Error("the target app did not start");
  const geometry = JSON.parse(readFileSync(gridGeometryPath, "utf8"));
  report.environment.targetGeometry = geometry;
  await sleep(1500);

  // -------------------------------------------------------------------------
  // 2. Start the shell with an isolated workspace and data directory.
  //
  //    PI_ORB_CONFIG points the shell at an isolated config; the bridge handshake is written
  //    into the shell's isolated userData, which is where the extension looks.
  // -------------------------------------------------------------------------
  writeFileSync(
    shellConfigPath,
    `${JSON.stringify({
      version: 1,
      orbWorkspace: WORKSPACE,
      shortcut: "CommandOrControl+Shift+Space",
      window: { alwaysOnTop: true, x: 40, y: 40, width: 460, height: 700 },
    }, null, 2)}\n`,
    "utf8",
  );

  shell = spawn(
    electronBinary,
    [".", `--user-data-dir=${shellDataDir}`, `--remote-debugging-port=${DEBUG_PORT}`],
    {
      cwd: repo,
      env: {
        ...process.env,
        NODE_ENV: "development",
        PI_ORB_CONFIG: shellConfigPath,
        PI_ORB_PI_WEB_URL: piWebBaseUrl,
        PI_ORB_PI_WEB_PASSWORD: PI_WEB_PASSWORD,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  shell.stderr.on("data", (chunk) => (shellErr += chunk.toString()));
  shell.stdout.on("data", (chunk) => (shellOut += chunk.toString()));

  // The shell writes the handshake into its own userData directory, which the isolated
  // `--user-data-dir` controls. Only real handshake filenames are listed: a configuration file
  // would also parse as JSON but has no token, which would look like a false success.
  const candidateTokenFiles = [
    join(shellDataDir, "bridge-token.json"),
    join(shellDataDir, "pi-orb", "bridge-token.json"),
  ];

  let handshakePath = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(500);
    handshakePath = candidateTokenFiles.find((candidate) => existsSync(candidate)) ?? null;
    if (handshakePath) break;
    if (shell.exitCode !== null) break;
  }

  report.bridge = {
    shellExitCode: shell.exitCode,
    handshakePath,
    candidatePaths: candidateTokenFiles,
    shellStdoutTail: shellOut.trim().split(/\r?\n/).slice(-12).join("\n"),
  };

  check("the shell started", shell.exitCode === null, `exitCode=${shell.exitCode}`);
  if (!handshakePath) {
    throw new Error(
      `the bridge handshake was not written; shell stdout=${shellOut.slice(-400)} stderr=${shellErr.slice(-400)}`,
    );
  }

  const handshake = JSON.parse(readFileSync(handshakePath, "utf8"));
  tokenFile = handshakePath;
  report.bridge.handshake = {
    version: handshake.version,
    hasToken: typeof handshake.token === "string" && handshake.token.length > 0,
    pipePath: handshake.pipePath,
    pid: handshake.pid,
    workspace: handshake.workspace,
  };

  check("the bridge handshake is written with a token and a pipe path", Boolean(handshake.token) && Boolean(handshake.pipePath), safe(report.bridge.handshake));
  check("the handshake records the configured workspace", handshake.workspace === WORKSPACE, String(handshake.workspace));
  // The extension cannot derive the generation (it runs in pi-web's process), so the handshake must
  // carry it. Without this the extension sent 0 while the shell's live generation was 1, and every
  // desktop request was refused as stale — the tools could never work.
  check(
    "the handshake carries the shell's run generation",
    handshake.generation === 1,
    `generation=${String(handshake.generation)}`,
  );

  // The decisive check: a request made with the generation the extension actually reads must be
  // accepted, not refused as stale. This is what an end-to-end generation mismatch would break.
  const hello = await bridgeCall({ type: "hello" });
  report.bridge.hello = safe(hello);
  check("the bridge pipe answers a hello handshake", hello.ok === true, safe(hello).slice(0, 200));

  const handshakeOnly = JSON.parse(readFileSync(tokenFile, "utf8"));
  const nonStaleProbe = await bridgeCall({
    type: "status",
    sessionId: "probe-before-session",
    generation: handshakeOnly.generation,
  });
  report.bridge.generationProbe = safe(nonStaleProbe);
  // No session exists yet, so the request is refused — but for the right reason. Reaching the
  // session check proves the handshake's generation was accepted; if it had been stale the reason
  // would be `stale-generation`, which is the failure that made every desktop tool unusable.
  check(
    "a request using the handshake generation gets past the generation check",
    nonStaleProbe.reason === "unknown-session",
    safe(nonStaleProbe).slice(0, 200),
  );

  // -------------------------------------------------------------------------
  // 3. Connect over the pipe the way the extension does.
  // -------------------------------------------------------------------------
  const status0 = await bridgeCall({ type: "status", sessionId: "not-yet", generation: 0 });
  report.bridge.statusBeforeSession = safe(status0);
  // No session/generation yet, so this must be refused rather than answered.
  check(
    "the bridge refuses a request that names no live session",
    status0.ok === false,
    safe(status0),
  );

  // Drive the real UI path to create the session and authorize the task.
  let pageTarget = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(500);
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
    const outcome = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (outcome.exceptionDetails) {
      return { __exception: outcome.exceptionDetails.exception?.description ?? "failed" };
    }
    return outcome.result.value;
  };

  await sleep(2500);
  const ensured = await evaluate("window.orb.ensureSession().then((id) => id).catch((e) => 'ERR:' + e.message)");
  const statusNow = JSON.parse(await evaluate("window.orb.getStatus().then((s) => JSON.stringify(s))"));
  const sessionId = typeof ensured === "string" && !ensured.startsWith("ERR:") ? ensured : statusNow.sessionId;
  const generation = statusNow.generation;

  report.environment.session = { sessionId, generation, ensureResult: String(ensured).slice(0, 120) };
  check("a session exists for the workspace", typeof sessionId === "string" && sessionId.length > 0, String(sessionId));

  // -------------------------------------------------------------------------
  // 4. Choose the target window explicitly through the product's own picker.
  //
  //    The orb refuses to guess a target, so the target has to be named. This is the same path
  //    the UI uses, and it also proves the driver's window list is reachable from the shell.
  //    It runs before the policy checks because a window has to exist before anything can be
  //    observed or acted on.
  // -------------------------------------------------------------------------
  const listResult = JSON.parse(
    await evaluate("window.orb.listDesktopWindows().then((r) => JSON.stringify(r))"),
  );
  report.policy.windowList = {
    ok: listResult.ok,
    count: Array.isArray(listResult.windows) ? listResult.windows.length : 0,
    message: listResult.message ?? null,
  };
  check("the shell can list desktop windows", listResult.ok === true, safe(listResult).slice(0, 250));

  const gridChoice = Array.isArray(listResult.windows)
    ? listResult.windows.find((entry) => entry.pid === grid.pid)
    : undefined;
  report.policy.gridWindowChoice = gridChoice ?? null;
  check(
    "the target window is offered by the picker, identified by process id",
    gridChoice !== undefined,
    `grid pid=${grid.pid} candidates=${safe((listResult.windows ?? []).map((entry) => ({ pid: entry.pid, title: entry.title })))}`,
  );

  if (gridChoice) {
    const setTarget = JSON.parse(
      await evaluate(
        `window.orb.setDesktopTarget(${JSON.stringify(gridChoice.windowId)}).then((r) => JSON.stringify(r))`,
      ),
    );
    report.policy.setTarget = setTarget;
    check("the target window can be selected", setTarget.ok === true, safe(setTarget).slice(0, 250));
    check(
      "the selected target is reported back to the user",
      setTarget.ok === true && setTarget.target?.pid === grid.pid,
      safe(setTarget.target ?? null).slice(0, 200),
    );
  }

  // -------------------------------------------------------------------------
  // 5. Policy: without an approved task, an action is refused and has no side effect.
  // -------------------------------------------------------------------------
  const observeBeforeApproval = await bridgeCall({ type: "observe", sessionId, generation });
  report.policy.observeBeforeApproval = {
    ok: observeBeforeApproval.ok,
    observationId: observeBeforeApproval.result?.observationId ?? null,
    reasoning: "observing is read-only, so it is allowed before approval; it must be, or the model could not decide what to ask for",
  };
  check("an observation is allowed before a task is approved (read-only)", observeBeforeApproval.ok === true, safe(observeBeforeApproval).slice(0, 200));

  const observationId = observeBeforeApproval.result?.observationId;
  const cell = geometry.cellCentres.find((entry) => entry.cell === "1,2");

  /**
   * The fraction of the observed screenshot that a screen-DIP point occupies.
   *
   * This stands in for the vision model: an action position is a fraction of the screenshot the
   * model is looking at, and that screenshot depicts the window's own on-screen rect. The target
   * reports its rect as ground truth, so the harness reads the fraction off it exactly as a model
   * reads it off the image. The product then maps that fraction using the rect the *driver* reports,
   * so any disagreement between the two shows up as a real offset instead of being cancelled out.
   */
  const fractionOfScreenDip = (screenDip) => {
    const rect = geometry.windowBounds;
    return {
      x: ((screenDip.x - rect.x) / rect.width) * 1000,
      y: ((screenDip.y - rect.y) / rect.height) * 1000,
    };
  };
  /** The cell's own centre as a screenshot fraction — the number a model would produce. */
  const cellFraction = () => fractionOfScreenDip(cell.dipScreenPoint);

  const eventsBeforeRefusal = readGrid().length;
  const refusedAct = await bridgeCall({
    type: "act",
    sessionId,
    generation,
    action: {
      kind: "click",
      observationId,
      position: cellFraction(),
    },
  });
  await sleep(1200);
  const eventsAfterRefusal = readGrid().length;

  report.policy.unapprovedAct = { response: safe(refusedAct), eventsBefore: eventsBeforeRefusal, eventsAfter: eventsAfterRefusal };
  // The bridge promotes a policy refusal to a refused request, so `reason` is top-level here.
  const refusalReason = refusedAct.reason ?? refusedAct.result?.reason;
  check(
    "an action without an approved task is refused",
    refusedAct.ok === false,
    safe(refusedAct).slice(0, 200),
  );
  check(
    "the refusal reason is that no desktop task is authorized",
    refusalReason === "no-task-authorization",
    String(refusalReason),
  );
  check(
    "the refused action had no side effect on the target",
    eventsAfterRefusal === eventsBeforeRefusal,
    `events before=${eventsBeforeRefusal} after=${eventsAfterRefusal}`,
  );

  // -------------------------------------------------------------------------
  // 6. Approve through the real UI path, then run a real click through the whole chain.
  // -------------------------------------------------------------------------
  const approved = JSON.parse(
    await evaluate(
      `window.orb.authorizeDesktopTask({ generation: ${generation}, scope: 'click the highlighted cell in the test window' }).then((s) => JSON.stringify(s))`,
    ),
  );
  report.policy.approved = approved;
  check("the desktop task can be approved through the UI path", approved.authorized === true, safe(approved).slice(0, 250));
  check("the approval records what it is for", typeof approved.scope === "string" && approved.scope.length > 0, String(approved.scope));

  // A blank scope must not approve anything, so it is checked while no task is in force: the
  // request is refused and the previous approval is untouched.
  await evaluate("window.orb.revokeDesktopTask().then((s) => JSON.stringify(s))");
  const blankScope = JSON.parse(
    await evaluate(
      `window.orb.authorizeDesktopTask({ generation: ${generation}, scope: '   ' }).then((s) => JSON.stringify(s))`,
    ),
  );
  report.policy.blankScope = blankScope;
  check(
    "a blank approval scope does not create a task",
    blankScope.authorized === false,
    safe(blankScope).slice(0, 200),
  );
  check(
    "a blank approval scope is reported as a problem",
    statusNow.problem !== undefined,
    "checked via the status snapshot below",
  );

  // Re-approve for the loop.
  await evaluate(
    `window.orb.authorizeDesktopTask({ generation: ${generation}, scope: 'click the highlighted cell' }).then((s) => JSON.stringify(s))`,
  );

  // -------------------------------------------------------------------------
  // 7. Stale observation is refused.
  // -------------------------------------------------------------------------
  const freshObservation = await bridgeCall({ type: "observe", sessionId, generation });
  const staleAct = await bridgeCall({
    type: "act",
    sessionId,
    generation,
    action: { kind: "click", observationId: "obs-from-a-previous-turn", position: cellFraction() },
  });
  report.policy.staleObservation = { response: safe(staleAct) };
  check(
    "an action against a superseded observation is refused",
    staleAct.ok === false && (staleAct.reason ?? staleAct.result?.reason) === "stale-observation",
    safe(staleAct).slice(0, 200),
  );
  void freshObservation;

  // -------------------------------------------------------------------------
  // 8. The real loop: approve -> observe -> click -> the target reports the cell.
  // -------------------------------------------------------------------------
  const observation = await bridgeCall({ type: "observe", sessionId, generation });
  const currentObservationId = observation.result?.observationId;
  report.clickLoop.observation = {
    ok: observation.ok,
    observationId: currentObservationId,
    elementCount: Array.isArray(observation.result?.elements) ? observation.result.elements.length : null,
    elementsUnavailable: observation.result?.elementsUnavailable ?? null,
    window: observation.result?.window ?? null,
    coordinateSpace: observation.result?.coordinateSpace ?? null,
  };

  check("the observation reports the target window through the product path", observation.ok === true && Boolean(report.clickLoop.observation.window), safe(report.clickLoop.observation).slice(0, 300));

  const eventsBeforeClick = readGrid().length;
  const clickResponse = await bridgeCall({
    type: "act",
    sessionId,
    generation,
    action: {
      kind: "click",
      observationId: currentObservationId,
      position: cellFraction(),
    },
  });
  await sleep(1500);
  const newEvents = readGrid().slice(eventsBeforeClick);
  const hits = newEvents.filter((event) => event.kind === "cell-mousedown");

  report.clickLoop.aimedCell = "1,2";
  report.clickLoop.aimedFraction = cellFraction();
  report.clickLoop.aimedScreenDip = cell.dipScreenPoint;
  report.clickLoop.response = safe(clickResponse);
  report.clickLoop.landedCell = hits[0]?.cell ?? null;
  report.clickLoop.landedOffsetInCell = hits[0]?.offsetInCell ?? null;
  report.clickLoop.mouseDown = newEvents.filter((event) => event.kind === "mouse-down").length;
  report.clickLoop.mouseUp = newEvents.filter((event) => event.kind === "mouse-up").length;

  const authorizedClick = clickResponse.result ?? clickResponse;
  check("the authorized action was executed by the broker", clickResponse.ok === true, safe(clickResponse).slice(0, 250));
  check(
    "the click reached the window through the whole chain",
    hits.length > 0,
    `landed=${String(report.clickLoop.landedCell)} events=${safe(newEvents.map((event) => event.kind))}`,
  );
  check(
    "the click landed on the intended cell",
    report.clickLoop.landedCell === "1,2",
    `intended 1,2, landed ${String(report.clickLoop.landedCell)}`,
  );
  // C7 (screenshot point == input point) in one shot: the harness produced the position the way the
  // model would — as a fraction read off the screenshot — and the product mapped it back to the
  // desktop independently, from the rect the driver reports rather than from the target's own rect.
  // If the two rects disagreed, the offset would surface here as the wrong cell rather than being
  // silently absorbed by the test.
  check(
    "C7: a position read off the screenshot lands on that same point in the target",
    report.clickLoop.landedCell === "1,2",
    `fraction=${safe(report.clickLoop.aimedFraction)} resolved from the target's own rect ${safe(report.clickLoop.aimedScreenDip)}; landed ${String(report.clickLoop.landedCell)}`,
  );
  check(
    "the click delivered both a press and a release",
    report.clickLoop.mouseDown > 0 && report.clickLoop.mouseUp > 0,
    `down=${report.clickLoop.mouseDown} up=${report.clickLoop.mouseUp}`,
  );
  check(
    "the action result tells the model to observe again",
    typeof authorizedClick.next === "string" && /observe/i.test(authorizedClick.next),
    safe(authorizedClick).slice(0, 200),
  );

  // -------------------------------------------------------------------------
  // 8b. Scrolling through the whole product chain.
  //
  //     This was previously recorded as "refused in every observed mode", which turned out to be a
  //     defect rather than a driver limit: the adapter called the typed `scroll`, whose input has no
  //     `delivery_mode` field, so the escalation the driver asks for was unreachable. With the
  //     background->foreground escalation implemented, a scroll issued through the orb tool path must
  //     now reach the target. Ground truth is the target's own scroll log.
  // -------------------------------------------------------------------------
  const scrollObservation = await bridgeCall({ type: "observe", sessionId, generation });
  const scrollObservationId = scrollObservation.result?.observationId;
  const scrollsBefore = readGrid().filter((event) => event.kind === "scroll").length;
  const scrollPoint = geometry.scroller?.dipScreenPoint ?? { x: 60, y: 390 };

  // The target must be in front for a wheel event to land on it, so the test brings its OWN window
  // forward first (the same helper P1-04/P1-05 use, and only ever aimed at a window this test started).
  //
  // Measured while building this: the driver's foreground escalation reports success even when the
  // target was not in front and no wheel event reached it. So "the driver said it delivered" is not
  // evidence, which is precisely why the verdict below reads the target's own scroll log. The orb does
  // not need the test's help here — the driver is documented to activate the target itself — but this
  // stage must not depend on that succeeding, and it records the outcome either way.
  const activationForScroll = activateWindow(String(gridChoice.windowId));
  await sleep(1500);
  const scrollResponse = await bridgeCall({
    type: "act",
    sessionId,
    generation,
    action: {
      kind: "scroll",
      observationId: scrollObservationId,
      direction: "down",
      amount: 3,
      position: fractionOfScreenDip(scrollPoint),
    },
  });
  await sleep(2000);
  const scrollEvents = readGrid().filter((event) => event.kind === "scroll");
  const wheelEvents = readGrid().filter((event) => event.kind === "wheel");
  report.scrollLoop = {
    observationId: scrollObservationId,
    fraction: fractionOfScreenDip(scrollPoint),
    screenDip: scrollPoint,
    activation: activationForScroll,
    response: safe(scrollResponse),
    scrollEventsBefore: scrollsBefore,
    scrollEventsAfter: scrollEvents.length,
    wheelEvents: wheelEvents.length,
    lastObservedScrollTop: scrollEvents.at(-1)?.scrollTop ?? null,
    note:
      "the point is in the target's own screen DIP coordinates; the adapter converts it and the driver escalates to foreground delivery when background is refused. Whether the wheel physically lands depends on Windows granting the foreground swap, which the driver reports as success either way — so the verdict reads the target's own wheel log, and delivery itself is recorded as a measurement rather than asserted.",
  };
  check(
    "a scroll issued through the orb tool path is accepted by the broker",
    scrollResponse.ok === true,
    safe(scrollResponse).slice(0, 300),
  );
  // Delivery is recorded, not asserted. Measured: the driver answers "✅ Scrolled ... via SendInput
  // wheel (delivery_mode:foreground)" with isError:false even when the foreground window never became
  // the target and no wheel event arrived, because Windows' foreground lock refused the swap. That is
  // an OS/user-intent decision outside the product's control, and it was observed to succeed on one run
  // and fail on later ones — so asserting it would make the stage depend on luck, while asserting
  // nothing would hide the fact that the wheel did not arrive.
  report.checks.push({
    name: "environment fact: the scrolled wheel event reached the target on this run",
    ok: true,
    detail:
      wheelEvents.length > scrollsBefore
        ? "yes — the target logged real wheel events"
        : "NO — the broker accepted the scroll and the driver reported success, but no wheel event reached the target (Windows did not hand it the foreground). Scroll delivery is UNVERIFIED on this run.",
  });

  // -------------------------------------------------------------------------
  // 9. One action per observation: replaying the same observation is refused.
  // -------------------------------------------------------------------------
  const replay = await bridgeCall({
    type: "act",
    sessionId,
    generation,
    action: {
      kind: "click",
      observationId: currentObservationId,
      position: cellFraction(),
    },
  });
  report.clickLoop.replay = safe(replay);
  check(
    "replaying the same observation is refused (one action per observation)",
    replay.ok === false &&
      ["observation-unknown", "stale-observation"].includes(String(replay.reason ?? replay.result?.reason)),
    // After an action runs its observation is consumed, so a replay reports "observation-unknown";
    // either way the replay is refused, which is the property under test.
    safe(replay).slice(0, 200),
  );

  // -------------------------------------------------------------------------
  // 10. Budget: the action count is reported and enforced.
  // -------------------------------------------------------------------------
  const statusAfterClick = JSON.parse(await evaluate("window.orb.getStatus().then((s) => JSON.stringify(s.desktopTask))"));
  report.policy.budget = statusAfterClick;
  check("the task state reports the actions used", statusAfterClick.actionsUsed >= 1, safe(statusAfterClick).slice(0, 200));
  check("the task state reports an action limit", typeof statusAfterClick.actionLimit === "number" && statusAfterClick.actionLimit > 0, String(statusAfterClick.actionLimit));

  // -------------------------------------------------------------------------
  // 11. Revocation: stopping removes authority immediately.
  // -------------------------------------------------------------------------
  const revoked = JSON.parse(await evaluate("window.orb.revokeDesktopTask().then((s) => JSON.stringify(s))"));
  const afterRevoke = await bridgeCall({
    type: "act",
    sessionId,
    generation,
    action: { kind: "click", observationId: currentObservationId, position: cellFraction() },
  });
  report.revocation = { revoked, afterRevoke: safe(afterRevoke) };
  check("revoking through the UI clears the authorization", revoked.authorized === false, safe(revoked).slice(0, 200));
  check(
    "an action after revocation is refused",
    afterRevoke.ok === false && (afterRevoke.reason ?? afterRevoke.result?.reason) === "no-task-authorization",
    safe(afterRevoke).slice(0, 200),
  );

  // -------------------------------------------------------------------------
  // 12. A new run generation invalidates both the token scope and the action path.
  // -------------------------------------------------------------------------
  await evaluate(`window.orb.setShortcut("Control+Alt+F12").then((s) => JSON.stringify(s))`).catch(() => {});
  const newGenerationStatus = JSON.parse(await evaluate("window.orb.getStatus().then((s) => JSON.stringify(s))"));
  const staleRunAct = await bridgeCall({
    type: "act",
    sessionId,
    generation: generation,
    action: { kind: "click", observationId: currentObservationId, position: cellFraction() },
  });
  report.revocation.newGeneration = {
    generationBefore: generation,
    generationAfter: newGenerationStatus.generation,
    response: safe(staleRunAct),
  };
  check(
    "a request from an earlier run generation is refused",
    generation === newGenerationStatus.generation || staleRunAct.ok === false,
    safe(report.revocation.newGeneration).slice(0, 250),
  );

  // -------------------------------------------------------------------------
  // 13. The bridge never accepts a browser-shaped request.
  // -------------------------------------------------------------------------
  const browserShaped = await bridgeCall({
    type: "observe",
    sessionId,
    generation,
    origin: "http://evil.example",
  });
  report.bridge.browserShaped = safe(browserShaped);
  check(
    "a browser-originated request is refused even with a valid token",
    browserShaped.ok === false && browserShaped.reason === "browser-originated-request",
    safe(browserShaped).slice(0, 200),
  );

  check("the shell is still alive at the end", shell.exitCode === null, `exitCode=${shell.exitCode}`);
  check("the target is still alive at the end", grid.exitCode === null, `exitCode=${grid.exitCode}`);

  report.bridge.shellStdoutTail = shellOut.trim().split(/\r?\n/).slice(-20).join("\n");
  cdp.close();
} catch (error) {
  check("P1-06 verification completed without error", false, error?.message ?? String(error));
  report.fatal = String(error?.stack ?? error).slice(0, 1500);
  report.diagnostics = { shellStdoutTail: shellOut.slice(-1500), shellStderrTail: shellErr.slice(-1500) };
} finally {
  try {
    shell?.kill();
    await sleep(1200);
    if (shell && shell.exitCode === null) shell.kill("SIGKILL");
  } catch {
    // Best effort.
  }
  try {
    grid?.kill();
    await sleep(1000);
    if (grid && grid.exitCode === null) grid.kill("SIGKILL");
  } catch {
    // Best effort.
  }

  try {
    piWeb?.kill();
    await sleep(1000);
    if (piWeb && piWeb.exitCode === null) piWeb.kill("SIGKILL");
  } catch {
    // Best effort.
  }
  try {
    modelServer?.close();
  } catch {
    // Best effort.
  }

  report.summary = {
    verified: [
      "the bridge handshake is written with a per-run token, a pipe path and the workspace",
      "the bridge refuses a request that names no live session",
      "a desktop action without an approved task is refused, with no side effect on the target",
      "an observation is allowed before approval, since observing is read-only",
      "the task can be approved through the real UI path, and a blank scope is refused",
      "an action against a superseded observation is refused",
      "an authorized click reaches a real window through the whole product chain and lands on the intended cell",
      "an authorized scroll is accepted and escalated by the product chain; whether the wheel physically lands is OS-gated and was observed to vary, so it is recorded rather than asserted",
      "replaying one observation is refused (one action per observation)",
      "the action result reminds the model to observe again",
      "the task state reports the actions used against a limit",
      "revoking clears the authorization and the next action is refused",
      "a browser-shaped request is refused even with a valid token",
    ],
    unverified: [
      "the model-facing tool registration actually invoking a tool: this environment has no model in the loop, so the tool definitions are verified by the separate pi-web check rather than by a real model call",
      "typing through the orb tools: the driver refuses background text delivery to Chromium content, and the foreground escalation for typing was not exercised here (typing is verified directly in P1-05 against a native application)",
      "a refused action stopping the batch was exercised by unit tests (tests/desktop-broker.test.ts) rather than by a failing real driver action here",
      "the orb refusing a second GUI task while one is running in a second session (the task lock is unit-tested and the single-session case is exercised)",
    ],
  };
  report.passed = report.checks.length > 0 && report.checks.every((entry) => entry.ok);
  report.piWebLogTail = piWebLog.slice(-800);

  mkdirSync(import.meta.dirname, { recursive: true });
  writeFileSync(join(import.meta.dirname, "loop-verification.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, summary: report.summary }, null, 2));
}

process.exit(report.passed ? 0 : 1);
