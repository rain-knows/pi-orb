/* eslint-disable @typescript-eslint/no-explicit-any -- Exercise the extension callback boundary with a minimal Pi host. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import orbExtension, { formatToolResult } from "../pi-package/extensions/orb";
import { COMPUTER_USE_POLICY } from "../src/shared/computer-use-policy";

const mocks = vi.hoisted(() => ({
  worker: vi.fn(),
  config: vi.fn(),
  call: vi.fn(),
  token: { generation: 3 },
}));
vi.mock("../pi-package/extensions/code-agent", () => ({ backgroundSession: mocks.worker, registerCodeAgentTools: vi.fn() }));
vi.mock("../pi-package/extensions/orb-config-reader", () => ({ readOrbConfig: mocks.config }));
vi.mock("../pi-package/extensions/bridge-client", () => ({ BridgeClient: { fromEnvironment: () => ({ readToken: () => mocks.token, call: mocks.call }) } }));

const obs = (id: string) => ({ observationId: id, window: { appName: "explorer.exe", title: "Work" }, coordinateSpace: {}, foreground: { appName: "Explorer", windowTitle: "Work", finderFolder: "D:/work" }, image: { data: id, mimeType: "image/png" } });
function fixture(cwd = "D:/orb") {
  const hooks = new Map<string, any>();
  const tools = new Map<string, any>();
  const setActiveTools = vi.fn();
  orbExtension({ on: (event: string, handler: any) => hooks.set(event, handler), registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: vi.fn(), getAllTools: () => [...tools.values()], setActiveTools } as any);
  const ctx = { cwd, model: { input: ["text", "image"] }, sessionManager: { getSessionId: () => "owner" } };
  const start = (prompt = "Inspect the current folder") => ({ prompt, systemPromptOptions: { sections: {} as Record<string, string> } });
  return { hooks, tools, ctx, start, setActiveTools };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.worker.mockReturnValue(undefined);
  mocks.config.mockReturnValue({ orbWorkspace: "D:/orb" });
  mocks.call.mockResolvedValue({ ok: true, result: { observation: obs("first") } });
});

describe("reference Computer Use through the actual Pi extension", () => {
  it("assembles the full reference policy and first-frame folder metadata", async () => {
    const f = fixture();
    const event = f.start();
    const result = await f.hooks.get("before_agent_start")(event, f.ctx);
    expect(event.systemPromptOptions.sections.orb_mode).toContain(COMPUTER_USE_POLICY);
    expect(result.message).toMatchObject({ customType: "computer-use", content: [
      { type: "text", text: expect.stringContaining("<frontmost_folder>D:/work</frontmost_folder>") },
      { type: "image", data: "first" },
    ] });
  });

  it("projects context only in the Orb foreground, leaving ordinary and worker sessions alone", () => {
    const f = fixture();
    const event = { messages: [1, 2].map(timestamp => ({ role: "custom", customType: "computer-use", content: [{ type: "image", data: String(timestamp), mimeType: "image/png" }], timestamp, display: false })) };
    const hook = f.hooks.get("context");
    expect(hook(event, { ...f.ctx, cwd: "D:/ordinary" })).toBeUndefined();
    expect(hook(event, f.ctx).messages[0].content[0].type).toBe("text");
    expect(event.messages[0]?.content[0]?.type).toBe("image");
    mocks.worker.mockReturnValue({ tools: ["read"] });
    expect(hook(event, f.ctx)).toBeUndefined();
  });

  it("skips automatic capture for reference selection-only turns and text-only models", async () => {
    const f = fixture();
    const hook = f.hooks.get("before_agent_start");
    await hook(f.start("Desktop selection. Answer in this chat only. Do not call GUI tools or code_agent.\nExplain this text"), f.ctx);
    await hook(f.start(), { ...f.ctx, model: { input: ["text"] } });
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("retains installed host web tools for workers without granting GUI or additional file access", async () => {
    const f = fixture("D:/worker");
    for (const name of ["read", "write", "bash", "web_search", "web_fetch", "fetch_content", "advisor", "click", "code_agent"]) f.tools.set(name, { name });
    mocks.worker.mockReturnValue({ tools: ["read"] });
    const event = f.start();
    event.systemPromptOptions.sections.orb_mode = "old foreground policy";
    await f.hooks.get("before_agent_start")(event, f.ctx);
    expect(f.setActiveTools).toHaveBeenCalledWith(["read", "web_search", "web_fetch", "fetch_content"]);
    expect(event.systemPromptOptions.sections.orb_mode).toBeUndefined();
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("returns list_apps names and screenshot paths rather than dropping them behind the observation", () => {
    const result = formatToolResult({ observation: obs("apps"), apps: ["Notepad", "Chrome"], paths: ["D:/Desktop/proof.png"] });
    expect(result.content[0]?.text).toContain('["Notepad","Chrome"]');
    expect(result.content[0]?.text).toContain("proof.png");
    expect(result.content[1]).toMatchObject({ type: "image", data: "apps" });
  });

  it("retains a surface-change screenshot and advances the internal token for the next action", async () => {
    const f = fixture();
    f.hooks.get("session_start")({}, f.ctx);
    await f.hooks.get("before_agent_start")(f.start(), f.ctx);
    const click = f.tools.get("click");
    mocks.call.mockResolvedValueOnce({ ok: false, reason: "surface-changed", message: "No input was sent", result: { observation: obs("new-surface") } });
    const failed = await click.execute("call-1", { screen_index: 0, position: [100, 200] }, undefined, undefined, f.ctx);
    expect(failed.content[1]).toMatchObject({ type: "image", data: "new-surface" });
    expect(failed.details.ok).toBe(false);
    await click.execute("call-2", { screen_index: 0, position: [300, 400] }, undefined, undefined, f.ctx);
    expect(mocks.call.mock.calls.at(-1)?.[0].action.observationId).toBe("new-surface");
  });

  it("rejects unsupported screens before sending input instead of silently using screen 0", async () => {
    const f = fixture();
    f.hooks.get("session_start")({}, f.ctx);
    await expect(f.tools.get("click").execute("bad", { screen_index: 1, position: [100, 200] }, undefined, undefined, f.ctx)).rejects.toThrow("Only screen_index 0");
    expect(mocks.call).not.toHaveBeenCalled();
  });

  it("rejects GUI input after switching to a text-only model, even when an earlier image was observed", async () => {
    const f = fixture();
    f.hooks.get("session_start")({}, f.ctx);
    await f.hooks.get("before_agent_start")(f.start(), f.ctx);
    mocks.call.mockClear();
    await expect(f.tools.get("click").execute("bad", { screen_index: 0, position: [100, 200] }, undefined, undefined, { ...f.ctx, model: { input: ["text"] } })).rejects.toThrow("supports image input");
    expect(mocks.call).not.toHaveBeenCalled();
  });
});
