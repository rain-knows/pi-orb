import { createRunDirectory } from '../../scripts/verify/run-directory.mjs';
// Current reference-toolset real-model acceptance harness for the Windows backend (C7, D6 and D8).
//
// C7 is "the point picked off the screenshot is the point that gets clicked". The automated P1-06
// stage proves the product's half of that (a fraction read off the image maps onto the intended
// cell); it cannot prove the model's half, which is that a real model, given the real screenshot,
// actually calls the direct GUI tool with a screenshot fraction that lands on the same cell.
//
// This harness runs that real-model path end to end:
//
//   disposable target window            (its own JSONL is the ground truth)
//     ^ reference Windows backend (GDI + SendInput + clipboard)
//     ^ ReferenceWindowsDriver -> broker -> bridge (the product's own chain)
//     ^ real pi-web + REAL MODEL          (composed from real provider settings)
//
// Isolation, so nothing of the user's is touched:
//   - the Orb shell gets its own --user-data-dir and its own PI_ORB_CONFIG, so it never reads or
//     writes the running user's %APPDATA%\pi-orb handshake;
//   - pi-web gets its own agent dir. Its models.json is a HARD LINK and auth.json a SYMLINK to the
//     real ones: SDK writes cannot alter the user configuration; cleanup removes these copies;
//   - the session dir is that isolated agent dir, so no session is written under the user's profile.
//
// It spends a small, bounded number of real model turns (one per prompt) and never retries silently:
// a failure is recorded with the raw error so it can be diagnosed rather than papered over.
//
// Run: node tests/integration/desktop.mjs [c7|d6-scroll|d8-type]

import { spawn, execFileSync } from "node:child_process";
import { connect } from "node:net";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repo = resolve(import.meta.dirname, '../..');
const reportDir = createRunDirectory('desktop');
const testCase = process.argv[2] ?? "c7";
const accessLevel = ["browser", "open-app"].includes(testCase) ? "full-access" : "workspace-write";
const caseConfig = {
  c7: {
    slug: "real-c7",
    output: "real-model-c7-session-access.json",
    what: "real model receives the automatic frontmost frame and clicks cell 0,0 with the direct click tool",
    instruction: [
      "直接根据刚才收到的目标窗口截图，调用一次 click。",
      "根据截图中左上角标记为 0,0 的格子定位，调用一次 click。",
      "x/y 使用截图相对的 0–1000 坐标，不要使用屏幕绝对坐标，也不要点击别处。",
      "动作返回后直接使用它附带的新截图，不要额外调用观察工具。",
    ].join("\n"),
    targetEvent: "cell-mousedown",
    expectedTool: "click",
  },
  "d6-scroll": {
    slug: "real-d6-scroll",
    output: "real-model-d6-scroll-session-access.json",
    what: "real model receives the automatic frontmost frame and scrolls its labelled strip",
    instruction: [
      "直接根据刚才收到的目标窗口截图，调用一次 scroll。",
      "根据截图找到标注为 s0-s9 的窄滚动区域，在该区域内向下滚动 3 格。",
      "使用 scroll 的截图相对 0–1000 坐标，把位置放在滚动区域内部；不要点击或输入。",
      "动作返回后直接使用它附带的新截图，不要额外调用观察工具。",
    ].join("\n"),
    targetEvent: "wheel",
    expectedTool: "scroll",
  },
  "d8-type": {
    slug: "real-d8-type",
    output: "real-model-d8-type-session-access.json",
    what: "real model receives the automatic frontmost frame, focuses its text field, and types a synthetic marker",
    instruction: [
      "直接根据刚才收到的目标窗口截图操作。",
      "只对截图中标注 type here 的输入框操作：先用 click 点击输入框中心，然后使用这个动作返回的新截图。",
      "这个输入框位于网格下方的 controls 区域，在滚动条上方；不要点击窗口底部或网格单元格。",
      "再调用 input_text 输入且只输入这串无敏感测试文本：P1ORBD8TEST。",
      "input_text 返回后直接使用它附带的新截图，不要额外调用观察工具。不要点其它位置。",
    ].join("\n"),
    targetEvent: "text-input",
    expectedTool: "input_text",
  },
  browser: {
    slug: "real-browser",
    output: "real-model-browser-session-access.json",
    what: "real model opens a local page in the visible default browser and clicks its completion button",
    targetEvent: "browser-click",
    expectedTool: "click",
    resultTitle: "Pi Orb browser probe",
  },
  "open-app": {
    slug: "real-open-app",
    output: "real-model-open-app-session-access.json",
    what: "real model launches a unique disposable application by name and clicks its completion button",
    targetEvent: "native-click",
    expectedTool: "click",
    resultTitle: "Pi Orb native probe",
  },
}[testCase];
if (!caseConfig) throw new Error(`Unsupported test case: ${testCase}. Use c7, d6-scroll, d8-type, browser or open-app.`);

