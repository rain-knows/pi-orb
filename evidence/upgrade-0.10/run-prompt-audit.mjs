// Actual Pi 1.0 runtime: capture provider-visible prompt/loadout, not stub options.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const piWeb = process.env.PI_ORB_EVIDENCE_PI_WEB ?? "C:/Users/JUSTLIKEZYP/OneDrive/文档/daily/pi-web";
const require = createRequire(join(piWeb, "package.json"));
async function publicModule(name) {
  const root = join(piWeb, "node_modules", name);
  const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const entry = metadata.exports?.["."]?.import ?? metadata.main;
  return import(pathToFileURL(join(root, entry)));
}
const sdk = await publicModule("@earendil-works/pi-coding-agent");
const ai = await publicModule("@earendil-works/pi-ai");
const { createJiti } = await import(pathToFileURL(require.resolve("jiti")));
const jiti = createJiti(import.meta.url, { alias: { "@earendil-works/pi-coding-agent": join(piWeb, "node_modules/@earendil-works/pi-coding-agent/dist/index.js") } });
const architectPath = process.env.PI_PROMPT_ARCHITECT ?? "C:/Users/JUSTLIKEZYP/.pi/agent/extensions/prompt-architect/index.ts";
const architect = await jiti.import(architectPath, { default: true });
const orb = await jiti.import(resolve("pi-package/extensions/orb.ts"), { default: true });
const root = resolve(".tmp/upgrade/prompt-audit");
mkdirSync(root, { recursive: true });
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
const report = { method: "Pi 1.0.0 SDK + actual local Prompt Architect + actual Orb extension; captured faux provider input", checks: [], passed: false };
const check = (name, ok) => { report.checks.push({ name, ok: Boolean(ok) }); if (!ok) throw new Error(name); };
const sessions = [];

async function start({ orbMode = false, exact, custom, earlyExact, earlyCustom, codeOnly = false } = {}) {
  const cwd = join(root, orbMode ? "orb" : "ordinary");
  mkdirSync(cwd, { recursive: true });
  const config = join(root, "orb-config.json");
  writeFileSync(config, JSON.stringify({ version: 1, orbWorkspace: join(root, "orb"), shortcut: "Control+Alt+F11", window: { alwaysOnTop: true, width: 445, height: 632 } }));
  process.env.PI_ORB_CONFIG = config;
  const captures = [];
  const faux = ai.fauxProvider({ models: [{ id: "prompt-audit" }] });
  const runtime = await sdk.ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerNativeProvider(faux.provider);
  const settings = sdk.SettingsManager.inMemory({ packages: [], defaultTools: ["read", "edit", ...(codeOnly ? ["+codemode"] : [])], codemode: { mode: codeOnly ? "only" : "on" }, compaction: { enabled: false } });
  const late = pi => {
    pi.on("before_agent_start", event => {
      event.systemPromptOptions.promptGuidelines.push("LATE_PLUGIN_GUIDELINE_SENTINEL");
      event.systemPromptOptions.sections.mcp_servers = "NATIVE_MCP_SECTION_SENTINEL";
      if (custom !== undefined) event.systemPromptOptions.customPrompt = custom;
      if (exact !== undefined) return { systemPrompt: exact };
    });
  };
  const loader = new sdk.DefaultResourceLoader({ cwd, agentDir: process.env.PI_CODING_AGENT_DIR, settingsManager: settings,
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [pi => { pi.on("before_agent_start", event => {
      if (earlyExact !== undefined) event.systemPromptOptions.forceSystemPrompt = earlyExact;
      if (earlyCustom !== undefined) event.systemPromptOptions.customPrompt = earlyCustom;
    }); }, architect, sdk.createCodemodeExtension({ models: false }), orb, late] });
  await loader.reload();
  check("extension loader has no errors", loader.getExtensions().errors.length === 0);
  const { session } = await sdk.createAgentSession({ cwd, agentDir: process.env.PI_CODING_AGENT_DIR, modelRuntime: runtime,
    model: faux.getModel("prompt-audit"), sessionManager: sdk.SessionManager.inMemory(cwd), settingsManager: settings, resourceLoader: loader });
  sessions.push(session);
  const errors = [];
  await session.bindExtensions({ onError: error => errors.push(error) });
  const capture = context => {
    captures.push(context.messages.filter(message => message.role === "system"));
    return ai.fauxAssistantMessage(ai.fauxText("audit-ok"));
  };
  const prompt = async () => { faux.setResponses([capture]); await session.prompt("Audit the prompt; do not use tools."); check("no extension runtime errors", errors.length === 0); return captures.at(-1); };
  return { session, faux, prompt, errors };
}

