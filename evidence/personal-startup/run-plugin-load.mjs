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
writeFileSync(join(root, "code-agent-sessions.json"), JSON.stringify([{ owner: "orb", session_id: "worker", cwd: root, task: "Research", status: "running", pending: false, outcome: "", tools: ["read", "write"] }]));
process.env.PI_ORB_CONFIG = config;
const checks = [];
for (const [mode, cwd] of [["ordinary", root], ["orb", workspace], ["worker", root]]) {
  const loaded = await discoverAndLoadExtensions([join(root, "plugin")], cwd, join(root, "agent"));
  const extension = loaded.extensions[0];
  const baselineTools = ["read", "write", "edit", "bash", "powershell", "web_search", "web_fetch", "fetch_content", "get_search_content", "source_check", "ask_user_question", "advisor"];
  let activeTools = ["read", "advisor"];
  const activeToolCalls = [];
  loaded.runtime.getActiveTools = () => activeTools;
  loaded.runtime.setActiveTools = (names) => { activeTools = [...names]; activeToolCalls.push([...names]); };
  loaded.runtime.getAllTools = () => [...new Set([...baselineTools, ...(extension ? extension.tools.keys() : [])])].map(name => ({ name }));
  checks.push({ name: `${mode}: real Pi loader accepts packaged independent extension`, ok: loaded.errors.length === 0 && loaded.extensions.length === 1, detail: loaded.errors });
  if (!extension) continue;
  const context = { cwd, model: { input: ["text", "image"] }, sessionManager: { getSessionId: () => mode } };
  for (const handler of extension.handlers.get("session_start") ?? []) await handler({ type: "session_start" }, context);
  const start = { type: "before_agent_start", prompt: "Inspect the current application", systemPrompt: "", systemPromptOptions: { sections: {} } };
  for (const handler of extension.handlers.get("before_agent_start") ?? []) await handler(start, context);
  const policy = start.systemPromptOptions.sections.orb_mode ?? "";
  checks.push({ name: `${mode}: packaged policy follows workspace boundary`, ok: mode !== "orb" ? policy === "" : policy.includes("Unrelated new background work") && policy.includes("Working directory for a new code_agent session") && policy.includes("0–1000"), detail: { policyChars: policy.length } });
  const originalMessages = ["old", "latest"].map(data => ({ role: "custom", customType: "computer-use", display: false, timestamp: 1, content: [{ type: "image", data, mimeType: "image/png" }] }));
  const contextEvent = { type: "context", messages: originalMessages };
  for (const handler of extension.handlers.get("context") ?? []) {
    const result = await handler(contextEvent, context);
    if (result?.messages) contextEvent.messages = result.messages;
  }
  checks.push({ name: `${mode}: packaged context projection preserves history and workspace boundary`, ok: originalMessages[0].content[0].type === "image" && contextEvent.messages[0].content[0].type === (mode !== "orb" ? "image" : "text") && contextEvent.messages[1].content[0].data === "latest", detail: { first: contextEvent.messages[0].content[0].type, persistedFirst: originalMessages[0].content[0].type } });
  const tools = [...extension.tools.keys()];
  const expected = mode !== "orb" ? [] : ["click", "input_text", "scroll", "hotkey", "long_press", "drag", "wait", "long_wait", "screenshot", "open_in_browser", "open_in_finder", "list_apps", "open_app", "code_agent", "code_agent_status", "code_agent_stop"];
  checks.push({ name: `${mode}: native tools follow workspace boundary`, ok: JSON.stringify(tools.sort()) === JSON.stringify(expected.sort()), detail: tools });
  const expectedActive = mode === "ordinary" ? ["read", "advisor"] : mode === "worker" ? ["read", "write", "web_search", "web_fetch", "fetch_content", "get_search_content", "source_check"] : ["read", "write", "edit", "bash", "powershell", "web_search", "web_fetch", "fetch_content", "get_search_content", "source_check", "ask_user_question", ...expected];
  checks.push({ name: `${mode}: active tool roster follows workspace boundary`, ok: JSON.stringify([...activeTools].sort()) === JSON.stringify([...expectedActive].sort()) && (mode === "ordinary" || activeToolCalls.length > 0), detail: { activeTools, activeToolCalls } });
}
const result = { capturedAt: new Date().toISOString(), root, version, checks, passed: checks.every(check => check.ok) };
writeFileSync(join(import.meta.dirname, "plugin-load.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.passed ? 0 : 1);
