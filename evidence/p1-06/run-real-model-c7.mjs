// P1-06 task-3: C7 with a REAL model in the loop.
//
// C7 is "the point picked off the screenshot is the point that gets clicked". The automated P1-06
// stage proves the product's half of that (a fraction read off the image maps onto the intended
// cell); it cannot prove the model's half, which is that a real model, given the real screenshot,
// actually calls orb_observe and then orb_click with a fraction that lands on the same cell.
//
// This harness runs that real-model path end to end:
//
//   disposable target window            (its own JSONL is the ground truth)
//     ^ locked Cua driver
//     ^ pi-Orb adapter -> broker -> bridge (the product's own chain)
//     ^ real pi-web + REAL MODEL          (composed from real provider settings)
//
// Isolation, so nothing of the user's is touched:
//   - the Orb shell gets its own --user-data-dir and its own PI_ORB_CONFIG, so it never reads or
//     writes the running user's %APPDATA%\pi-orb handshake;
//   - pi-web gets its own agent dir. Its models.json is a HARD LINK and auth.json a SYMLINK to the
//     real ones: the real configuration is used with no second copy of any credential;
//   - the session dir is that isolated agent dir, so no session is written under the user's profile.
//
// It spends a small, bounded number of real model turns (one per prompt) and never retries silently:
// a failure is recorded with the raw error so it can be diagnosed rather than papered over.
//
// Run: node evidence/p1-06/run-real-model-c7.mjs

import { spawn, execFileSync } from "node:child_process";
import { connect } from "node:net";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repo = resolve(import.meta.dirname, "..", "..");
const runRoot = join("D:\\pi-orb-p1-runs", `p1-06-real-c7-${Date.now()}`);
const outPath = join(repo, "evidence", "p1-06", "real-model-c7.json");

const electronBinary = join(repo, "node_modules", "electron", "dist", "electron.exe");
const targetAppDir = join(repo, "evidence", "p1-05", "target-app");
const extensionPath = join(repo, "pi-package", "extensions", "orb.ts");

/** The pi-web snapshot prepared by the P0-02 harness (fixed HEAD, already built). */
const piWebWorktree = join(tmpdir(), "pi-orb-p0-head-src");

const WORKSPACE = join(runRoot, "orb-workspace");
/**
 * The isolated agent dir must sit on the SAME volume as the real one: the real `models.json` is shared
 * by hard link, and a hard link cannot cross volumes. TEMP is on C: alongside the real agent dir, so
 * the link succeeds and no credential is copied. Everything else stays under the run directory.
 */
const agentDir = join(tmpdir(), `pi-orb-real-c7-agent-${Date.now()}`);
const shellDataDir = join(runRoot, "shell-data");
const configPath = join(runRoot, "orb-config.json");
const gridLogPath = join(runRoot, "grid.jsonl");
const gridGeometryPath = join(runRoot, "geometry.json");
const wakeLogPath = join(runRoot, "wake.jsonl");

const PI_WEB_PORT = 31502;
const DEBUG_PORT = 31501;
const PI_WEB_PASSWORD = "p1-06-real-c7-password";
const piWebBaseUrl = `http://127.0.0.1:${PI_WEB_PORT}`;
const WAKE_CHORD = "Control+Alt+F11";

const REAL_AGENT_DIR = join(process.env.USERPROFILE ?? "", ".pi", "agent");
const MODEL = { provider: "TZcode", id: "deepseek-v4.1-flash" };

for (const dir of [runRoot, WORKSPACE, agentDir, shellDataDir]) mkdirSync(dir, { recursive: true });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const safe = (value, max = 600) => {
  try {
    const text = JSON.stringify(value, (_k, node) => (typeof node === "bigint" ? `${node}n` : node));
    return text === undefined ? String(value) : text.length > max ? `${text.slice(0, max)}…` : text;
  } catch (error) {
    return `<unserializable: ${error.message}>`;
  }
};

const report = {
  capturedAt: new Date().toISOString(),
  scope: {
    what: "C7 with a real model: a point picked off the real screenshot must be the point clicked",
    chain: "target app <- locked Cua driver <- cua-adapter <- desktop-broker <- bridge <- pi-web <- real model",
  },
  isolation: {
    shellUserDataDir: shellDataDir,
    orbConfig: configPath,
    agentDir,
    modelsJson: "hard link to the real file (no copy)",
    authJson: "symlink to the real file (no copy)",
    realAgentDir: REAL_AGENT_DIR,
  },
  model: MODEL,
  steps: {},
  checks: [],
  passed: false,
};

