import { createRunDirectory } from '../../scripts/verify/run-directory.mjs';
// Actual per-user NSIS install, ShellExecute short-name startup, single-instance wake and uninstall.
// Uses an isolated application profile and refuses to replace an existing registered installation.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, '../..');
const reportDir = createRunDirectory('startup');
const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
const installer = join(repo, "release", version, `pi-orb-${version}-win-x64.exe`);
const root = join("D:/pi-orb-personal-runs", `install 中文 ${Date.now()}`);
const installDir = join(root, "app");
const userData = join(root, "profile");
mkdirSync(root, { recursive: true });
const result = { capturedAt: new Date().toISOString(), version, root, checks: [], passed: false };
const check = (name, ok, detail) => result.checks.push({ name, ok: Boolean(ok), detail });
const psPath = join(root, "shell.ps1");
writeFileSync(psPath, `param([string]$Action, [string]$Arguments)
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\pi-orb.exe'
if ($Action -eq 'registry') {
  if (Test-Path -LiteralPath $key) { (Get-Item -LiteralPath $key).GetValue('') }
} elseif ($Action -eq 'launch') {
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = 'pi-orb'
  $info.Arguments = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Arguments))
  $info.UseShellExecute = $true
  $process = [Diagnostics.Process]::Start($info)
  $process.Id
} elseif ($Action -eq 'stop') {
  Stop-Process -Id ([int]$Arguments) -Force -ErrorAction SilentlyContinue
}
`, "utf8");
function powershell(action, args = "") {
  const argument = action === "launch" ? Buffer.from(args, "utf8").toString("base64") : args;
  return execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psPath, action, argument], {
    encoding: "utf8", windowsHide: true, timeout: 30000,
  }).trim();
}
if (powershell("registry")) throw new Error("An installation is already registered. Refuse to overwrite it in this probe.");
const configPath = join(root, "orb-config.json");
writeFileSync(configPath, JSON.stringify({ version: 1, orbWorkspace: null, shortcut: "CommandOrControl+Alt+F11", window: { alwaysOnTop: true, x: null, y: null, width: 420, height: 640 } }));
process.env.PI_ORB_CONFIG = configPath;
process.env.PI_ORB_PI_WEB_URL = "http://127.0.0.1:31997";
delete process.env.ELECTRON_RUN_AS_NODE;
const debugPort = 31996;
const args = `--user-data-dir="${userData}" --remote-debugging-port=${debugPort}`;
let mainPid;
let installed = false;
let socket;
const sleep = ms => new Promise(done => setTimeout(done, ms));
try {
  execFileSync(installer, ["/S", `/D=${installDir}`], { windowsHide: true, timeout: 600000, windowsVerbatimArguments: true });
  installed = true;
  const exe = join(installDir, "pi-orb.exe");
  check("NSIS installs in a per-user Chinese/space directory", existsSync(exe), installDir);
  check("installer registers the actual executable for ShellExecute", powershell("registry").toLowerCase() === exe.toLowerCase(), "HKCU App Paths");
  const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
  check("installed executable equals the audited build", hash(exe) === hash(join(repo, "release", version, "win-unpacked/pi-orb.exe")), hash(exe));
  mainPid = Number(powershell("launch", args));
  let page;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { page = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find(target => target.type === "page" && target.url.includes("index.html")); } catch { /* startup */ }
    if (page) break;
    await sleep(200);
  }
  if (!page) throw new Error("Installed short-name launch did not expose a renderer");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", fail, { once: true }); });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const data = JSON.parse(event.data);
    if (!pending.has(data.id)) return;
    pending.get(data.id)(data.result); pending.delete(data.id);
  });
  const evaluate = expression => new Promise(done => {
    const id = ++nextId;
    pending.set(id, response => done(response.result?.value));
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  check("ShellExecute pi-orb starts the installed sandboxed renderer", await evaluate("typeof window.orb") === "object", mainPid);
  await sleep(1500);
  const handshakePath = join(userData, "bridge-token.json");
  const before = JSON.parse(readFileSync(handshakePath, "utf8"));
  await evaluate("document.querySelector('textarea').value='preserved draft'; window.orb.collapseOrb().then(()=>true)");
  await sleep(600);
  const secondPid = Number(powershell("launch", args));
  await sleep(1500);
  const after = JSON.parse(readFileSync(handshakePath, "utf8"));
  check("second short-name startup preserves primary bridge identity", before.pid === after.pid && before.token === after.token && before.pid === mainPid, { mainPid, secondPid, bridgePid: after.pid });
  check("second invocation restores the same page and draft", await evaluate("document.visibilityState === 'visible' && document.querySelector('textarea').value === 'preserved draft'"), "same CDP page");
  powershell("stop", String(mainPid)); mainPid = undefined;
  socket.close(); socket = undefined;
  execFileSync(join(installDir, "Uninstall pi-orb.exe"), ["/S"], { windowsHide: true, timeout: 180000 });
  // NSIS relaunches the uninstaller in a temporary directory; the original process exits first.
  let removed = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (!powershell("registry") && !existsSync(exe)) { removed = true; break; }
    await sleep(1000);
  }
  installed = !removed;
  check("uninstall removes only this installation's App Paths registration", removed, "registration and installed executable absent");
  check("uninstall preserves the application profile", existsSync(configPath) && existsSync(userData), "profile and workspace config remain");
} catch (error) { check("installer integration", false, error.message); }
finally {
  socket?.close();
  if (mainPid) powershell("stop", String(mainPid));
  if (installed && existsSync(join(installDir, "Uninstall pi-orb.exe"))) {
    execFileSync(join(installDir, "Uninstall pi-orb.exe"), ["/S"], { windowsHide: true, timeout: 180000 });
  }
}
result.passed = result.checks.every(entry => entry.ok);
writeFileSync(join(reportDir, "installer-smoke.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.passed ? 0 : 1);