const runRoot = join("D:\\pi-orb-p1-runs", `p1-06-${caseConfig.slug}-${Date.now()}`);
const outPath = join(reportDir, caseConfig.output);

const electronBinary = join(repo, "node_modules", "electron", "dist", "electron.exe");
const targetAppDir = join(repo, "tests/integration/fixtures/desktop-target");
const extensionPath = join(repo, "pi-package", "extensions", "orb.ts");

// An explicit production-built host is required; no historical snapshot bootstrap.
const piWebWorktree = process.env.PI_ORB_EVIDENCE_PI_WEB;
if (!piWebWorktree) throw new Error('Set PI_ORB_EVIDENCE_PI_WEB to an installed, production-built Pi Web package.');

const WORKSPACE = join(runRoot, "orb-workspace");
// Private per-user temporary directory. The disposable copies are deleted during cleanup.
const agentDir = join(tmpdir(), `pi-orb-${caseConfig.slug}-agent-${Date.now()}`);
const shellDataDir = join(runRoot, "shell-data");
const configPath = join(runRoot, "orb-config.json");
const gridLogPath = join(runRoot, "grid.jsonl");
const gridGeometryPath = join(runRoot, "geometry.json");
const wakeLogPath = join(runRoot, "wake.jsonl");

const PI_WEB_PORT = 40_000 + (process.pid % 10_000);
const DEBUG_PORT = PI_WEB_PORT + 1;
const browserUrl = `http://127.0.0.1:${PI_WEB_PORT + 2}/`;
const probeAppName = `PiOrbProbe${Date.now()}`;
const probeAppExe = join(runRoot, `${probeAppName}.exe`);
const PI_WEB_PASSWORD = "p1-06-real-c7-password";
const piWebBaseUrl = `http://127.0.0.1:${PI_WEB_PORT}`;
const WAKE_CHORD = "Control+Alt+F11";

const REAL_AGENT_DIR = join(process.env.USERPROFILE ?? "", ".pi", "agent");
const MODEL = { provider: "TZcode", id: "deepseek-v4.1-flash" };
/** Basic auth for the isolated pi-web's own API, which is the same credential the shell uses. */
const authHeader = `Basic ${Buffer.from(`pi:${PI_WEB_PASSWORD}`, "utf8").toString("base64")}`;

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
  testCase,
  verification: {
    what: caseConfig.what,
    chain: "target app <- reference Windows backend <- ReferenceWindowsDriver <- desktop-broker <- bridge <- pi-web <- real model",
    backend: "deepseek-harness-orb Windows backend @ 72f1d738458a223696685a909e806b683eff5885",
    accessLevel,
    targetSelection: "the test harness foregrounds its disposable target by process id; pi-orb observes the foreground automatically",
  },
  isolation: {
    shellUserDataDir: shellDataDir,
    orbConfig: configPath,
    agentDir,
    modelsJson: "isolated temporary copy; never linked to user configuration",
    authJson: "isolated temporary copy; never linked to user credentials",
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
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern System.IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
'@
$fg = [Q.N]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][Q.N]::GetWindowText($fg, $sb, 512)
$cb = New-Object System.Text.StringBuilder 256
[void][Q.N]::GetClassName($fg, $cb, 256)
$procId = 0
[void][Q.N]::GetWindowThreadProcessId($fg, [ref]$procId)
$name = ''
try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { $name = '<gone>' }
$desk = [Q.N]::OpenInputDesktop(0, $false, 0x0100)
[ordered]@{ process = $name; title = $sb.ToString(); className = $cb.ToString(); inputDesktopAccessible = ($desk -ne [System.IntPtr]::Zero) } | ConvertTo-Json -Compress
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

function isInteractiveDesktop(sample) {
  const processName = String(sample?.process ?? "").toLowerCase();
  const title = String(sample?.title ?? "").toLowerCase();
  const className = String(sample?.className ?? "").toLowerCase();
  const locked = ["lockapp", "logonui"].includes(processName)
    || title.includes("windows 默认锁屏界面")
    || title.includes("lock screen")
    || title.includes("windows spotlight")
    || className === "windows.ui.core.corewindow";
  return sample?.inputDesktopAccessible === true && !locked;
}

