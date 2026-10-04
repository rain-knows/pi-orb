/** Personal Windows startup adapter. Uses official Node/Pi/Pi Web entrypoints only.
 * Reference: deepseek-harness-orb 72f1d738, desktop main/welcome and per-user NSIS posture.
 * Pi has a separate runtime boundary: no agent loop, credentials store or process-kill fallback here.
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { createRequire } from "node:module";

const execute = promisify(execFile);
interface StartupRuntime {
  node: string;
  piCli: string;
  piWebCli?: string;
  pluginDigest?: string;
  pluginSource?: string;
}
export interface PersonalStartupOptions {
  userData: string;
  pluginSource: string;
  baseUrl: string;
  password?: string;
  pickFile: (title: string, name: string) => Promise<string | undefined>;
  probe: () => Promise<boolean>;
  notify: (message: string) => void;
}

/** A foreign HTTP responder is not a reusable Pi Web instance. Bound the startup probe. */
export async function probePersonalPiWeb(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/", baseUrl), { signal: AbortSignal.timeout(2000) });
    return /<title>Pi Web<\/title>/u.test(await response.text());
  } catch { return false; }
}

/** Read only the package manifest's official bin; do not parse or execute .cmd wrappers. */
export function packageCli(root: string, expectedName: string, binName: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[binName];
    if (pkg.name !== expectedName || typeof bin !== "string") return undefined;
    const file = resolve(root, bin);
    if (!file.startsWith(`${resolve(root)}\\`) && !file.startsWith(`${resolve(root)}/`)) return undefined;
    return existsSync(file) ? file : undefined;
  } catch { return undefined; }
}

function onPath(name: string): string[] {
  try { return execFileSync("where.exe", [name], { encoding: "utf8", windowsHide: true }).trim().split(/\r?\n/u); }
  catch { return []; }
}

function globalCli(shim: string, packageName: string, bin: string): string | undefined {
  for (const path of onPath(shim)) {
    const entry = packageCli(join(dirname(path), "node_modules", packageName), packageName, bin);
    if (entry) return entry;
  }
  return undefined;
}

/** Start Pi Web's production build with Next's documented CLI, without an intermediate spawner.
 * Pi Web 0.10 bin/pi-web.js uses this same package cwd and PI_WEB_HOSTNAME. No source edits/hooks.
 */
export function piWebServerLaunch(piWebCli: string, url: URL): { args: string[]; cwd: string } {
  const root = resolve(dirname(piWebCli), "..");
  if (packageCli(root, "@agegr/pi-web", "pi-web") !== resolve(piWebCli)) throw new Error("Pi Web 入口与官方包不匹配。");
  if (!existsSync(join(root, ".next", "BUILD_ID"))) throw new Error("Pi Web 尚未完成生产构建；请先构建 Pi Web。");
  const require = createRequire(piWebCli);
  return { cwd: root, args: [require.resolve("next/dist/bin/next"), "start", "-p", url.port || "80", "-H", url.hostname] };
}

/** Refuse an occupied port even when the listener is not Pi Web. */
export async function assertPortAvailable(url: URL): Promise<void> {
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("自动启动仅用于本机 HTTP Pi Web；请先启动配置地址的服务。");
  }
  await new Promise<void>((done, fail) => {
    const server = createServer();
    server.once("error", () => fail(new Error(`端口 ${url.port || "80"} 已被占用；请检查原服务，Orb 不会关闭它。`)));
    server.listen(Number(url.port || 80), url.hostname, () => server.close(error => error ? fail(error) : done()));
  });
}

function settingsPath(): string {
  return join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "settings.json");
}

/** Configured local Orb packages only; npm/Git declarations belong to Pi and are untouched. */
export function localOrbPackages(settings: unknown, baseDir = dirname(settingsPath())): string[] {
  const entries = (settings as { packages?: unknown[] } | null)?.packages;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap(entry => {
    const source = typeof entry === "string" ? entry : (entry as { source?: unknown } | null)?.source;
    if (typeof source !== "string" || (/^[a-z]+:/iu.test(source) && !/^[a-z]:[\\/]/iu.test(source))) return [];
    const localPath = resolve(baseDir, source);
    try {
      return JSON.parse(readFileSync(join(localPath, "package.json"), "utf8")).name === "pi-orb-pi-package" ? [localPath] : [];
    } catch { return []; }
  });
}

