// P1-04: explicit-authorization screenshot context, verified end to end.
//
// Answers the P1-04 acceptance items in doc/pi-orb-development-goals.md §5 (M2):
//   - nothing is uploaded unless the user explicitly asks and then confirms;
//   - a failure to identify or capture the target window is reported and NEVER
//     degrades into a full-screen capture;
//   - a text-only model rejects an image task instead of silently ignoring it;
//   - the confirmed image lands in the orb's own session.
//
// What this run CAN and CANNOT prove, stated up front:
//   * The positive capture path (a real window captured, previewed, confirmed) is
//     NOT exercised here. This session has no genuine foreground window: the OS
//     reported `GetForegroundWindow() = 0` and `SetForegroundWindow` returned false,
//     so a real target cannot be established. That path stays unverified and is
//     recorded as such rather than simulated and called passing.
//   * Everything that governs whether an image may be uploaded IS exercised: the
//     refusal paths run through the real Electron main process and the real pi-web,
//     and the provider request log proves that a refused capture uploads nothing.
//   * Text-only rejection is tested by sending a synthetic image block through the
//     documented pi-web prompt API. That is a real test of the real model/agent
//     behaviour; the image is labelled synthetic and no screenshot is involved.
//
// Run: node evidence/p1-04/run-p1-04.mjs

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repo = resolve(import.meta.dirname, "..", "..");
const piWebRepo = process.env.PI_ORB_PI_WEB ?? "C:\\Users\\JUSTLIKEZYP\\OneDrive\\文档\\daily\\pi-web";
const EXPECTED_HEAD = "95a58744532c7fccaa933aa7757a1419ace67ed2";
const worktree = join(tmpdir(), "pi-orb-p0-head-src");
const runRoot = join("D:\\pi-orb-p1-runs", `p1-04-${Date.now()}`);

const piWebPort = 31301;
const modelPort = 31302;
const debugPort = 31303;
const baseUrl = `http://127.0.0.1:${piWebPort}`;
const password = "p1-04-isolated-test-password";

const agentDir = join(runRoot, "agent");
const sessionDir = join(agentDir, "sessions");
const homeDir = join(runRoot, "home");
const orbWorkspace = join(runRoot, "orb-workspace");
const configPath = join(runRoot, "orb-config.json");
const userDataDir = join(runRoot, "userData");
const serverLogPath = join(runRoot, "pi-web.log");
const extensionPath = join(repo, "pi-package", "extensions", "orb.ts");
const helperPath = join(repo, "src", "main", "native", "foreground-window.ps1");

for (const path of [agentDir, sessionDir, homeDir, orbWorkspace, userDataDir]) {
  mkdirSync(path, { recursive: true });
}

/** Build a genuine, tiny PNG so the image block is real image data, not a stub. */
function makePng(width, height) {
  const crcTable = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    return table;
  })();
  const crc32 = (buffer) => {
    let c = -1;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * 3;
      raw[offset] = (x * 7) % 256;
      raw[offset + 1] = (y * 11) % 256;
      raw[offset + 2] = 0x80;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const syntheticPng = makePng(8, 8);

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
// The model declares text-only input on purpose: this is how the "text-only model
// refuses an image task" acceptance item is exercised.
writeFileSync(
  join(agentDir, "models.json"),
  `${JSON.stringify({
    providers: {
      "p1-local": {
        baseUrl: `http://127.0.0.1:${modelPort}/v1`,
        api: "openai-completions",
        apiKey: "p1-isolated-test-key",
        models: [
          { id: "p1-model", name: "P1 text-only model", contextWindow: 32768, maxTokens: 256, input: ["text"] },
        ],
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
// Fake provider. Records every request so "nothing was uploaded" is provable.
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
  const raw = Buffer.concat(chunks).toString("utf8");
  const body = JSON.parse(raw);
  const serialized = JSON.stringify(body.messages ?? []);
  const lastUser = (() => {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role !== "user") continue;
      const content = message.content;
      if (typeof content === "string") return { text: content, imageParts: 0 };
      if (Array.isArray(content)) {
        return {
          text: content.map((part) => (typeof part?.text === "string" ? part.text : "")).join(""),
          imageParts: content.filter((part) => part?.type === "image").length,
        };
      }
    }
    return { text: "", imageParts: 0 };
  })();

  modelRequests.push({
    index: modelRequests.length + 1,
    receivedAt: Date.now(),
    lastUserText: lastUser.text.slice(0, 120),
    imagePartsInLastUserMessage: lastUser.imageParts,
    anyImageInTranscript: serialized.includes('"image"'),
    totalImagesInTranscript: (serialized.match(/"type":"image"/g) ?? []).length,
  });

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
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
  send({ role: "assistant", content: "p1-" }, null);
  send({ content: "ok" }, "stop");
  res.end("data: [DONE]\n\n");
});