/**
 * Wait for an interactive desktop, sampling until the deadline.
 *
 * The lock is not a steady state while a user is at the machine: it was observed unlocked at one moment
 * and locked again seconds later. Failing on the first locked sample would therefore abort a run that a
 * short wait would have completed, so this polls — and it still aborts, with the reason, when the wait
 * expires, without ever having sent anything to a model.
 */
async function waitForInteractiveDesktop(timeoutMs = 600_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    last = probeInteractiveDesktop();
    if (isInteractiveDesktop(last)) return last;
    // LockApp/LogonUI is a definitive environment state. Return immediately so a locked
    // workstation produces a useful evidence file instead of waiting through the full poll window.
    if (!isInteractiveDesktop(last)) {
      const processName = String(last?.process ?? "").toLowerCase();
      const title = String(last?.title ?? "").toLowerCase();
      const className = String(last?.className ?? "").toLowerCase();
      if (["lockapp", "logonui"].includes(processName)
        || title.includes("windows 默认锁屏界面")
        || title.includes("lock screen")
        || title.includes("windows spotlight")
        || className === "windows.ui.core.corewindow") return last;
    }
    if (Date.now() >= deadline) return last;
    await sleep(5000);
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

function modelTurnFinished(requiredTool = null, minimumEntries = 0) {
  const sessionsRoot = join(agentDir, "sessions");
  if (!existsSync(sessionsRoot)) return false;
  for (const directory of readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const sessionDir = join(sessionsRoot, directory.name);
    for (const file of readdirSync(sessionDir)) {
      if (!file.endsWith(".jsonl")) continue;
      const entries = readJsonl(join(sessionDir, file));
      const calledOrbTool = entries.slice(minimumEntries).some((entry) => {
        const content = entry?.message?.content;
        return Array.isArray(content) && content.some(
          (block) => block?.type === "toolCall" && (requiredTool ? block.name === requiredTool : ["click", "input_text", "scroll", "hotkey", "long_press", "drag", "wait", "long_wait", "screenshot", "open_in_browser", "open_in_finder", "list_apps", "open_app", "code_agent", "code_agent_status", "code_agent_stop"].includes(block.name)),
        );
      });
      if (!calledOrbTool) continue;
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const message = entries[index]?.message;
        if (message?.role !== "assistant") continue;
        return ["stop", "error"].includes(message.stopReason);
      }
    }
  }
  return false;
}

function sessionEntryCount() {
  const sessionsRoot = join(agentDir, "sessions");
  if (!existsSync(sessionsRoot)) return 0;
  let count = 0;
  for (const directory of readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    for (const file of readdirSync(join(sessionsRoot, directory.name))) {
      if (file.endsWith(".jsonl")) count += readJsonl(join(sessionsRoot, directory.name, file)).length;
    }
  }
  return count;
}

function modelHasToolCall(toolName) {
  const sessionsRoot = join(agentDir, "sessions");
  if (!existsSync(sessionsRoot)) return false;
  for (const directory of readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    for (const file of readdirSync(join(sessionsRoot, directory.name))) {
      if (!file.endsWith(".jsonl")) continue;
      if (readJsonl(join(sessionsRoot, directory.name, file)).some((entry) =>
        entry?.message?.content?.some?.((block) => block?.type === "toolCall" && block.name === toolName),
      )) return true;
    }
  }
  return false;
}

let grid = null;
let shell = null;
let piWeb = null;
let probeServer = null;
let shellOut = "";
let piWebLog = "";

