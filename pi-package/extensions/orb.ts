/** Pi adapter for dsh-orb-cordis Computer Use, commit 9cdc50302d202f4497569731be488a8afa500da7. */
/* eslint-disable @typescript-eslint/no-explicit-any -- Pi's runtime tool schema exposes untyped parameter records. */
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isOrbWorkspace, resolveOrbConfigPath } from "../../src/shared/orb-config.js";
import { ORB_MODE_SECTION, ORB_TOOLS, LONG_WAIT_SECONDS, describeOrbModeSection, type DesktopAction, type DesktopObservation } from "../../src/shared/orb-tools.js";
import { BridgeClient } from "./bridge-client.js";
import { backgroundSession, registerCodeAgentTools } from "./code-agent.js";
import { CODE_AGENT_TOOLS } from "../../src/shared/code-agent.js";
import { readOrbConfig } from "./orb-config-reader.js";
import { projectComputerUseContext } from "./computer-use-context.js";
import { formatForegroundEnvelope } from "../../src/shared/foreground-envelope.js";

export { ORB_MODE_SECTION };
const REFERENCE_GUI_TOOL_NAMES = Object.values(ORB_TOOLS);
// The reference preset consumes the host's web service. Pi extensions provide
// the corresponding tools; session creation accepts only built-in names.
const REFERENCE_WEB_TOOL_NAMES = ["web_search", "web_fetch", "fetch_content", "get_search_content", "source_check"] as const;
const REFERENCE_HOST_TOOL_NAMES = [
  "read", "write", "edit", "bash", "powershell",
  ...REFERENCE_WEB_TOOL_NAMES, "ask_user_question",
] as const;
const position = Type.Array(Type.Number({ minimum: 0, maximum: 1000 }), { minItems: 2, maxItems: 2, description: "[x, y] as a 0–1000 fraction of the attached frontmost-window screenshot." });
const screenIndex = Type.Integer({ minimum: 0, maximum: 0, description: "0 for the attached frontmost-window screenshot." });
const clickParams = Type.Object({ screen_index: screenIndex, position, button: Type.Optional(Type.Union([Type.Literal("left"), Type.Literal("right")])), count: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2)])), modifiers: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false });
const inputParams = Type.Object({ screen_index: screenIndex, position, text: Type.String({ minLength: 1, maxLength: 200 }), replace: Type.Optional(Type.Boolean()), submit: Type.Optional(Type.Boolean()) }, { additionalProperties: false });
const scrollParams = Type.Object({ screen_index: screenIndex, position, direction: Type.Union([Type.Literal("up"), Type.Literal("down")]), scroll_level: Type.Integer({ minimum: 1, maximum: 10 }) }, { additionalProperties: false });
const hotkeyParams = Type.Object({ keys: Type.Array(Type.String(), { minItems: 1, maxItems: 4 }) }, { additionalProperties: false });
const longPressParams = Type.Object({ screen_index: screenIndex, position, duration_seconds: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })) }, { additionalProperties: false });
const dragParams = Type.Object({ start_screen_index: screenIndex, start_position: position, end_screen_index: screenIndex, end_position: position }, { additionalProperties: false });

function textResult(text: string, result: any, image?: { data: string; mimeType: string }) { return { content: [{ type: "text" as const, text }, ...(image ? [{ type: "image" as const, data: image.data, mimeType: image.mimeType }] : [])], details: result as any }; }
function observationOf(value: unknown): DesktopObservation | null { if (!value || typeof value !== "object") return null; const r = value as Record<string, unknown>; if (r.observation && typeof r.observation === "object") return observationOf(r.observation); if (typeof r.observationId === "string" && r.window && r.coordinateSpace) return r as unknown as DesktopObservation; return null; }
function render(value: unknown): { text: string; image?: { data: string; mimeType: string } } {
  const obs = observationOf(value);
  const r = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const lines = [obs ? formatForegroundEnvelope(obs.foreground ?? { appName: obs.window.appName, windowTitle: obs.window.title }) : JSON.stringify(value, (_k, v) => typeof v === "bigint" ? `${v}n` : v, 2)];
  if (r.apps) lines.push(`Running applications: ${JSON.stringify(r.apps)}`);
  if (r.paths) lines.push(`Saved screenshot: ${JSON.stringify(r.paths)}`);
  if (r.app) { const app = r.app as { name: string; kind: string }; lines.unshift(`Opened ${app.name} (${app.kind}).`); }
  return { text: lines.join("\n"), ...(obs?.image ? { image: obs.image } : {}) };
}

function activateReferenceToolset(pi: ExtensionAPI): void {
  const available = new Set(pi.getAllTools().map(tool => tool.name));
  const desired = [...REFERENCE_HOST_TOOL_NAMES, ...REFERENCE_GUI_TOOL_NAMES, ...CODE_AGENT_TOOLS]
    .filter((name, index, names) => available.has(name) && names.indexOf(name) === index);
  pi.setActiveTools(desired);
}

