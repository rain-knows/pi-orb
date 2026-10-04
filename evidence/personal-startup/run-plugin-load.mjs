// Verify the packaged payload through the real Pi 1.0 extension loader in an unrelated directory.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

const repo = resolve(import.meta.dirname, "../..");
const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
const source = join(repo, "release", version, "win-unpacked/resources/pi-plugin");
const root = join("D:/pi-orb-personal-runs", `plugin 中文 ${Date.now()}`);
mkdirSync(root, { recursive: true });
cpSync(source, join(root, "plugin"), { recursive: true });
const config = join(root, "orb-config.json");
const workspace = join(root, "workspace");
mkdirSync(workspace);
writeFileSync(config, JSON.stringify({ version: 1, orbWorkspace: workspace, shortcut: "CommandOrControl+Shift+Space", window: { alwaysOnTop: true, x: null, y: null, width: 420, height: 640 } }));
process.env.PI_ORB_CONFIG = config;
const checks = [];
for (const [mode, cwd] of [["ordinary", root], ["orb", workspace]]) {
  const loaded = await discoverAndLoadExtensions([join(root, "plugin")], cwd, join(root, "agent"));
  loaded.runtime.getActiveTools = () => ["read", "advisor"];
  loaded.runtime.setActiveTools = () => {};
  checks.push({ name: `${mode}: real Pi loader accepts packaged independent extension`, ok: loaded.errors.length === 0 && loaded.extensions.length === 1, detail: loaded.errors });
  const extension = loaded.extensions[0];
  if (!extension) continue;
  for (const handler of extension.handlers.get("session_start") ?? []) await handler({ type: "session_start" }, { cwd, sessionManager: { getSessionId: () => mode } });
  const tools = [...extension.tools.keys()];
  const expected = mode === "ordinary" ? ["orb_browser"] : ["orb_browser", "orb_observe", "orb_click", "orb_type", "orb_scroll", "orb_hotkey", "orb_long_press", "orb_open_app", "orb_drag", "orb_wait", "orb_long_wait", "orb_list_apps", "orb_batch"];
  checks.push({ name: `${mode}: native tools follow workspace boundary`, ok: JSON.stringify(tools.sort()) === JSON.stringify(expected.sort()), detail: tools });
}
const result = { capturedAt: new Date().toISOString(), root, version, checks, passed: checks.every(check => check.ok) };
writeFileSync(join(import.meta.dirname, "plugin-load.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.passed ? 0 : 1);
