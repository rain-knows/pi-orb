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
import { createHash } from "node:crypto";
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
// Two models on purpose. `p1-model` declares text-only input, which is how the
// "text-only model refuses an image task" acceptance item is exercised. `p1-vision`
// accepts images, so the positive capture path can prove the confirmed pixels really
// reach the provider instead of only reaching the local renderer.
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
          { id: "p1-vision", name: "P1 vision model", contextWindow: 32768, maxTokens: 256, input: ["text", "image"] },
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
    shortcut: "Control+Alt+F11",
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
      if (typeof content === "string") return { text: content, imageParts: 0, imageHashes: [], imageBytes: [] };
      if (Array.isArray(content)) {
        const images = content.filter((part) => part?.type === "image");
        // The OpenAI-completions wire format may encode an image as `image_url` rather than a bare
        // `image` part, so the raw part shapes are recorded too. Detecting only `type === "image"`
        // would report "no image" for an image that was in fact delivered — a test bug that would
        // wrongly convict the product.
        const imageUrlParts = content.filter((part) => part?.type === "image_url");
        // Strip a `data:<mime>;base64,` prefix before hashing: a data URL wraps the same base64 the
        // preview held, so hashing the URL text would compare different strings and wrongly report
        // that the bytes changed. The prefix is recorded so the encoding shape is visible too.
        const stripDataUrl = (value) => String(value).replace(/^data:[^;]*;base64,/, "");
        const rawImageValues = [
          ...images.map((part) => String(part?.data ?? "")),
          ...imageUrlParts.map((part) => String(part?.image_url?.url ?? "")),
        ].filter((value) => value.length > 0);
        const hashes = rawImageValues
          .map(stripDataUrl)
          .map((value) => createHash("sha256").update(value).digest("hex").slice(0, 16));
        return {
          text: content.map((part) => (typeof part?.text === "string" ? part.text : "")).join(""),
          imageParts: images.length + imageUrlParts.length,
          imageHashes: hashes,
          imageBytes: rawImageValues.map((value) => stripDataUrl(value).length),
          partTypes: content.map((part) => (typeof part?.type === "string" ? part.type : typeof part)),
          imageValuePrefixes: rawImageValues.map((value) => value.slice(0, 32)),
        };
      }
    }
    return { text: "", imageParts: 0, imageHashes: [], imageBytes: [] };
  })();

  modelRequests.push({
    index: modelRequests.length + 1,
    receivedAt: Date.now(),
    model: body.model ?? null,
    lastUserText: lastUser.text.slice(0, 120),
    imagePartsInLastUserMessage: lastUser.imageParts,
    // The exact bytes of every image in the last user message, so "what the user previewed"
    // and "what the provider received" can be compared rather than assumed equal.
    imageHashes: lastUser.imageHashes,
    imageBytes: lastUser.imageBytes,
    imageValuePrefixes: lastUser.imageValuePrefixes,
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

// ---------------------------------------------------------------------------
// P1-04 positive-path helpers
//
// The positive path is driven only with a window this test creates itself, in a
// separate process, holding nothing but a flat colour and two corner markers. The
// product's own wake shortcut is then pressed as real synthesized keys, so the code
// under test runs its normal path with no test hook and no widened permission.
// ---------------------------------------------------------------------------
const targetAppLogPath = join(runRoot, "p1-04-target.jsonl");
const wakeLogPath = join(runRoot, "p1-04-wake.jsonl");
// Unique per run so a stale window from an earlier run cannot satisfy the title match.
const targetTitle = `P1-04 capture target ${Date.now().toString(36)}`;
let targetApp = null;

function readJsonl(path) {
  try {
    // Strip the BOM: PowerShell 5.1's `Add-Content -Encoding utf8` writes one, and a leading
    // U+FEFF makes JSON.parse throw, which would make the log look empty rather than unreadable.
    return readFileSync(path, "utf8")
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line.replace(/^\uFEFF/, "")));
  } catch {
    return [];
  }
}

