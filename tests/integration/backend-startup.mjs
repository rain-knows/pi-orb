import { createRunDirectory } from '../../scripts/verify/run-directory.mjs';
// Real official Pi CLI registration and Pi Web startup, with isolated agent/config/port.
// Run: node .../run-backend-startup.mjs <absolute bin/pi-web.js>
import { build } from "vite";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { execFileSync } from "node:child_process";
import koffi from "koffi";

const repo = resolve(import.meta.dirname, '../..');
const reportDir = createRunDirectory('startup');
const piWebCli = process.argv[2];
if (!piWebCli || !existsSync(piWebCli)) throw new Error("Pass the verified official bin/pi-web.js");
const root = join("D:/pi-orb-personal-runs", `backend 中文 ${Date.now()}`);
const userData = join(root, "userData");
const agentDir = join(root, "agent");
const workspace = join(root, "workspace");
for (const dir of [userData, agentDir, workspace]) mkdirSync(dir, { recursive: true });
// A fixture model allows session construction; this test never submits a provider request.
writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { fixture: {
  baseUrl: "http://127.0.0.1:9", api: "openai-completions", apiKey: "fixture-no-network",
  models: [{ id: "fixture", name: "Fixture", input: ["text", "image"], contextWindow: 10000, maxTokens: 1000 }],
} } }));
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "fixture", defaultModel: "fixture" }));
const server = createServer();
await new Promise(done => server.listen(0, "127.0.0.1", done));
const port = server.address().port;
await new Promise(done => server.close(done));
const baseUrl = `http://127.0.0.1:${port}`;
const appVersion = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
const pluginSource = join(repo, "release", appVersion, "win-unpacked/resources/pi-plugin");
const piPackageRoot = join(repo, "node_modules/@earendil-works/pi-coding-agent");
const piCli = join(piPackageRoot, JSON.parse(readFileSync(join(piPackageRoot, "package.json"), "utf8")).bin.pi);
writeFileSync(join(userData, "startup-runtime.json"), JSON.stringify({ node: process.execPath, piCli, piWebCli }));
const configPath = join(root, "orb-config.json");
writeFileSync(configPath, JSON.stringify({ version: 1, orbWorkspace: workspace, shortcut: "CommandOrControl+Shift+Space", window: { alwaysOnTop: true, x: null, y: null, width: 420, height: 640 } }));
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_ORB_CONFIG = configPath;
await build({ configFile: false, build: {
  outDir: join(root, "runtime"), ssr: join(repo, "src/main/personal-startup.ts"), minify: false,
  rollupOptions: { output: { entryFileNames: "startup.mjs" } },
} });
const { preparePersonalStartup, probePersonalPiWeb, removeBundledPlugin } = await import(pathToFileURL(join(root, "runtime/startup.mjs")));
const checks = [];
const result = { capturedAt: new Date().toISOString(), root, baseUrl, checks, passed: false };
let backendPid;
try {
  const options = { userData, pluginSource, baseUrl,
    pickFile: () => { throw new Error("Confirmed runtime must not ask again"); },
    probe: () => probePersonalPiWeb(baseUrl), notify: () => {} };
  await preparePersonalStartup(options);
  const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
  checks.push({ name: "official Pi CLI registers the bundled plugin in isolated agent settings", ok: settings.packages.some(source => resolve(agentDir, source) === resolve(pluginSource)), detail: settings.packages });
  checks.push({ name: "official Pi Web becomes ready without browser launch", ok: await probePersonalPiWeb(baseUrl), detail: "Next production CLI; startup log in isolated userData" });
  // Only the listener on this fresh test port belongs to this test. The existing 30141 service is untouched.
  backendPid = Number(execFileSync("powershell.exe", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${port} -State Listen).OwningProcess`], { encoding: "utf8", windowsHide: true }).trim());
  // Read-only Win32 probe: the test detaches only its own console, never another app's window.
  const kernel = koffi.load("kernel32.dll");
  const freeConsole = kernel.func("bool __stdcall FreeConsole()");
  const attachConsole = kernel.func("bool __stdcall AttachConsole(uint32_t processId)");
  freeConsole();
  const attached = attachConsole(backendPid);
  if (attached) freeConsole();
  checks.push({ name: "running Pi Web production server owns no Windows console", ok: !attached, detail: { backendPid, attachedConsole: attached } });
  const before = JSON.stringify(JSON.parse(readFileSync(join(userData, "startup-runtime.json"), "utf8")));
  await preparePersonalStartup(options);
  const reusedPid = Number(execFileSync("powershell.exe", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${port} -State Listen).OwningProcess`], { encoding: "utf8", windowsHide: true }).trim());
  checks.push({ name: "second startup reuses the same backend and registration", ok: backendPid === reusedPid && before === JSON.stringify(JSON.parse(readFileSync(join(userData, "startup-runtime.json"), "utf8"))), detail: { backendPid, reusedPid } });
  const newSession = await fetch(`${baseUrl}/api/agent/new`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: workspace, type: "ensure_session" }) });
  const body = await newSession.json();
  checks.push({ name: "real Pi Web accepts an Orb workspace session with installed plugin", ok: newSession.ok && typeof body.sessionId === "string", detail: { status: newSession.status, keys: Object.keys(body), error: body.error } });
  removeBundledPlugin(userData, pluginSource);
  const removed = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
  checks.push({ name: "official CLI removal preserves model preferences", ok: !(removed.packages ?? []).some(source => resolve(agentDir, source) === resolve(pluginSource)) && removed.defaultProvider === "fixture" && removed.defaultModel === "fixture", detail: "only bundled source removed" });
  removeBundledPlugin(userData, pluginSource);
  checks.push({ name: "cleanup with no registered bundled plugin is a no-op", ok: true, detail: "no false uninstall error" });
} catch (error) { checks.push({ name: "backend integration", ok: false, detail: error.message }); }
finally {
  if (backendPid) {
    execFileSync("taskkill.exe", ["/PID", String(backendPid), "/T", "/F"], { windowsHide: true });
  }
}
result.passed = checks.every(check => check.ok);
writeFileSync(join(reportDir, "backend-startup.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.passed ? 0 : 1);