function shutdown(code) {
  const nativePid = readJsonl(gridLogPath).find(entry => entry.kind === "native-ready")?.pid;
  if (nativePid) try { execFileSync("taskkill.exe", ["/PID", String(nativePid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch { /* target already closed */ }
  probeServer?.close();
  for (const child of [shell, piWeb, grid]) {
    try {
      if (!child?.pid) continue;
      if (process.platform === "win32") {
        execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        child.kill();
      }
    } catch {
      /* ignore */
    }
  }
  // Remove the private temporary agent dir, including copied credentials,
  // so no credential copy is deliberately retained after the probe.
  try {
    rmSync(agentDir, { recursive: true, force: true });
  } catch {
    /* not fatal: the run directory is the record */
  }
  process.exit(code);
}

// ---------------------------------------------------------------------------
// 1. Isolated agent dir: temporary model configuration and credentials, with no write-through.
// ---------------------------------------------------------------------------
function stageAgentDir() {
  const modelsSource = join(REAL_AGENT_DIR, "models.json");
  const authSource = join(REAL_AGENT_DIR, "auth.json");
  if (!existsSync(modelsSource)) throw new Error(`no real models.json at ${modelsSource}`);

  // Disposable copy: a provider/SDK save must not write back to user settings.
  writeFileSync(join(agentDir, "models.json"), readFileSync(modelsSource), { mode: 0o600 });
  // Disposable credential copy; never committed, included in the report or kept on normal exit.
  if (existsSync(authSource)) writeFileSync(join(agentDir, "auth.json"), readFileSync(authSource), { mode: 0o600 });

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
    modelsJsonCopied: existsSync(join(agentDir, "models.json")),
    authJsonCopied: existsSync(join(agentDir, "auth.json")),
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
  grid = spawn(electronBinary, [targetAppDir, `--user-data-dir=${join(runRoot, "target-data")}`], {
    // The target is an Electron app too. Give each run its own profile so another disposable
    // target or the user's Electron instance cannot make this process exit after geometry is written.
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
function foregroundTarget(hwnd) {
  // The current flow attaches the first frame automatically; it only needs the disposable target
  // in front. The helper exits non-zero when it cannot foreground the window, so record that result.
  try {
    const raw = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(repo, "tests/integration/fixtures/activate-window.ps1"),
        "-Hwnd",
        String(hwnd),
        "-LogPath",
        wakeLogPath,
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
      return { ok: false, reason: "helper failed", message: String(error?.message ?? error).slice(0, 300) };
    }
  }
}

function getMainWindowHandle(processId) {
  const script = `$ErrorActionPreference = 'Stop'; (Get-Process -Id ${Number(processId)}).MainWindowHandle.ToInt64()`;
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { encoding: "utf8", timeout: 30000, windowsHide: true },
  );
  const handle = Number(output.trim().split(/\r?\n/).filter(Boolean).at(-1));
  return Number.isSafeInteger(handle) && handle > 0 ? handle : null;
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
        ...(testCase === "open-app" ? { PATH: `${runRoot};${process.env.PATH}`, PI_ORB_NATIVE_PROBE_LOG: gridLogPath } : {}),
        PI_ORB_CONFIG: configPath,
        PI_ORB_PI_WEB_URL: piWebBaseUrl,
        PI_ORB_PI_WEB_PASSWORD: PI_WEB_PASSWORD,
      },
      stdio: ["ignore", "pipe", "pipe"],
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

  // Wait for an interactive desktop before anything that needs one. The wait is bounded and reports the
  // reason it gave up; while a user is at the machine the lock is intermittent, so an immediate failure
  // would abandon runs that a short wait completes. Nothing is sent to a model either way.
  const desktop = await waitForInteractiveDesktop();
  report.steps.interactiveDesktop = desktop;

  // The target first, so its window is what the orb records as "the window the user was looking at".
  const geometry = await startTarget();
  if (testCase === "browser") {
    const nonce = randomUUID();
    probeServer = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/") {
        appendFileSync(gridLogPath, `${JSON.stringify({ at: Date.now(), kind: "browser-page" })}\n`);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><title>Pi Orb browser probe</title><style>body{margin:0;background:#15202b;color:white;font:24px sans-serif;display:grid;place-content:center;min-height:90vh}button{font:24px sans-serif;padding:45px 70px}</style><h1>Pi Orb browser probe</h1><button onclick="fetch('/complete',{method:'POST',body:'${nonce}'}).then(()=>this.textContent='COMPLETE')">MARK COMPLETE</button>`);
      } else if (req.method === "POST" && req.url === "/complete") {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
          if (body === nonce) appendFileSync(gridLogPath, `${JSON.stringify({ at: Date.now(), kind: "browser-click" })}\n`);
          res.writeHead(body === nonce ? 200 : 403); res.end();
        });
      } else { res.writeHead(404); res.end(); }
    });
    await new Promise((done, fail) => { probeServer.once("error", fail); probeServer.listen(PI_WEB_PORT + 2, "127.0.0.1", done); });
    caseConfig.instruction = `使用 open_in_browser 打开 ${browserUrl}，然后根据它返回的截图，仅点击标题 Pi Orb browser probe 页面内的 MARK COMPLETE 按钮。若截图显示页面仍在加载，可用 wait。不要使用 bash、code_agent 或网页文本工具；不得点击其他标签页或其他页面。完成后结束。`;
  }
  if (testCase === "open-app") {
    execFileSync("C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe", ["/nologo", "/target:winexe", `/out:${probeAppExe}`, "/reference:System.Windows.Forms.dll", join(repo, "tests/integration/fixtures/native-app-probe.cs")], { windowsHide: true });
    report.steps.nativeProbe = { name: probeAppName, executable: probeAppExe, initiallyRunning: false };
    caseConfig.instruction = `使用 open_app 以确切名称 ${probeAppName} 启动测试应用。然后只根据它返回的截图，点击标题 Pi Orb native probe 窗口内的 MARK COMPLETE 按钮。若仍在加载可用 wait；不要使用 bash 或 code_agent，也不要点击别的窗口。完成后结束。`;
  }
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
  check(
    "the isolated shell reports this run's workspace and a generation",
    status?.workspace === WORKSPACE && typeof generation === "number",
    safe({ workspace: status?.workspace, expectedWorkspace: WORKSPACE, generation }),
  );

  // -------------------------------------------------------------------------
  // Prerequisites that need NO desktop. These are checked before the desktop gate so the D-group
  // wiring (a real session in Orb mode, served by a real image-capable model, with the extension
  // loaded) is verified even when no window can be foregrounded.
  // -------------------------------------------------------------------------
  const sessionCreated = await orb(client, `window.orb.ensureSession()`);
  report.steps.session = sessionCreated;
  check("the isolated shell created a real pi-web session", typeof sessionCreated === "string" && sessionCreated.length > 0, safe(sessionCreated));

  // Which model will serve this session, and can it see images? A screenshot can only reach a model
  // that accepts image input, and pi-web refuses to upload one otherwise - so this is checked here
  // rather than discovered after spending a turn.
  //
  // Note on the tool list: pi-web exposes no endpoint that returns a session's tools (the agent routes
  // are `new`, `[id]/events`, `[id]/lease`, `[id]/bash-output`), so this harness does not invent one.
  // The P1 baseline's four Orb tools being offered is evidenced instead by the real session's own `toolCall` blocks
  // in the verdict below: a model cannot call a tool it was never offered. The provider-side schema
  // check is the separate stage `run-p1-06-tools.mjs` (7/7), which records what the provider receives.
  const models = await fetch(`${piWebBaseUrl}/api/models?cwd=${encodeURIComponent(WORKSPACE)}`, {
    headers: { authorization: authHeader },
  }).then((r) => r.json()).catch(() => null);
  const created = await fetch(`${piWebBaseUrl}/api/agent/new`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authHeader },
    body: JSON.stringify({ cwd: WORKSPACE, type: "ensure_session" }),
  }).then((r) => r.json()).catch(() => null);
  const selected = created?.model ?? null;
  const selectedId = selected?.modelId ?? selected?.id ?? null;
  const entry = (models?.modelList ?? []).find((m) => m.provider === selected?.provider && m.id === selectedId);
  report.steps.model = {
    sessionId: created?.sessionId ?? null,
    selected,
    input: entry?.input ?? null,
    declaredImageCapable: Boolean(entry?.input?.includes("image")),
  };
  check(
    "the session is served by a model that declares image input",
    report.steps.model.declaredImageCapable === true,
    safe(report.steps.model),
  );

  // Fail before window enumeration when the workstation is locked. The reference backend correctly
  // hides locked-session windows, so a later empty candidate list is only a symptom of this state.
  const desktopBeforeTarget = await waitForInteractiveDesktop(120_000);
  report.steps.interactiveDesktopBeforeTarget = desktopBeforeTarget;
  if (
    !check(
      "an interactive desktop is available before target enumeration",
      isInteractiveDesktop(desktopBeforeTarget),
      safe(desktopBeforeTarget),
    )
  ) {
    throw new Error(
      `no interactive desktop: foreground is ${desktopBeforeTarget?.process ?? "?"} (${desktopBeforeTarget?.title ?? "untitled"}) and the input desktop is not accessible. ` +
        "The workstation appears to be locked; unlock it and re-run. Nothing was sent to any model.",
    );
  }

  let targetHandle = null;
  for (let attempt = 0; attempt < 20 && !targetHandle; attempt += 1) {
    targetHandle = getMainWindowHandle(grid.pid);
    if (!targetHandle) await sleep(1000);
  }
  report.steps.testTarget = { pid: grid.pid, handle: targetHandle, selection: "test harness only" };
  if (!check("the harness can foreground its disposable target by process id", targetHandle !== null, safe(report.steps.testTarget))) {
    throw new Error("target window handle not available");
  }

  // Foreground the disposable window and wake the Orb. The shell records the screenshot target before
  // it takes focus; desktop tools independently observe the current foreground window on each call.
  //
  // This is the first step that needs a real interactive desktop: while the session is locked no window
  // can be foregrounded, so the product would record the lock screen and then correctly refuse to
  // capture it - a message that misattributes an environmental condition to a product defect. The lock
  // is intermittent while a user is at the machine, so this re-waits here (freshly, not from the earlier
  // sample) rather than giving up on one locked moment.
  const desktopAtWake = await waitForInteractiveDesktop(120_000);
  report.steps.interactiveDesktopAtWake = desktopAtWake;
  if (
    !check(
      "an interactive desktop is available to foreground the target",
      isInteractiveDesktop(desktopAtWake),
      safe(desktopAtWake),
    )
  ) {
    throw new Error(
      `no interactive desktop: foreground is ${desktopAtWake?.process ?? "?"} (${desktopAtWake?.title ?? "untitled"}) and the input desktop is not accessible. ` +
        "The workstation appears to be locked; unlock it and re-run. Nothing was sent to any model.",
    );
  }
  const wake = foregroundTarget(targetHandle);
  report.steps.foreground = wake;
  if (!check("the disposable target is the foreground window before the first frame", wake?.ok === true, safe(wake))) {
    throw new Error("the disposable target could not be foregrounded");
  }
  await sleep(3000);

  const access = await orb(client, `window.orb.setOrbAccess({ generation: ${generation}, level: ${JSON.stringify(accessLevel)} })`);
  report.steps.access = { authorized: access?.authorized, level: access?.level, sessionId: access?.sessionId };
  check(`${accessLevel} is granted to the isolated Orb session`, access?.authorized === true && access?.level === accessLevel, safe(report.steps.access));

  const instruction = caseConfig.instruction;

  // Send a normal prompt. `before_agent_start` attaches the current target frame automatically;
  // this is the current reference flow and does not require a preview or observe tool call.
  const gridBefore = readJsonl(gridLogPath).length;
  const sent = await orb(client, `window.orb.sendPrompt({ generation: ${generation}, text: ${JSON.stringify(instruction)} })`);
  report.steps.prompt = sent;
  check("the prompt was sent with automatic frontmost-window context", sent?.accepted !== false, safe(sent));

  // Wait for the real model to work. Long: a real turn includes screenshot understanding.
  const deadline = Date.now() + 420_000;
  let idleSeen = false;
  let busySeen = false;
  let d8FollowUpSent = false;
  let d8FollowUpBaseline = 0;
  while (Date.now() < deadline) {
    await sleep(5000);
    // Wait for the model turn to finish. A wheel outside the strip, a wrong-cell
    // click, or a partial text event must not stop the run while it is correcting.
    const currentStatus = await orb(client, "window.orb.getStatus()");
    if (currentStatus?.busy === true) busySeen = true;
    const turnFinished = d8FollowUpSent
      ? modelTurnFinished("input_text", d8FollowUpBaseline)
      : modelTurnFinished();
    if ((busySeen && currentStatus?.busy === false) || turnFinished) {
      if (testCase === "d8-type" && !d8FollowUpSent && !modelHasToolCall("input_text")) {
        d8FollowUpBaseline = sessionEntryCount();
        const response = await fetch(`${piWebBaseUrl}/api/agent/${encodeURIComponent(report.steps.model.sessionId)}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: authHeader },
          body: JSON.stringify({
            type: "prompt",
            message: "Continue the disposable-window task under the same session Access grant. The input field was clicked and that action returned a fresh screenshot. Use input_text with exactly P1ORBD8TEST. Do not call any observation tool or click/type anywhere else.",
          }),
        });
        report.steps.d8FollowUp = { status: response.status, accepted: response.ok };
        d8FollowUpSent = response.ok;
        busySeen = false;
        if (response.ok) continue;
      }
      if (testCase === "d8-type" && d8FollowUpSent && !turnFinished) {
        busySeen = false;
        continue;
      }
      idleSeen = true;
      break;
    }
  }
  report.steps.waitedForIdle = idleSeen;

  // ---- Verdicts, all from primary sources ----

  // 1. The target's own log: which cell received the press.
  const gridEvents = readJsonl(gridLogPath);
  const hits = gridEvents.filter((event) => event.kind === caseConfig.targetEvent);
  report.targetLog = {
    events: gridEvents.map((event) => ({
      kind: event.kind,
      cell: event.cell ?? null,
      offsetInCell: event.offsetInCell ?? null,
      value: event.value ?? null,
      deltaY: event.deltaY ?? null,
      overScroller: event.overScroller ?? null,
      scrollTop: event.scrollTop ?? null,
    })),
    matches: hits,
    cellDowns: hits.map((event) => ({ cell: event.cell, offsetInCell: event.offsetInCell })),
  };
  if (testCase === "c7") {
    check("C7 (target's own log): a cell-mousedown for the cell marked 0,0 arrived", hits.some((event) => event.cell === "0,0"), safe(report.targetLog.cellDowns));
  } else if (testCase === "d6-scroll") {
    const scrollEvents = gridEvents.filter((event) => event.kind === "scroll");
    report.targetLog.scrollEvents = scrollEvents;
    check("D6 (target's own log): the strip received wheel input", hits.some((event) => event.overScroller === true), safe(hits));
    check("D6 (target's own log): the strip scroll position changed", scrollEvents.some((event) => typeof event.scrollTop === "number" && event.scrollTop > 0), safe(scrollEvents));
  } else if (testCase === "d8-type") {
    check("D8 (target's own log): the exact synthetic marker reached the text field", hits.some((event) => event.value === "P1ORBD8TEST"), safe(hits));
  } else {
    check("the disposable page or application recorded its completion click", hits.length > 0, safe(hits));
  }

  // 2. The real session record: did the model itself call the orb tools?
  //
  //    The field is `name`, not `toolName`: verified against a real session file, where a toolCall
  //    block is `{ type, id, name, arguments }`. Reading the wrong key here would report "the model
  //    never called the tool" on a perfect run, which is the worst possible false negative for C7, so
  //    both spellings are accepted and the raw block shapes are kept in the report.
  const sessionFiles = [];
  const sessionsRoot = join(agentDir, "sessions");
  if (existsSync(sessionsRoot)) {
    for (const entry of readdirSync(sessionsRoot, { withFileTypes: true })) {
      // The directory also holds plain files (e.g. `.last-cleanup`), so only descend into directories.
      if (!entry.isDirectory()) continue;
      const full = join(sessionsRoot, entry.name);
      for (const file of readdirSync(full)) {
        if (file.endsWith(".jsonl")) sessionFiles.push(join(full, file));
      }
    }
  }
  report.sessionFiles = sessionFiles.map((file) => file.replace(agentDir, "<agentDir>"));
  const calls = [];
  const toolResults = [];
  const firstFrames = [];
  for (const file of sessionFiles) {
    for (const [index, entry] of readJsonl(file).entries()) {
      if (entry.type === "custom_message" && entry.customType === "computer-use" && Array.isArray(entry.content)) {
        firstFrames.push({ file, index, imageCount: entry.content.filter(part => part?.type === "image").length });
        // Save only the confirmed disposable target frame, never a user's window.
        if (entry.content.some(part => part?.type === "text" && /<frontmost_window>P1-05 input target<\/frontmost_window>/u.test(part.text))) {
          const frame = entry.content.find(part => part?.type === "image");
          if (frame) writeFileSync(join(runRoot, `first-frame-${index}.png`), Buffer.from(frame.data, "base64"));
        }
      }
      const message = entry?.message;
      const content = message?.content;
      if (message?.role === "toolResult" && Array.isArray(content)) {
        toolResults.push({
          toolName: message.toolName ?? null,
          toolCallId: message.toolCallId ?? null,
          text: content.filter((part) => part?.type === "text").map((part) => part.text ?? "").join("\n"),
          imageCount: content.filter((part) => part?.type === "image").length,
          index,
          ok: message.details?.ok === true,
          observation: message.details?.result?.observation ? {
            id: message.details.result.observation.observationId,
            at: message.details.result.observation.at,
            title: message.details.result.observation.window?.title,
          } : null,
        });
      }
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type !== "toolCall") continue;
        const name = typeof block.name === "string" ? block.name : typeof block.toolName === "string" ? block.toolName : null;
        if (!name) continue;
        calls.push({ toolName: name, toolCallId: block.id ?? null, arguments: block.arguments ?? null, file, index, at: Date.parse(entry.timestamp) });
      }
    }
  }
  report.modelToolCalls = calls.map(({ file, ...call }) => ({ ...call, file: file.replace(agentDir, "<agentDir>") }));
  report.modelToolResults = toolResults;
  const actionCalls = calls.filter((call) => call.toolName === caseConfig.expectedTool);
  check(`the real model called ${caseConfig.expectedTool} on its own`, actionCalls.length > 0, safe(actionCalls.slice(0, 2)));
  check("the automatic frontmost screenshot preceded the GUI action", actionCalls.length > 0 && actionCalls.every(call => firstFrames.some(frame => frame.file === call.file && frame.index < call.index && frame.imageCount > 0)), safe(firstFrames.map(({ file, ...frame }) => ({ ...frame, file: file.replace(agentDir, "<agentDir>") }))));
  const actionCallIds = new Set(actionCalls.map((call) => call.toolCallId).filter(Boolean));
  const actionResults = toolResults.filter((result) => actionCallIds.has(result.toolCallId));
  const hasFreshFrame = result => {
    const call = calls.find(value => value.toolCallId === result?.toolCallId);
    return result?.ok === true && result.imageCount > 0 && Boolean(result.observation?.id)
      && result.observation.at >= call?.at && (result.observation.title ?? "").includes(caseConfig.resultTitle ?? "P1-05 input target");
  };
  check(
    "the action tool result includes its fresh observation and screenshot",
    actionResults.length > 0 && actionResults.every(hasFreshFrame),
    safe(actionResults),
  );
  if (testCase === "d8-type") {
    const clickIndex = calls.findIndex((call) => call.toolName === "click");
    const typeIndex = calls.findIndex((call) => call.toolName === "input_text");
    check("D8: the model clicked the disposable field before typing", clickIndex >= 0 && clickIndex < typeIndex, safe(calls.map((call) => call.toolName)));
    const clickCallId = calls[clickIndex]?.toolCallId;
    const clickResult = toolResults.find((result) => result.toolCallId === clickCallId);
    check(
      "D8: the focus click returned a fresh screenshot",
      hasFreshFrame(clickResult),
      safe({ imageCount: clickResult?.imageCount ?? 0, clickResult: clickResult?.text }),
    );
    check(
      "D8: input_text returned a fresh screenshot after typing",
      hasFreshFrame(toolResults.find((result) => result.toolCallId === calls[typeIndex]?.toolCallId)) && toolResults.find(result => result.toolCallId === calls[typeIndex]?.toolCallId)?.observation.id !== clickResult?.observation?.id,
      safe(toolResults.find((result) => result.toolCallId === calls[typeIndex]?.toolCallId)),
    );
  }
  if (testCase === "browser" || testCase === "open-app") {
    const openName = testCase === "browser" ? "open_in_browser" : "open_app";
    const openCall = calls.find(call => call.toolName === openName);
    check("the real model used the reference entry tool with the isolated target", Boolean(openCall) && (testCase === "browser" ? openCall.arguments?.url === browserUrl : openCall.arguments?.name === probeAppName), safe(openCall));
    const firstClick = actionCalls[0];
    check("a screenshot of the opened target preceded the model click", Boolean(firstClick) && toolResults.some(result => [openName, "wait"].includes(result.toolName) && result.index < firstClick.index && result.imageCount > 0 && (result.observation?.title ?? "").includes(caseConfig.resultTitle)), safe(toolResults));
    check("the model used only GUI tools to reach the completion oracle", calls.every(call => [openName, "wait", "click"].includes(call.toolName)), safe(calls.map(call => call.toolName)));
  }
  if (testCase === "c7" || testCase === "d6-scroll") {
    const positionAction = actionCalls.find((call) => call.toolName === "click" || call.toolName === "scroll");
    const args = positionAction?.arguments ?? null;
    const position = args?.position;
    check(
      "the real model addressed the action in the 0-1000 screenshot space",
      Array.isArray(position) && position.length === 2 && position.every((value) => typeof value === "number" && value >= 0 && value <= 1000),
      safe({ args, position }),
    );
  }

  report.passed = report.checks.every((entry) => entry.ok);
  report.steps.bridgeDiagnostics = shellOut
    .split(/\r?\n/)
    .filter((line) => line.includes("[pi-orb] desktop ") || line.includes("[pi-orb] bridge "))
    .slice(-40);
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(runRoot, "result.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`checks: ${report.checks.filter((c) => c.ok).length}/${report.checks.length}`);
  for (const entry of report.checks) {
    console.log(`  [${entry.ok ? "PASS" : "FAIL"}] ${entry.name}`);
    if (!entry.ok) console.log(`         ${String(entry.detail).slice(0, 400)}`);
  }
  console.log("");
  console.log("target log matches:", safe(report.targetLog.matches, 500));
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