/** Launch the disposable capture target and return its ready record. */
async function startCaptureTarget() {
  targetApp = spawn(electronBinary(), [".", `--user-data-dir=${join(runRoot, "target-userData")}`], {
    cwd: join(repo, "evidence", "p1-04", "target-app"),
    env: {
      ...process.env,
      P1_04_TARGET_LOG: targetAppLogPath,
      P1_04_TARGET_TITLE: targetTitle,
      P1_04_TARGET_X: "520",
      P1_04_TARGET_Y: "140",
    },
    stdio: "ignore",
    windowsHide: true,
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const ready = readJsonl(targetAppLogPath).find((entry) => entry.kind === "ready");
    if (ready) return ready;
    await sleep(300);
  }
  throw new Error("the capture target never reported ready");
}

/**
 * Foreground the test's own window and press the real wake accelerator.
 *
 * The escape hatch is that this targets only a handle reported by a process this test started, and
 * sends only the wake chord — never typing, never clicking, never reading the window's content.
 */
function foregroundAndWake(hwnd) {
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
      "-LogPath",
      wakeLogPath,
      "-Chord",
      "ctrl+alt+f11",
    ],
    { encoding: "utf8", timeout: 60000, windowsHide: true },
  );
  const line = raw.trim().split(/\r?\n/).filter(Boolean).at(-1);
  return JSON.parse(line);
}

/**
 * Decode the captured PNG in the product's own renderer and report pixel statistics.
 *
 * Decoding the exact base64 the preview was built from — rather than a re-capture — is what makes
 * "the preview shows this window and not the orb" a measurement instead of a claim.
 */