/** First packaged startup registers the bundled plugin, then reuses/starts the official backend. */
export async function preparePersonalStartup(options: PersonalStartupOptions): Promise<void> {
  mkdirSync(options.userData, { recursive: true });
  const path = join(options.userData, "startup-runtime.json");
  let runtime: StartupRuntime;
  if (existsSync(path)) runtime = JSON.parse(readFileSync(path, "utf8"));
  else {
    const node = onPath("node.exe")[0] ?? await options.pickFile("选择已安装的 Node.js（node.exe）", "exe");
    const piCli = globalCli("pi.cmd", "@earendil-works/pi-coding-agent", "pi");
    if (!node || !piCli) throw new Error("请先安装 Node.js 和 Pi CLI，再启动 pi-orb。Pi 安装完成后，安装器内的插件会自动注册。");
    runtime = { node, piCli };
  }
  const save = () => {
    writeFileSync(`${path}.tmp`, JSON.stringify(runtime, null, 2), "utf8");
    renameSync(`${path}.tmp`, path);
  };
  const version = await execute(runtime.node, ["--version"], { windowsHide: true, timeout: 10000 });
  const parts = version.stdout.trim().replace(/^v/u, "").split(".").map(Number);
  if (parts[0]! < 24 || (parts[0] === 24 && parts[1]! < 19)) throw new Error("需要 Node.js >=24.19.0；请更新后再启动。");
  const digest = createHash("sha256").update(readFileSync(join(options.pluginSource, "orb.cjs")))
    .update(readFileSync(join(options.pluginSource, "package.json"))).digest("hex");
  const settingsFile = settingsPath();
  const settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : {};
  const sources = localOrbPackages(settings, dirname(settingsFile));
  const registered = sources.some(source => resolve(source).toLowerCase() === resolve(options.pluginSource).toLowerCase());
  if (!registered || runtime.pluginDigest !== digest) {
    if (existsSync(settingsFile)) copyFileSync(settingsFile, join(options.userData, `pi-settings-before-plugin-${Date.now()}.json`));
    await execute(runtime.node, [runtime.piCli, "install", options.pluginSource], { windowsHide: true, timeout: 30000, cwd: homedir() });
    for (const source of sources.filter(source => resolve(source).toLowerCase() !== resolve(options.pluginSource).toLowerCase())) {
      await execute(runtime.node, [runtime.piCli, "remove", source], { windowsHide: true, timeout: 30000, cwd: homedir() });
    }
    runtime.pluginDigest = digest;
    runtime.pluginSource = options.pluginSource;
    save();
    if (await options.probe()) options.notify("Pi 插件已安装/更新。若已有 Pi Web 会话未加载工具，请在网页任务结束后，用原有方式重启 Pi Web。Orb 不会重启已有服务。");
  }
  if (await options.probe()) return;
  const url = new URL(options.baseUrl);
  await assertPortAvailable(url);
  if (!runtime.piWebCli || !existsSync(runtime.piWebCli)) {
    const selected = globalCli("pi-web.cmd", "@agegr/pi-web", "pi-web")
      ?? await options.pickFile("首次启动：选择 Pi Web 安装目录内的 bin/pi-web.js", "js");
    if (!selected) throw new Error("未配置 Pi Web 启动入口；请先启动 piweb，或重新打开 Orb 选择 bin/pi-web.js。");
    const official = packageCli(resolve(dirname(selected), ".."), "@agegr/pi-web", "pi-web");
    if (!official || resolve(official).toLowerCase() !== resolve(selected).toLowerCase()) throw new Error("请选择官方 Pi Web 安装目录内的 bin/pi-web.js。");
    runtime.piWebCli = selected;
    save();
  }
  const launch = piWebServerLaunch(runtime.piWebCli, url);
  const log = openSync(join(options.userData, "pi-web-startup.log"), "a");
  const child = spawn(runtime.node, launch.args, {
    cwd: launch.cwd, windowsHide: true, detached: true, stdio: ["ignore", log, log],
    env: { ...process.env, PI_WEB_HOSTNAME: url.hostname, ...(options.password ? { PI_WEB_PASSWORD: options.password } : {}) },
  });
  closeSync(log);
  let failure: Error | undefined;
  child.once("error", error => { failure = error; });
  child.unref();
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await options.probe()) return;
    if (failure || child.exitCode !== null) break;
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error(`Pi Web 启动失败：${failure?.message ?? "服务未就绪"}。日志：${join(options.userData, "pi-web-startup.log")}`);
}

/** NSIS calls this before removing the bundled plugin; all other Pi packages and data remain. */
export function removeBundledPlugin(userData: string, pluginSource: string): void {
  const path = join(userData, "startup-runtime.json");
  if (!existsSync(path)) return;
  const settingsFile = settingsPath();
  if (!existsSync(settingsFile)) return;
  const sources = localOrbPackages(JSON.parse(readFileSync(settingsFile, "utf8")), dirname(settingsFile));
  if (!sources.some(source => resolve(source).toLowerCase() === resolve(pluginSource).toLowerCase())) return;
  const runtime = JSON.parse(readFileSync(path, "utf8")) as StartupRuntime;
  execFileSync(runtime.node, [runtime.piCli, "remove", pluginSource], { windowsHide: true, timeout: 30000, cwd: homedir() });
}