try {
  const normal = await start();
  const systems = await normal.prompt();
  const first = systems[0];
  const rendered = systems.map(ai.getSystemMessageText).join("\n");
  check("native tools, rules and docs survive custom organization", ["tools", "rules", "docs"].every(name => first.sections?.[name]));
  check("later plugin guideline reaches the provider", rendered.includes("LATE_PLUGIN_GUIDELINE_SENTINEL"));
  check("native MCP section survives", rendered.includes("NATIVE_MCP_SECTION_SENTINEL"));
  check("additive policies are independently named", ["engineering", "tool_policy", "workflow", "delivery_contract"].every(name => first.sections?.[name]));
  check("native edit schema is edits[]", first.toolsAdded.find(tool => tool.name === "edit")?.parameters.properties.edits !== undefined);
  check("ordinary sessions have no desktop tools", !normal.session.getAllTools().some(tool => tool.name === "orb_observe"));
  check("removed gateway is absent from model prompt", !rendered.includes("mcp({") && !rendered.includes("mcpScript"));
  normal.session.setActiveToolsByName(["read", "edit", "codemode"]);
  const second = await normal.prompt();
  check("tool changes refresh declarations and Code mode policies", second.some(message => message.toolsAdded?.some(tool => tool.name === "codemode")) && second.map(ai.getSystemMessageText).join("\n").includes("searchTools()"));

  const desktop = await start({ orbMode: true, codeOnly: true });
  const desktopSystems = await desktop.prompt();
  const desktopPrompt = desktopSystems.map(ai.getSystemMessageText).join("\n");
  const declarations = desktopSystems.flatMap(message => message.toolsAdded ?? []);
  check("Code mode only keeps model-only desktop declarations", declarations.some(tool => tool.name === "orb_observe") && declarations.some(tool => tool.name === "orb_click"));
  check("Orb section and late Orb guidelines reach provider", desktopPrompt.includes("<orb_mode>") && desktopPrompt.includes("observe before acting"));
  const observe = desktop.session.getAllTools().find(tool => tool.name === "orb_observe");
  check("desktop tool has model-only exposure", observe.exposure === "model-only");
  const commands = desktop.session.extensionRunner.getRegisteredCommands();
  check("prompt audit, export and Orb commands have no duplicate names", ["prompt-audit", "prompt-export", "orb"].every(name => commands.filter(command => command.name === name).length === 1));

  const replaced = await start({ exact: "EXACT_REPLACEMENT_SENTINEL" });
  const exactSystems = await replaced.prompt();
  check("a later exact replacement wins over all policy sections", ai.getSystemMessageText(exactSystems[0]) === "EXACT_REPLACEMENT_SENTINEL");
  for (const earlyExact of ["EARLY_EXACT_SENTINEL", ""]) {
    const opaque = await start({ earlyExact });
    const opaqueSystems = await opaque.prompt();
    check("already assigned exact replacement is opaque (including empty)", ai.getSystemMessageText(opaqueSystems[0]) === earlyExact);
  }
  const custom = await start({ earlyCustom: "CUSTOM_SYSTEM_SENTINEL" });
  const customSystems = await custom.prompt();
  check("SYSTEM.md or CLI custom prompt retains ownership", customSystems.map(ai.getSystemMessageText).join("\n").includes("CUSTOM_SYSTEM_SENTINEL") && !customSystems[0].sections?.engineering);
  report.passed = report.checks.every(row => row.ok);
} catch (error) {
  report.error = error.message;
} finally {
  for (const session of sessions) session.dispose();
  const output = process.argv.find(argument => argument.startsWith("--output="))?.slice(9);
  writeFileSync(output ?? new URL("prompt-audit.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
if (!report.passed) process.exitCode = 1;