export default function orbExtension(pi: ExtensionAPI): void {
  const state: { generation: number; observationId: string | null } = { generation: 0, observationId: null };
  const bridge = () => BridgeClient.fromEnvironment();
  const activeFor = (ctx: ExtensionContext) => { const c = readOrbConfig(resolveOrbConfigPath()); return Boolean(c && isOrbWorkspace(ctx.cwd, c.orbWorkspace)); };
  pi.on("session_start", (_event, ctx) => {
    if (!activeFor(ctx) || backgroundSession(ctx.sessionManager.getSessionId())) return;
    registerCodeAgentTools(pi); activateReferenceToolset(pi); state.observationId = null;
    const register = (name: string, parameters: unknown, description: string, make: (p: any) => DesktopAction) => pi.registerTool({ name, label: name, exposure: "model-only", executionMode: "sequential", description, parameters: parameters as any, async execute(_id, params: any, signal, _update, toolCtx) {
      if (!toolCtx.model?.input.includes("image")) throw new Error("Computer Use requires a model that supports image input.");
      for (const key of ["screen_index", "start_screen_index", "end_screen_index"]) if (params[key] !== undefined && params[key] !== 0) throw new Error("Only screen_index 0 addresses the attached frontmost-window screenshot.");
      return await forward(toolCtx, make(params), signal) as any;
    } });
    register(ORB_TOOLS.click, clickParams, "Click a 0–1000 position on the attached frontmost-window screenshot, then return the post-action screenshot.", p => ({ kind: "click", observationId: state.observationId ?? "", position: { x: p.position[0], y: p.position[1] }, ...(p.button ? { button: p.button } : {}), ...(p.count ? { count: p.count } : {}), ...(p.modifiers ? { modifiers: p.modifiers } : {}) }));
    register(ORB_TOOLS.inputText, inputParams, "Click a 0–1000 position, type text, optionally replace content and press Enter, then return the post-action screenshot.", p => ({ kind: "type", observationId: state.observationId ?? "", position: { x: p.position[0], y: p.position[1] }, text: p.text, replace: p.replace ?? false, submit: p.submit ?? false }));
    register(ORB_TOOLS.scroll, scrollParams, "Scroll up or down at a 0–1000 position on the attached screenshot, then return the post-action screenshot.", p => ({ kind: "scroll", observationId: state.observationId ?? "", position: { x: p.position[0], y: p.position[1] }, direction: p.direction, amount: p.scroll_level }));
    register(ORB_TOOLS.hotkey, hotkeyParams, "Press a key combination on the desktop, then return the post-action screenshot.", p => ({ kind: "hotkey", observationId: state.observationId ?? "", keys: p.keys }));
    register(ORB_TOOLS.longPress, longPressParams, "Press and hold the left button at a 0–1000 position, then return the post-action screenshot.", p => ({ kind: "longPress", observationId: state.observationId ?? "", position: { x: p.position[0], y: p.position[1] }, durationSeconds: p.duration_seconds ?? 3 }));
    register(ORB_TOOLS.drag, dragParams, "Drag from a start 0–1000 position to an end position on the attached screenshot, then return the post-action screenshot.", p => ({ kind: "drag", observationId: state.observationId ?? "", startPosition: { x: p.start_position[0], y: p.start_position[1] }, endPosition: { x: p.end_position[0], y: p.end_position[1] } }));
    register(ORB_TOOLS.wait, Type.Object({}, { additionalProperties: false }), "Pause 1 second, then return a fresh frontmost-window screenshot.", _p => ({ kind: "wait", observationId: state.observationId ?? "" }));
    register(ORB_TOOLS.longWait, Type.Object({ wait_seconds: Type.Union(LONG_WAIT_SECONDS.map(v => Type.Literal(v))) }, { additionalProperties: false }), "Pause 10, 30, 60, or 120 seconds, then return a fresh frontmost-window screenshot.", p => ({ kind: "longWait", observationId: state.observationId ?? "", waitSeconds: p.wait_seconds }));
    register(ORB_TOOLS.screenshot, Type.Object({}, { additionalProperties: false }), "Save the current frontmost-window screenshot to the Desktop and copy it to the clipboard.", _p => ({ kind: "screenshot", observationId: state.observationId ?? "" }));
    register(ORB_TOOLS.openInBrowser, Type.Object({ url: Type.Optional(Type.String()) }, { additionalProperties: false }), "Open the default browser or an http(s) URL, then return the post-action screenshot.", p => ({ kind: "openInBrowser", observationId: state.observationId ?? "", ...(p.url ? { url: p.url } : {}) }));
    register(ORB_TOOLS.openInFinder, Type.Object({ path: Type.Optional(Type.String()), reveal_only: Type.Optional(Type.Boolean()) }, { additionalProperties: false }), "Open a folder or file, or reveal a file in Finder, then return the post-action screenshot.", p => ({ kind: "openInFinder", observationId: state.observationId ?? "", ...(p.path ? { path: p.path } : {}), revealOnly: p.reveal_only ?? false }));
    register(ORB_TOOLS.listApps, Type.Object({}, { additionalProperties: false }), "List running applications by display name, then return the current frontmost-window screenshot.", _p => ({ kind: "listApps", observationId: state.observationId ?? "" }));
    register(ORB_TOOLS.openApp, Type.Object({ name: Type.String({ minLength: 1, maxLength: 80 }) }, { additionalProperties: false }), "Activate a running application or launch it by display name, then return the post-action screenshot.", p => ({ kind: "openApp", observationId: state.observationId ?? "", name: p.name }));
    pi.registerCommand("orb", { description: "Show or control Orb mode: /orb [status|stop]", handler: async (args, commandCtx) => { if (!activeFor(commandCtx)) return commandCtx.ui.notify("Orb mode is not active for this session.", "info"); const b = bridge(); const token = b?.readToken(); if (!b || !token) return commandCtx.ui.notify("Orb shell is not connected.", "warning"); if (args.trim().toLowerCase() === "stop") { const r = await b.call({ type: "revoke", sessionId: commandCtx.sessionManager.getSessionId(), generation: state.generation }, token); return commandCtx.ui.notify(r.ok ? "Orb desktop Access revoked." : r.message, r.ok ? "info" : "warning"); } commandCtx.ui.notify(`Orb mode active. Bridge: connected\nObservation: ${state.observationId ?? "none"}`, "info"); } });
  });
  pi.on("before_agent_start", async (event, ctx) => {
    const worker = backgroundSession(ctx.sessionManager.getSessionId());
    if (worker) {
      const available = new Set(pi.getAllTools().map(tool => tool.name));
      pi.setActiveTools([...worker.tools, ...REFERENCE_WEB_TOOL_NAMES.filter(name => available.has(name))]);
      delete event.systemPromptOptions.sections[ORB_MODE_SECTION];
      return;
    }
    if (!activeFor(ctx)) return; const token = bridge()?.readToken(); if (token) state.generation = token.generation; activateReferenceToolset(pi);
    event.systemPromptOptions.sections[ORB_MODE_SECTION] = describeOrbModeSection();
    if (event.prompt.startsWith("Desktop selection. Answer in this chat only. Do not call GUI tools or code_agent.") || !ctx.model?.input.includes("image")) return;
    const first = await observe(ctx); if (first) return { message: { customType: "computer-use", display: false, content: first } };
  });
  pi.on("context", (event, ctx) => {
    if (!activeFor(ctx) || backgroundSession(ctx.sessionManager.getSessionId())) return;
    return { messages: projectComputerUseContext(event.messages) };
  });
  pi.on("tool_result", (event, ctx) => { if (!activeFor(ctx) || !Object.values(ORB_TOOLS).includes(event.toolName as any)) return; if ((event.details as any)?.ok === false) return { isError: true }; });
  async function observe(ctx: ExtensionContext): Promise<any[] | null> { const b = bridge(); const token = b?.readToken(); if (!b || !token) return null; state.generation = token.generation; const result = await b.call({ type: "observe", sessionId: ctx.sessionManager.getSessionId(), generation: state.generation }, token, ctx.signal); if (!result.ok) return null; const o = observationOf(result.result); if (!o) return null; state.observationId = o.observationId; const out = render(result.result); return [{ type: "text", text: out.text }, ...(out.image ? [{ type: "image", ...out.image }] : [])]; }
  async function forward(ctx: ExtensionContext, action: DesktopAction, signal?: AbortSignal): Promise<unknown> {
    const b = bridge(); const token = b?.readToken();
    if (!b || !token) return textResult("Orb shell is not connected; desktop tools are unavailable.", { ok: false, reason: "not-configured" });
    state.generation = token.generation;
    const result = await b.call({ type: "act" as const, sessionId: ctx.sessionManager.getSessionId(), generation: state.generation, action: { ...action, observationId: state.observationId ?? action.observationId }, requestId: randomUUID() }, token, signal);
    const o = observationOf(result.result); if (o) state.observationId = o.observationId;
    const out = render(result.result);
    if (!result.ok) return textResult(`Refused (${result.reason}): ${result.message}${o ? `\n${out.text}` : ""}`, result, out.image);
    return textResult(out.text, { ok: true, result: result.result }, out.image);
  }
}

/** Stable render exports used by renderer and diagnostics. */
export function renderResult(value: unknown): string { return render(value).text; }
export function formatToolResult(value: unknown): ReturnType<typeof textResult> { const out = render(value); return textResult(out.text, { ok: true, result: value }, out.image); }