function check(name, ok, detail) {
  report.checks.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
}

/**
 * Whether an interactive desktop is available to foreground a window.
 *
 * Needed as an explicit preflight because its absence produces a *misleading* failure later on:
 * while the session is locked the foreground window is the lock screen, so the product records the
 * lock screen and then correctly refuses to capture it ("the recorded window was replaced"). That
 * reads like a product defect when the real cause is that no window can be foregrounded at all.
 *
 * `OpenInputDesktop` fails when the caller is not on the input desktop, which is exactly the locked
 * case; the foreground process name is reported too, so the reason is unambiguous.
 */
function probeInteractiveDesktop() {
  const script = `
Add-Type -Namespace Q -Name N -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool OpenInputDesktop(uint flags, bool inherit, uint access);
'@
$fg = [Q.N]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][Q.N]::GetWindowText($fg, $sb, 512)
$procId = 0
[void][Q.N]::GetWindowThreadProcessId($fg, [ref]$procId)
$name = ''
try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $name = '<gone>' }
$desk = [Q.N]::OpenInputDesktop(0, $false, 0x0100)
[ordered]@{ process = $name; title = $sb.ToString(); inputDesktopAccessible = ($desk -ne [System.IntPtr]::Zero) } | ConvertTo-Json -Compress
`;
  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { encoding: "utf8", timeout: 30000, windowsHide: true },
    );
    const line = out.trim().split(/\r?\n/).filter(Boolean).at(-1);
    return JSON.parse(line);
  } catch (error) {
    return { error: String(error?.message ?? error).slice(0, 200) };
  }
}