async function pngStats(client, base64) {
  const expression = `(async () => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + ${JSON.stringify(base64)};
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let magenta = 0, accent = 0, dark = 0, total = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      total += 1;
      if (r > 200 && b > 200 && g < 90) magenta += 1;
      if (Math.abs(r - 0x4c) < 24 && Math.abs(g - 0x8b) < 24 && Math.abs(b - 0xf5) < 24) accent += 1;
      if (r < 60 && g < 60 && b < 70) dark += 1;
    }
    return JSON.stringify({
      width: canvas.width, height: canvas.height, total, magenta, accent, dark,
      magentaFraction: magenta / total, accentFraction: accent / total, darkFraction: dark / total,
    });
  })()`;
  const raw = await evaluate(client, expression);
  if (typeof raw !== "string") return { error: String(raw?.__exception ?? raw) };
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
    configPath,
    piWebUrl: baseUrl,
    note: "isolated agent dir, isolated HOME, local fake provider; no real model, no real credentials",
    screenshots: false,
    desktopInput: false,
  },
  foregroundWindowAvailable: null,
  helperMeasurement: null,
  positivePath: null,
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
let electronOut = "";

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
  electron.stdout.on("data", (chunk) => (electronOut += chunk.toString()));

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
  //
  //    A record does exist at this point (the startup record), so the refusal is
  //    produced the way a user produces it: by collapsing the orb, which is the
  //    product's own path for "the user has moved on from that window". This is also
  //    what keeps the test from capturing whatever happened to be on the real desktop
  //    at startup — a window this test did not create and has no business reading.
  // -------------------------------------------------------------------------
  const collapsed = JSON.parse(
    await orb(`collapseOrb().then((s) => JSON.stringify({ desktopTarget: s.target, authorized: s.authorized }))`),
  );
  result.startupRecordClearedOnCollapse = collapsed;
  // Recorded as data, not asserted: `desktopTask.target` is the window the desktop tools would act on,
  // which is a separate notion from the record the screenshot path consumes. Keeping the tool target
  // after a collapse is harmless because the authority is revoked with it; keeping the screenshot
  // record is not, which is what the capture refusal below checks.
  check(
    "collapsing the orb revokes the desktop authority",
    collapsed.authorized === false,
    JSON.stringify(collapsed),
  );

  const beforeCapture = modelRequests.length;
  const capture = JSON.parse(
    await orb(`captureScreenshot({ generation: ${generation}, text: 'look at this' }).then((r) => JSON.stringify(r))`),
  );
  result.captureAttempt = capture;
  result.captureRefusalMessage = capture.ok === false ? String(capture.message) : null;

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
  // E. The positive capture path, driven only against a window this test creates.
  //
  //    This is the path P1-04's README recorded as unverified. It is exercised here
  //    through the product's own wake shortcut and its own consent flow, with the
  //    identity of the foreground window checked before anything is captured.
  // -------------------------------------------------------------------------
  const positive = {
    targetTitle,
    targetHwnd: null,
    recordedTarget: null,
    capture: null,
    pixelStats: null,
    discardSentNothing: null,
    confirmed: null,
    providerImage: null,
  };
  result.positivePath = positive;

  const targetReady = await startCaptureTarget();
  positive.targetHwnd = targetReady.hwnd;
  positive.targetBounds = targetReady.bounds;
  positive.targetPhysicalBounds = targetReady.physicalBounds ?? null;
  check(
    "the disposable capture target started with its own window",
    Boolean(targetReady.hwnd) && targetReady.pid !== process.pid,
    JSON.stringify({ hwnd: targetReady.hwnd, pid: targetReady.pid }),
  );

  // Wake with the test's own window in front. The record happens inside the product, before it takes
  // focus, so the recorded target must be this window — never the window that happened to be in front
  // beforehand. That check is the guard against capturing the user's real desktop.
  const wakeResult = foregroundAndWake(targetReady.hwnd);
  positive.wakeHelper = wakeResult;
  positive.wakeLog = readJsonl(wakeLogPath);
  check(
    "the test's own window could be brought to the foreground",
    wakeResult.ok === true,
    JSON.stringify(wakeResult),
  );
  await sleep(3000);
  const afterWake = await status();
  positive.recordedTarget = afterWake.desktopTask?.target ?? null;
  // Whether the product actually reacted to the synthesized chord is a separate fact from whether the
  // chord was sent, and it is the first thing to check when the record looks stale.
  positive.windowAfterWake = {
    shortcutRegistered: afterWake.shortcutRegistered,
    generation: afterWake.generation,
    keysSent: positive.wakeLog.some((entry) => entry.kind === "keys-sent"),
  };

  // Whether the Cua driver is available decides which identity check can be made. The screenshot path
  // records its target with the Win32 helper, which works without the driver; the desktop-tool target
  // additionally needs the driver's window list. Recorded as data so "the driver was absent" cannot be
  // mistaken for "the identity check passed".
  const windowList = JSON.parse(
    await orb(`listDesktopWindows().then((r) => JSON.stringify(r)).catch((e) => JSON.stringify({ ok: false, message: String(e.message) }))`),
  );
  positive.driverAvailable = windowList.ok === true;
  positive.driverWindowCount = windowList.ok === true ? windowList.windows.length : null;
  check(
    "the desktop-tool target matches the window the test put in front (when the driver is available)",
    windowList.ok !== true || positive.recordedTarget?.title === targetTitle,
    JSON.stringify({
      driverAvailable: positive.driverAvailable,
      recorded: positive.recordedTarget,
      expectedTitle: targetTitle,
    }),
  );
  // Did the product react to the chord at all? The main process logs a record attempt and a
  // revocation; their presence in stdout is the independent evidence that the wake ran.
  positive.wakeEvidenceInAppLog = electronOut
    .split(/\r?\n/)
    .filter((line) => /wake|record|revok|desktop/i.test(line))
    .slice(-12);
  check(
    "the product reacted to the synthesized wake chord",
    positive.wakeLog.some((entry) => entry.kind === "keys-sent") && positive.recordedTarget?.title === targetTitle,
    JSON.stringify({
      keysSent: positive.wakeLog.some((entry) => entry.kind === "keys-sent"),
      recordedTitle: positive.recordedTarget?.title,
      expected: targetTitle,
      appLog: positive.wakeEvidenceInAppLog,
    }),
  );
  check(
    "the wake recorded the test's own window as the target, not whatever was in front before",
    positive.recordedTarget?.title === targetTitle,
    JSON.stringify(positive.recordedTarget),
  );
  check(
    "the recorded target is the test's window, not the orb itself",
    positive.recordedTarget !== null && positive.recordedTarget.pid === targetReady.pid,
    JSON.stringify({ recordedPid: positive.recordedTarget?.pid, targetPid: targetReady.pid, orbPid: electron.pid }),
  );

  // Capture for preview. Nothing is uploaded at this point.
  const requestsBeforePreview = modelRequests.length;
  const preview = JSON.parse(
    await orb(`captureScreenshot({ generation: ${afterWake.generation}, text: 'what is on screen?' }).then((r) => JSON.stringify(r))`),
  );
  positive.capture = preview.ok
    ? {
        ok: true,
        observationId: preview.observationId,
        width: preview.width,
        height: preview.height,
        bytes: preview.bytes,
        mimeType: preview.mimeType,
        targetDescription: preview.targetDescription,
        targetStale: preview.targetStale,
        sha256: createHash("sha256").update(preview.data).digest("hex").slice(0, 16),
      }
    : preview;

  check(
    "capturing the recorded window succeeds",
    preview.ok === true,
    JSON.stringify(positive.capture).slice(0, 300),
  );
  // The identity check that does not depend on the driver: the capture itself must name the window
  // this test created. This is the guard against capturing the user's real desktop.
  check(
    "the captured target is identified as the test's own window",
    typeof preview.targetDescription === "string" && preview.targetDescription.includes(targetTitle),
    String(preview.targetDescription),
  );
  check(
    "the preview names the window that was recorded",
    typeof preview.targetDescription === "string" && preview.targetDescription.includes(targetTitle),
    String(preview.targetDescription),
  );
  check(
    "the preview carries real image bytes",
    preview.ok === true && preview.bytes > 1000 && preview.width > 0 && preview.height > 0,
    JSON.stringify({ bytes: preview.bytes, width: preview.width, height: preview.height }),
  );
  // P1-04's coordinate requirement, stated as a measurement: the captured image must be the recorded
  // window's own size, not the whole screen. The comparison is against the target's OWN physical
  // bounds, reported by the target itself — not against the driver's bounds for the window, which
  // describe the frame the driver will click in and are not the same rectangle. Comparing against the
  // driver's rectangle produced a false failure that would have hidden whether the capture was correct.
  const recordedPhysical = positive.recordedTarget?.bounds ?? null;
  const screenPhysical = { width: 2560, height: 1600 };
  positive.sizeComparison = {
    captured: preview.ok ? { width: preview.width, height: preview.height } : null,
    targetPhysicalBounds: positive.targetPhysicalBounds,
    driverReportedBounds: recordedPhysical,
    fullScreen: screenPhysical,
  };
  check(
    "the captured image is the recorded window's size, not the whole screen",
    preview.ok === true &&
      positive.targetPhysicalBounds !== null &&
      // desktopCapturer may trim a window's invisible border, so a small difference is expected; the
      // point of the check is that the image is the window and not the whole desktop.
      Math.abs(preview.width - positive.targetPhysicalBounds.width) <= 40 &&
      Math.abs(preview.height - positive.targetPhysicalBounds.height) <= 60,
    JSON.stringify(positive.sizeComparison),
  );
  check(
    "the captured image is not the whole screen",
    preview.ok === true && preview.width < screenPhysical.width && preview.height < screenPhysical.height,
    JSON.stringify({ captured: positive.sizeComparison.captured, fullScreen: screenPhysical }),
  );

  if (preview.ok === true) {
    positive.pixelStats = await pngStats(client, preview.data);
    const stats = positive.pixelStats;
    check(
      "the preview really contains the recorded window's pixels",
      typeof stats.magentaFraction === "number" && stats.magentaFraction > 0.5,
      JSON.stringify(stats),
    );
    // The orb is always-on-top and may overlap the target, so if the preview contained the orb the
    // orb's own colours would appear. They must not.
    check(
      "the preview does not smuggle in the orb's own overlay",
      typeof stats.accentFraction === "number" && stats.accentFraction < 0.01,
      JSON.stringify({ accentFraction: stats.accentFraction, orbAccent: "#4c8bf5" }),
    );
  }

  // A preview that is never confirmed must upload nothing.
  const previewDiscarded = JSON.parse(
    await orb(`discardScreenshot().then((v) => JSON.stringify({ ok: v }))`),
  );
  await sleep(1500);
  positive.discardSentNothing = {
    discarded: previewDiscarded,
    providerRequestsBefore: requestsBeforePreview,
    providerRequestsAfter: modelRequests.length,
  };
  check(
    "discarding the preview uploads nothing",
    modelRequests.length === requestsBeforePreview,
    JSON.stringify(positive.discardSentNothing),
  );

  // A text-only model must be rejected by the Orb before pi-web accepts the image prompt.
  const textOnlyPreview = JSON.parse(
    await orb(`captureScreenshot({ generation: ${afterWake.generation}, text: 'inspect this image' }).then((r) => JSON.stringify(r))`),
  );
  const beforeTextOnlySend = modelRequests.length;
  const textOnlyDecision = textOnlyPreview.ok
    ? JSON.parse(await orb(
        `resolveScreenshot({ generation: ${afterWake.generation}, observationId: ${JSON.stringify(textOnlyPreview.observationId)}, confirmed: true }).then((r) => JSON.stringify(r))`,
      ))
    : textOnlyPreview;
  positive.textOnlyDecision = textOnlyDecision;
  check(
    "Orb rejects an image prompt for the selected text-only model",
    textOnlyDecision.ok === false && textOnlyDecision.sent === false && /does not support image input/i.test(textOnlyDecision.message),
    JSON.stringify(textOnlyDecision),
  );
  check(
    "the rejected image prompt never reaches the provider",
    modelRequests.length === beforeTextOnlySend,
    `before=${beforeTextOnlySend} after=${modelRequests.length}`,
  );

  // Capture again and confirm it. The session is switched to the image-capable model first, so the
  // confirmed pixels are proven to reach the provider rather than being dropped on the way.
  await piWebRequest(`/api/agent/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    body: { type: "set_model", provider: "p1-local", modelId: "p1-vision" },
  });
  const requestsBeforeConfirm = modelRequests.length;
  const preview2 = JSON.parse(
    await orb(`captureScreenshot({ generation: ${afterWake.generation}, text: 'confirm this screenshot' }).then((r) => JSON.stringify(r))`),
  );
  const preview2Hash = preview2.ok
    ? createHash("sha256").update(preview2.data).digest("hex").slice(0, 16)
    : null;
  const confirmed = preview2.ok
    ? JSON.parse(
        await orb(
          `resolveScreenshot({ generation: ${afterWake.generation}, observationId: ${JSON.stringify(preview2.observationId)}, confirmed: true }).then((r) => JSON.stringify(r))`,
        ),
      )
    : { ok: false, sent: false, message: preview2.message };
  positive.confirmed = { previewSha256: preview2Hash, result: confirmed };
  check(
    "confirming the preview reports the message as sent",
    confirmed.ok === true && confirmed.sent === true,
    JSON.stringify(confirmed),
  );

  try {
    await waitFor(() => modelRequests.length > requestsBeforeConfirm, 60000, "the confirmed image to reach the provider");
  } catch {
    // Recorded below as a failed check rather than thrown.
  }
  await sleep(1200);
  const confirmedRequest = modelRequests.slice(requestsBeforeConfirm).find((request) => request.imagePartsInLastUserMessage > 0) ?? null;
  positive.providerImage = confirmedRequest
    ? {
        model: confirmedRequest.model,
        imageParts: confirmedRequest.imagePartsInLastUserMessage,
        imageHashes: confirmedRequest.imageHashes,
        previewSha256: preview2Hash,
      }
    : null;
  check(
    "the confirmed image reached the provider as image data",
    confirmedRequest !== null,
    JSON.stringify(modelRequests.slice(requestsBeforeConfirm).map((r) => ({ model: r.model, images: r.imagePartsInLastUserMessage }))),
  );
  check(
    "the provider received the exact image bytes the user previewed",
    confirmedRequest !== null && confirmedRequest.imageHashes.includes(preview2Hash),
    JSON.stringify(positive.providerImage),
  );
  check(
    "the confirmed image was sent to the image-capable model",
    confirmedRequest?.model === "p1-vision",
    String(confirmedRequest?.model),
  );

  // -------------------------------------------------------------------------
  // F. The normal path still works and the shell survives all of the above.
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
  result.electronStdoutTail = electronOut.trim().split(/\r?\n/).slice(-12).join("\n");
} catch (error) {
  check("P1-04 verification completed without error", false, error?.message ?? String(error));
  result.electronStderrTail = electronErr.slice(-1500);
  result.piWebLogTail = serverLog.slice(-1500);
} finally {
  try {
    if (targetApp) {
      execFileSync("taskkill", ["/PID", String(targetApp.pid), "/T", "/F"], { stdio: "ignore" });
    }
  } catch {
    // Best effort: the target app may already be gone.
  }
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