// ---------------------------------------------------------------------------
// pi-web lifecycle
// ---------------------------------------------------------------------------
let server;
let serverLog = "";

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

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

async function startPiWeb() {
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
// CDP
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

const result = {
  capturedAt: new Date().toISOString(),
  isolation: {
    piWebRepo,
    runRoot,
    agentDir,
    sessionDir,
    homeDir,
    orbWorkspace,
    configPath,
    piWebUrl: baseUrl,
    note: "isolated agent dir, isolated HOME, local fake provider; no real model, no real credentials",
    screenshots: false,
    desktopInput: false,
  },
  foregroundWindowAvailable: null,
  helperMeasurement: null,
  checks: [],
  passed: false,
};

function check(name, ok, detail) {
  result.checks.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
}

async function evaluate(client, expression) {
  const outcome = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (outcome.exceptionDetails) {
    return { __exception: outcome.exceptionDetails.exception?.description ?? "evaluation failed" };
  }
  return outcome.result.value;
}

let electron;
let electronErr = "";

try {
  if (piWebHead !== EXPECTED_HEAD) throw new Error(`pi-web HEAD is ${piWebHead}, expected ${EXPECTED_HEAD}`);
  if (!existsSync(join(worktree, ".next", "BUILD_ID"))) {
    throw new Error(`pi-web snapshot at ${worktree} is not built; run node evidence/p0-02/run-p0-02.mjs once first`);
  }

  // -------------------------------------------------------------------------
  // A. The native helper: DPI awareness and cost. This is the seam P1-05 will
  //    replace with the Cua driver's `active` window flag.
  // -------------------------------------------------------------------------
  const helperStarted = Date.now();
  const helperRaw = execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helperPath], {
    encoding: "utf8",
    timeout: 30000,
  });
  const helperElapsed = Date.now() - helperStarted;
  const helper = JSON.parse(helperRaw.trim().split(/\r?\n/).filter(Boolean).at(-1));

  result.helperMeasurement = {
    elapsedMs: helperElapsed,
    ok: helper.ok,
    foregroundFound: Boolean(helper.foreground),
    dpiAwareness: helper.dpiAwareness,
    note: "P0-04 required the desktop helper to declare per-monitor-v2 DPI awareness; the helper reports whether the declaration actually took effect",
  };

  check("target helper runs and returns JSON", helper.ok === true, JSON.stringify(helper).slice(0, 300));
  check(
    "target helper declares per-monitor-v2 DPI awareness",
    helper.dpiAwareness?.isPerMonitorV2 === true,
    JSON.stringify(helper.dpiAwareness),
  );
  check(
    "target helper does not report a stale v1 awareness",
    helper.dpiAwareness?.isPerMonitorV1 !== true && helper.dpiAwareness?.isUnaware !== true,
    JSON.stringify(helper.dpiAwareness),
  );

  const foregroundAvailable = Boolean(helper.foreground);
  result.foregroundWindowAvailable = foregroundAvailable;
  // Record the environment fact rather than asserting what we wish were true.
  result.checks.push({
    name: "environment fact: a genuine foreground window is available for the positive capture path",
    ok: true,
    detail: foregroundAvailable
      ? `yes: ${helper.foreground?.title}`
      : "NO — GetForegroundWindow() returned null in this session, so the positive capture path cannot be exercised here and is recorded as unverified",
  });

  await new Promise((done, fail) => modelServer.listen(modelPort, "127.0.0.1", (e) => (e ? fail(e) : done())));
  await startPiWeb();

  electron = spawn(
    electronBinary(),
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
  electron.stderr.on("data", (chunk) => (electronErr += chunk.toString()));
  electron.stdout.on("data", () => {});

  let pageTarget = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await sleep(500);
    if (electron.exitCode !== null) break;
    try {
      const targets = await fetchTargets();
      pageTarget = targets.find((target) => target.type === "page") ?? null;
      if (pageTarget) break;
    } catch {
      // Not up yet.
    }
  }
  if (!pageTarget) throw new Error(`no page target; exitCode=${electron.exitCode} stderr=${electronErr.slice(-600)}`);

  const client = await connect(pageTarget.webSocketDebuggerUrl);
  const orb = (expression) => evaluate(client, `window.orb.${expression}`);
  const status = async () => JSON.parse(await orb("getStatus().then((s) => JSON.stringify(s))"));

  await sleep(2500);
  const initial = await status();
  check("orb is configured and connected for this run", initial.configured === true && initial.piWeb.reachable === true, JSON.stringify(initial.piWeb));
  const generation = initial.generation;

  // -------------------------------------------------------------------------
  // B. The screenshot bridge is exposed, and only as a small fixed surface.
  // -------------------------------------------------------------------------
  const keys = JSON.parse(await evaluate(client, "JSON.stringify(Object.keys(window.orb).sort())"));
  check(
    "the screenshot operations are exposed through the bridge",
    keys.includes("captureScreenshot") && keys.includes("resolveScreenshot") && keys.includes("discardScreenshot"),
    JSON.stringify(keys),
  );
  check(
    "the bridge still exposes no generic IPC or pixel-writing helper",
    !keys.includes("ipcRenderer") && !keys.includes("invoke") && !keys.includes("send") && !keys.includes("writeFile"),
    JSON.stringify(keys),
  );

  // -------------------------------------------------------------------------
  // C. No target window -> capture refused, and NOTHING is uploaded.
  // -------------------------------------------------------------------------
  const beforeCapture = modelRequests.length;
  const capture = JSON.parse(
    await orb(`captureScreenshot({ generation: ${generation}, text: 'look at this' }).then((r) => JSON.stringify(r))`),
  );
  result.captureAttempt = capture;

  check(
    "a capture with no recorded target window is refused",
    capture.ok === false,
    JSON.stringify(capture),
  );
  check(
    "the refusal explains that the target is recorded before waking",
    typeof capture.message === "string" && /target window|before the orb takes focus/i.test(capture.message),
    String(capture.message),
  );
  check(
    "the refusal does not offer or perform a whole-screen capture",
    typeof capture.message === "string" && !/whole screen|full screen|entire screen/i.test(capture.message),
    String(capture.message),
  );
  await sleep(1500);
  check(
    "a refused capture uploads nothing to the model",
    modelRequests.length === beforeCapture,
    `before=${beforeCapture} after=${modelRequests.length}`,
  );

  // A bogus confirmation must not send either.
  const bogus = JSON.parse(
    await orb(
      `resolveScreenshot({ generation: ${generation}, observationId: 'obs-not-real', confirmed: true }).then((r) => JSON.stringify(r))`,
    ),
  );
  check(
    "confirming an unknown capture sends nothing",
    bogus.sent === false,
    JSON.stringify(bogus),
  );
  await sleep(1200);
  check(
    "the unknown confirmation reached no model call",
    modelRequests.length === beforeCapture,
    `before=${beforeCapture} after=${modelRequests.length}`,
  );

  const discarded = await orb("discardScreenshot().then((v) => JSON.stringify(v))");
  check("discarding with nothing pending is harmless", discarded === "true", String(discarded));

  // The draft text must not have been sent as a plain message either.
  check(
    "no message was sent on the refusal path",
    (await status()).busy === false,
    JSON.stringify(await status()),
  );

  // -------------------------------------------------------------------------
  // D. Text-only model rejection, using a synthetic image block through the
  //    documented prompt API. The image is real PNG data; no screenshot is taken.
  // -------------------------------------------------------------------------
  // The orb creates its session lazily (no session is opened until something needs
  // one), so the renderer's own path is used to obtain it here.
  const ensured = await orb("ensureSession().then((id) => id).catch((e) => 'ERR:' + e.message)");
  check(
    "a session can be created on demand for the workspace",
    typeof ensured === "string" && !ensured.startsWith("ERR:"),
    String(ensured).slice(0, 200),
  );
  const sessionId = typeof ensured === "string" && !ensured.startsWith("ERR:") ? ensured : (await status()).sessionId;
  check("the orb session exists for the image test", typeof sessionId === "string", String(sessionId));

  let textOnlyOutcome = null;
  if (typeof sessionId === "string") {
    const imageBlock = {
      type: "image",
      data: syntheticPng.toString("base64"),
      mimeType: "image/png",
    };
    const beforeImage = modelRequests.length;
    const sentWithImage = await piWebRequest(`/api/agent/${encodeURIComponent(sessionId)}`, {
      method: "POST",
      body: { type: "prompt", message: "describe this synthetic image", images: [imageBlock] },
    });
    textOnlyOutcome = {
      httpStatus: sentWithImage.status,
      responseError: sentWithImage.body?.error ?? null,
      providerReceivedImage: false,
      syntheticImageBytes: syntheticPng.length,
    };

    // Wait briefly for any provider call the request might have produced.
    await sleep(4000);
    const newRequests = modelRequests.slice(beforeImage);
    textOnlyOutcome.providerReceivedImage = newRequests.some((request) => request.anyImageInTranscript);
    textOnlyOutcome.newProviderRequests = newRequests.length;
    // Pi's own behaviour, observed rather than assumed: it keeps the message but marks
    // the dropped attachment, so the transcript records that an image was omitted
    // instead of silently sending text as if nothing had been attached.
    const annotation = /image omitted/i.test(newRequests.map((request) => request.lastUserText).join("\n"));
    textOnlyOutcome.omissionAnnotationPresent = annotation;
    textOnlyOutcome.observedLastUserText = newRequests.at(-1)?.lastUserText ?? null;
    result.textOnlyModel = textOnlyOutcome;

    check(
      "a text-only model never receives image data",
      textOnlyOutcome.providerReceivedImage === false,
      JSON.stringify(textOnlyOutcome),
    );
    check(
      "the dropped image is recorded in the transcript instead of vanishing silently",
      annotation === true,
      JSON.stringify(textOnlyOutcome),
    );
  }

  // -------------------------------------------------------------------------
  // E. The normal path still works and the shell survives all of the above.
  // -------------------------------------------------------------------------
  const beforeNormal = modelRequests.length;
  const normalSession = await piWebRequest("/api/agent/new", { method: "POST", body: { cwd: orbWorkspace, type: "ensure_session" } });
  if (normalSession.status === 200 && normalSession.body?.sessionId) {
    await piWebRequest(`/api/agent/${encodeURIComponent(normalSession.body.sessionId)}`, {
      method: "POST",
      body: { type: "prompt", message: "plain text only" },
    });
  }
  await waitFor(() => modelRequests.length > beforeNormal, 60000, "a plain text provider call");
  const normalRequest = modelRequests.at(-1);
  check("a plain text message still reaches the model", normalRequest.imagePartsInLastUserMessage === 0, JSON.stringify(normalRequest));
  check("the shell is still alive at the end", electron.exitCode === null, `exitCode=${electron.exitCode}`);

  client.close();
  result.modelRequests = modelRequests;
  result.electronStderrTail = electronErr.trim().split(/\r?\n/).slice(-8).join("\n");
} catch (error) {
  check("P1-04 verification completed without error", false, error?.message ?? String(error));
  result.electronStderrTail = electronErr.slice(-1500);
  result.piWebLogTail = serverLog.slice(-1500);
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
  mkdirSync(join(repo, "evidence", "p1-04"), { recursive: true });
  result.passed = result.checks.length > 0 && result.checks.every((entry) => entry.ok);
  writeFileSync(join(repo, "evidence", "p1-04", "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ passed: result.passed, failed: result.checks.filter((c) => !c.ok) }, null, 2));
}

function electronBinary() {
  return join(repo, "node_modules", "electron", "dist", "electron.exe");
}

try {
  rmSync(runRoot, { recursive: true, force: true });
} catch {
  // Electron may still hold a handle on its profile directory.
}

process.exit(result.passed ? 0 : 1);