function readJsonl(path) {
  try {
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

let grid = null;
let shell = null;
let piWeb = null;
let shellOut = "";
let piWebLog = "";

function shutdown(code) {
  for (const child of [shell, piWeb, grid]) {
    try {
      child?.kill();
    } catch {
      /* ignore */
    }
  }
  // Remove the staged agent dir. It holds only a hard link and a symlink into the real configuration,
  // never a copy, but it is still removed so nothing credential-adjacent is left lying around.
  try {
    rmSync(agentDir, { recursive: true, force: true });
  } catch {
    /* not fatal: the run directory is the record */
  }
  process.exit(code);
}

// ---------------------------------------------------------------------------
// 1. Isolated agent dir: real model configuration, no second credential copy.
// ---------------------------------------------------------------------------
function stageAgentDir() {
  const modelsSource = join(REAL_AGENT_DIR, "models.json");
  const authSource = join(REAL_AGENT_DIR, "auth.json");
  if (!existsSync(modelsSource)) throw new Error(`no real models.json at ${modelsSource}`);

  // Hard link: the same inode, so the real provider configuration is used and nothing is duplicated.
  linkSync(modelsSource, join(agentDir, "models.json"));
  // Symlink: the real credential store, shared rather than copied.
  if (existsSync(authSource)) symlinkSync(authSource, join(agentDir, "auth.json"));

  // Our own settings: the real provider/model, and the extension loaded exactly as a user install would.
  writeFileSync(
    join(agentDir, "settings.json"),
    `${JSON.stringify(
      {
        defaultProvider: MODEL.provider,
        defaultModel: MODEL.id,
        defaultThinkingLevel: "off",
        defaultTools: ["read"],
        extensions: [extensionPath],
        enableInstallTelemetry: false,
        enableAnalytics: false,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  report.steps.agentDir = {
    settings: "written (real provider/model, extension declared)",
    modelsJsonLinked: existsSync(join(agentDir, "models.json")),
    authJsonLinked: existsSync(join(agentDir, "auth.json")),
  };
}

// ---------------------------------------------------------------------------
// 2. Orb configuration for the isolated shell.
// ---------------------------------------------------------------------------
function writeOrbConfig() {
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        version: 1,
        orbWorkspace: WORKSPACE,
        shortcut: WAKE_CHORD,
        window: { alwaysOnTop: true, x: 60, y: 60, width: 445, height: 632 },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// 3. Disposable target. Its own log is the only ground truth for "what was clicked".
// ---------------------------------------------------------------------------
async function startTarget() {
  // Spawned exactly as the passing P1-06 stage does (same cwd, same env), because the driver only
  // lists this window when it is spawned that way - an earlier version of this harness omitted `cwd`
  // and added `windowsHide`, and the window never appeared in the driver's list at all.
  grid = spawn(electronBinary, [targetAppDir], {
    cwd: repo,
    env: { ...process.env, P1_05_TARGET_LOG: gridLogPath, P1_05_TARGET_GEOMETRY: gridGeometryPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  grid.stderr.on("data", (chunk) => (stderr += chunk.toString()));

  for (let attempt = 0; attempt < 80; attempt += 1) {
    await sleep(500);
    if (existsSync(gridGeometryPath)) {
      try {
        const geometry = JSON.parse(readFileSync(gridGeometryPath, "utf8"));
        report.steps.targetPid = grid.pid;
        return geometry;
      } catch {
        /* still being written */
      }
    }
  }
  throw new Error(`the target never reported geometry. stderr: ${stderr.slice(0, 400)}`);
}
function foregroundAndWake(hwnd) {
  // The helper exits non-zero when it cannot foreground the window. That is a real outcome to record,
  // not an exception to swallow, so the reason is parsed from stdout and lands in the report.
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
        "-LogPath",
        wakeLogPath,
        "-Chord",
        "ctrl+alt+f11",
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
      return { ok: false, reason: "helper failed", message: String(error?.message ?? error).slice(0, 300) };
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Isolated pi-web, composed from the real provider configuration.
// ---------------------------------------------------------------------------
function startPiWeb() {
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
    HOME: process.env.USERPROFILE,
    USERPROFILE: process.env.USERPROFILE,
    // The extension must reach THIS shell, not the running user's orb, so both the configuration and
    // the handshake are pointed at this run.
    PI_ORB_CONFIG: configPath,
    PI_ORB_BRIDGE_TOKEN_FILE: join(shellDataDir, "bridge-token.json"),
    PATH: process.env.PATH,
  });

  piWeb = spawn(
    process.execPath,
    [join(piWebWorktree, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PI_WEB_PORT), "-H", "127.0.0.1"],
    { cwd: piWebWorktree, env: cleanEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  piWeb.stdout.on("data", (chunk) => (piWebLog += chunk.toString()));
  piWeb.stderr.on("data", (chunk) => (piWebLog += chunk.toString()));
}

async function waitForPiWeb(deadlineMs = 180_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    await sleep(400);
    try {
      const response = await fetch(`${piWebBaseUrl}/login`);
      if (response.status < 500) return true;
    } catch {
      /* not up yet */
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// 5. Orb shell, isolated from the running user's instance.
// ---------------------------------------------------------------------------
function startShell() {
  shell = spawn(
    electronBinary,
    [".", `--user-data-dir=${shellDataDir}`, `--remote-debugging-port=${DEBUG_PORT}`],
    {
      cwd: repo,
      env: {
        ...process.env,
        PI_ORB_CONFIG: configPath,
        PI_ORB_PI_WEB_URL: piWebBaseUrl,
        PI_ORB_PI_WEB_PASSWORD: PI_WEB_PASSWORD,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  shell.stdout.on("data", (chunk) => (shellOut += chunk.toString()));
  shell.stderr.on("data", (chunk) => (shellOut += chunk.toString()));
}

let tokenFile = join(shellDataDir, "bridge-token.json");

async function waitForHandshake() {
  const candidates = [join(shellDataDir, "bridge-token.json"), join(shellDataDir, "pi-orb", "bridge-token.json")];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await sleep(500);
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        try {
          const parsed = JSON.parse(readFileSync(candidate, "utf8"));
          if (parsed.token && parsed.pipePath) {
            tokenFile = candidate;
            return parsed;
          }
        } catch {
          /* still being written */
        }
      }
    }
  }
  return null;
}

function pipeConnects(pipePath) {
  return new Promise((done) => {
    const socket = connect(pipePath);
    const timer = setTimeout(() => {
      socket.destroy();
      done(false);
    }, 3000);
    socket.on("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      done(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      done(false);
    });
  });
}

// ---------------------------------------------------------------------------
// 6. CDP, to drive the product's own UI path.
// ---------------------------------------------------------------------------
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

async function attachToOrbRenderer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(500);
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      if (!response.ok) continue;
      const targets = await response.json();
      const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
      const preferred =
        pages.find((t) => /orb/i.test(t.title ?? "")) ??
        pages.find((t) => /index\.html/i.test(t.url ?? "")) ??
        pages[0];
      if (!preferred) continue;
      const client = await connectCdp(preferred.webSocketDebuggerUrl);
      report.steps.rendererTarget = { title: preferred.title, url: preferred.url };
      return client;
    } catch {
      /* not ready */
    }
  }
  return null;
}

function evaluateOn(client, expression) {
  return client
    .send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    .then((result) => result?.result?.value);
}

/** Evaluate an expression that returns JSON text, as the browser tests do. */
async function orb(client, expression) {
  const value = await evaluateOn(client, `(async () => { try { return JSON.stringify(await (${expression})); } catch (e) { return JSON.stringify({ __error: String(e && e.message ? e.message : e) }); } })()`);
  if (typeof value !== "string") return { __raw: value };
  try {
    return JSON.parse(value);
  } catch {
    return { __unparsed: value };
  }
}

// ---------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------
try {
  if (!existsSync(join(piWebWorktree, ".next", "BUILD_ID"))) {
    throw new Error(`the pi-web snapshot at ${piWebWorktree} is not built`);
  }

  stageAgentDir();
  writeOrbConfig();

  // Preflight the interactive desktop. While the session is locked the wake path cannot foreground
  // the disposable window, and the product would then report a *misleading* failure ("the recorded
  // window was replaced"), so this stops first and says what is actually wrong.
  const desktop = probeInteractiveDesktop();
  report.steps.interactiveDesktop = desktop;
  if (
    !check(
      "an interactive desktop is available to foreground the target",
      desktop?.inputDesktopAccessible === true,
      safe(desktop),
    )
  ) {
    throw new Error(
      `no interactive desktop: foreground is ${desktop?.process ?? "?"} and the input desktop is not accessible. ` +
        "The workstation appears to be locked; unlock it and re-run. Nothing was sent to any model.",
    );
  }

  // The target first, so its window is what the orb records as "the window the user was looking at".
  const geometry = await startTarget();
  const targetTitle = "P1-05 input target";
  report.steps.target = {
    pid: grid.pid,
    windowBoundsDip: geometry.windowBounds,
    contentBoundsDip: geometry.contentBounds,
    scaleFactor: geometry.scaleFactor,
    cell00: geometry.cellCentres?.find((c) => c.cell === "0,0") ?? null,
  };
  // Give the window time to be registered on screen before anything lists windows.
  await sleep(1500);

  startPiWeb();
  if (!(await waitForPiWeb())) {
    report.steps.piWeb = { ok: false, log: piWebLog.slice(-1500) };
    check("the isolated pi-web started", false, "it never answered /login");
    throw new Error("pi-web did not start");
  }
  report.steps.piWeb = { ok: true, baseUrl: piWebBaseUrl, log: piWebLog.slice(-600) };
  check("the isolated pi-web started", true, piWebBaseUrl);

  startShell();
  const handshake = await waitForHandshake();
  report.steps.handshake = handshake
    ? { path: tokenFile, pid: handshake.pid, generation: handshake.generation, workspace: handshake.workspace, pipePath: handshake.pipePath }
    : null;
  if (!check("the isolated shell published its own handshake", Boolean(handshake), safe(report.steps.handshake))) {
    throw new Error("no handshake");
  }
  const connects = await pipeConnects(handshake.pipePath);
  check("the isolated shell's pipe accepts a connection", connects, handshake.pipePath);
  check(
    "the isolated shell is NOT the user's running orb",
    handshake.pid !== 30620,
    `handshake pid ${handshake.pid}`,
  );

  const client = await attachToOrbRenderer();
  if (!check("the orb renderer is reachable over CDP", Boolean(client), safe(report.steps.rendererTarget))) {
    throw new Error("no CDP target");
  }

  // Use the wake chord this harness actually sends, so the record path is the product's own.
  const shortcut = await orb(client, `window.orb.setShortcut(${JSON.stringify(WAKE_CHORD)})`);
  report.steps.shortcut = { registered: shortcut?.shortcutRegistered, problem: shortcut?.shortcutProblem };
  check("the wake shortcut registered", shortcut?.shortcutRegistered === true, safe(shortcut));

  // Point the product at the workspace, which is what activates Orb mode for the session.
  const workspaceStatus = await orb(client, `window.orb.setWorkspace(${JSON.stringify(WORKSPACE)}, true)`);
  report.steps.workspace = workspaceStatus;
  const status = await orb(client, `window.orb.getStatus()`);
  const generation = status?.generation;
  report.steps.generation = generation;
  check("the isolated shell reports a workspace and a generation", Boolean(status?.workspace) && typeof generation === "number", safe({ workspace: status?.workspace, generation }));

  // The desktop-tool target, chosen from the driver's own list. Match by PROCESS ID, not title: the
  // desktop also holds IME/text-input surfaces, and a title match can pick the wrong one. The driver's
  // `windowId` is the Win32 handle in the same id space (verified for P1-06), so it also foregrounds
  // the window below.
  let listResult = await orb(client, `window.orb.listDesktopWindows()`);
  let choice = Array.isArray(listResult?.windows) ? listResult.windows.find((w) => w.pid === grid.pid) : undefined;
  for (let attempt = 0; attempt < 20 && !choice; attempt += 1) {
    await sleep(1000);
    listResult = await orb(client, `window.orb.listDesktopWindows()`);
    choice = Array.isArray(listResult?.windows) ? listResult.windows.find((w) => w.pid === grid.pid) : undefined;
  }
  report.steps.windowChoice = choice ?? null;
  report.steps.windowCandidates = Array.isArray(listResult?.windows)
    ? listResult.windows.map((w) => ({ pid: w.pid, title: w.title, appName: w.appName }))
    : null;
  if (
    !check(
      "the driver lists the disposable target, identified by process id",
      Boolean(choice),
      `grid pid=${grid.pid} candidates=${safe(report.steps.windowCandidates, 400)}`,
    )
  ) {
    throw new Error("target not listed by the driver");
  }

  // Record the target: bring the disposable window to the front, then press the real wake chord. The
  // record happens inside the product, before it takes focus, so it can only be this window.
  const wake = foregroundAndWake(choice.windowId);
  report.steps.wake = wake;
  await sleep(3000);

  const afterWake = await orb(client, `window.orb.getStatus()`);
  report.steps.recordedTarget = afterWake?.desktopTask?.target ?? null;
  check(
    "the product recorded the disposable target, not the user's desktop",
    afterWake?.desktopTask?.target?.title === targetTitle,
    safe(report.steps.recordedTarget),
  );

  const setTarget = await orb(client, `window.orb.setDesktopTarget(${JSON.stringify(choice.windowId)})`);
  check("the desktop target was set to the disposable window", setTarget?.ok === true && setTarget?.target?.title === targetTitle, safe(setTarget));

  // Authorize the one action this run is allowed to take.
  const approved = await orb(
    client,
    `window.orb.authorizeDesktopTask({ generation: ${generation}, scope: "click the cell marked 0,0 once" })`,
  );
  report.steps.approved = { authorized: approved?.authorized, scope: approved?.scope, target: approved?.target?.title };
  check("the desktop task was approved through the product's UI path", approved?.authorized === true, safe(approved));

  // The instruction: it names the fraction space explicitly, and the cell to hit.
  const instruction = [
    "看你刚才收到的目标窗口截图。先调用 orb_observe。",
    "然后根据截图中左上角标记为 0,0 的格子，调用一次 orb_click。",
    "x/y 使用截图相对的 0–1000 坐标，不要使用屏幕绝对坐标，也不要点击别处。",
  ].join("\n");

  // Capture for preview. Nothing is sent yet, and the preview must be the target window.
  const capture = await orb(client, `window.orb.captureScreenshot({ generation: ${generation}, text: ${JSON.stringify(instruction)} })`);
  report.steps.capture = capture
    ? {
        ok: capture.ok,
        message: capture.message,
        observationId: capture.observationId,
        width: capture.width,
        height: capture.height,
        bytes: capture.bytes,
        targetDescription: capture.targetDescription,
        targetStale: capture.targetStale,
      }
    : null;
  if (!check("a screenshot of the recorded target was captured for preview", capture?.ok === true, safe(report.steps.capture))) {
    throw new Error("capture failed");
  }
  check(
    "the preview describes the disposable target window, not the orb",
    typeof capture.targetDescription === "string" && capture.targetDescription.includes(targetTitle),
    String(capture.targetDescription),
  );

  // Confirming sends the image and the instruction as ONE user message - that is the whole point.
  const gridBefore = readJsonl(gridLogPath).length;
  const resolved = await orb(
    client,
    `window.orb.resolveScreenshot({ generation: ${generation}, observationId: ${JSON.stringify(capture.observationId)}, confirmed: true })`,
  );
  report.steps.resolve = resolved;
  check("the confirmed screenshot was sent with the instruction", resolved?.ok === true && resolved?.sent === true, safe(resolved));

  // Wait for the real model to work. Long: a real turn includes screenshot understanding.
  const deadline = Date.now() + 420_000;
  let idleSeen = false;
  while (Date.now() < deadline) {
    await sleep(5000);
    const events = readJsonl(gridLogPath);
    const hit = events.find((event) => event.kind === "cell-mousedown");
    if (hit) {
      await sleep(4000);
      idleSeen = true;
      break;
    }
  }
  report.steps.waitedForIdle = idleSeen;

  // ---- Verdicts, all from primary sources ----

  // 1. The target's own log: which cell received the press.
  const gridEvents = readJsonl(gridLogPath);
  const hits = gridEvents.filter((event) => event.kind === "cell-mousedown");
  report.targetLog = {
    events: gridEvents.map((event) => ({ kind: event.kind, cell: event.cell ?? null, offsetInCell: event.offsetInCell ?? null })),
    cellDowns: hits.map((event) => ({ cell: event.cell, offsetInCell: event.offsetInCell })),
  };
  check(
    "C7 (target's own log): a cell-mousedown for the cell marked 0,0 arrived",
    hits.some((event) => event.cell === "0,0"),
    safe(report.targetLog.cellDowns),
  );

  // 2. The real session record: did the model itself call the orb tools?
  const sessionFiles = [];
  const sessionsRoot = join(agentDir, "sessions");
  if (existsSync(sessionsRoot)) {
    for (const dir of readdirSync(sessionsRoot)) {
      const full = join(sessionsRoot, dir);
      for (const file of readdirSync(full)) {
        if (file.endsWith(".jsonl")) sessionFiles.push(join(full, file));
      }
    }
  }
  const calls = [];
  for (const file of sessionFiles) {
    for (const entry of readJsonl(file)) {
      const content = entry?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type === "toolCall" && typeof block.toolName === "string") {
          calls.push({ toolName: block.toolName, arguments: block.arguments ?? null });
        }
      }
    }
  }
  report.modelToolCalls = calls;
  const observeCalls = calls.filter((call) => call.toolName === "orb_observe");
  const clickCalls = calls.filter((call) => call.toolName === "orb_click");
  check("the real model called orb_observe on its own", observeCalls.length > 0, safe(observeCalls.slice(0, 2)));
  check("the real model called orb_click on its own", clickCalls.length > 0, safe(clickCalls.slice(0, 2)));

  const firstClick = clickCalls[0]?.arguments ?? null;
  const usesFraction =
    firstClick &&
    typeof firstClick.x === "number" &&
    typeof firstClick.y === "number" &&
    firstClick.x >= 0 && firstClick.x <= 1000 &&
    firstClick.y >= 0 && firstClick.y <= 1000;
  check(
    "the real model addressed the click in the 0-1000 screenshot space",
    Boolean(usesFraction),
    safe(firstClick),
  );

  report.passed = report.checks.every((entry) => entry.ok);
  report.finishedAt = new Date().toISOString();
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`checks: ${report.checks.filter((c) => c.ok).length}/${report.checks.length}`);
  for (const entry of report.checks) {
    console.log(`  [${entry.ok ? "PASS" : "FAIL"}] ${entry.name}`);
    if (!entry.ok) console.log(`         ${String(entry.detail).slice(0, 400)}`);
  }
  console.log("");
  console.log("target log cell downs:", safe(report.targetLog.cellDowns, 300));
  console.log("model tool calls:", safe(calls.map((c) => c.toolName), 300));
  console.log("written:", outPath);

  shutdown(report.passed ? 0 : 1);
} catch (error) {
  report.error = String(error?.message ?? error);
  report.shellTail = shellOut.slice(-1200);
  report.piWebTail = piWebLog.slice(-800);
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`ABORTED: ${report.error}`);
  console.log(`written: ${outPath}`);
  shutdown(1);
}
