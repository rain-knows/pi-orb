import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import orbExtension, { formatToolResult, renderResult } from "../pi-package/extensions/orb";

describe("Orb extension result rendering", () => {
  it("returns a refused single action's fresh screenshot and usable observation id", () => {
    const result = formatToolResult({ ok: false, reason: "surface-changed", message: "No input sent.",
      observation: { observationId: "changed-page", window: { id: "42", pid: 24, title: "Official account", appName: "chrome" },
        coordinateSpace: { action: "screenshot-fraction", space: 1000 }, image: { data: "AQID", mimeType: "image/png" } } });
    expect(result.details.ok).toBe(false);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Refused (surface-changed)") });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("observation_id: changed-page") });
    expect(result.content[1]).toMatchObject({ type: "image", data: "AQID" });
    expect(result.details.orbImages).toEqual([{ observationId: "changed-page" }]);
  });
  it("appends the latest pre-input surface after completed step images without duplicating pixels in details", () => {
    const observation = (id: string) => ({ observationId: id, window: { id: "42", pid: 24, title: "Target", appName: "test" },
      coordinateSpace: { action: "screenshot-fraction", space: 1000 }, image: { data: "AQID", mimeType: "image/png" } });
    const result = formatToolResult({ ok: false, completed: 1, reason: "surface-changed", steps: [{ ok: true, action: "click", observation: observation("one") }], observation: observation("two") });
    expect(result.content.filter(c => c.type === "image")).toHaveLength(2);
    expect(result.content.at(-2)).toMatchObject({ text: expect.stringContaining("observation_id: two") });
    expect(JSON.stringify(result.details)).not.toContain("AQID");
  });
  it("scopes sequential desktop tools, context budgeting and refusal marking to the Orb workspace", () => {
    const directory = mkdtempSync(join(tmpdir(), "orb-extension-test-"));
    const config = join(directory, "config.json");
    writeFileSync(config, JSON.stringify({ version: 1, orbWorkspace: directory, shortcut: "Control+Alt+F11", window: { alwaysOnTop: true, width: 445, height: 632 } }));
    vi.stubEnv("PI_ORB_CONFIG", config);
    const handlers = new Map<string, (event: never, ctx: ExtensionContext) => unknown>();
    const tools: { name: string; executionMode: string }[] = [];
    let activeTools = ["read", "advisor", "orb_observe"];
    const api = { on: (name: string, callback: typeof handlers extends Map<string, infer F> ? F : never) => handlers.set(name, callback), registerTool: (tool: typeof tools[number]) => tools.push(tool), registerCommand: () => {}, getActiveTools: () => activeTools, setActiveTools: (names: string[]) => { activeTools = names; } };
    try {
      orbExtension(api as unknown as ExtensionAPI);
      const ordinary = { cwd: join(directory, "ordinary") } as ExtensionContext;
      const orb = { cwd: directory, sessionManager: { getSessionId: () => "test" } } as ExtensionContext;
      handlers.get("session_start")!({} as never, ordinary);
      expect(tools.map(tool => tool.name)).toEqual(["orb_browser"]);
      handlers.get("session_start")!({} as never, orb);
      expect(tools).toHaveLength(13);
      expect(tools.every(t => t.executionMode === "sequential")).toBe(true);
      const start = { systemPromptOptions: { sections: {}, promptGuidelines: [] } };
      handlers.get("before_agent_start")!(start as never, ordinary);
      expect(activeTools).toContain("advisor");
      expect(start.systemPromptOptions.promptGuidelines).toEqual([]);
      handlers.get("before_agent_start")!(start as never, orb);
      expect(activeTools).toEqual(["read", "orb_observe"]);
      expect(start.systemPromptOptions.promptGuidelines.join(" ")).toContain("requested destination");
      expect(start.systemPromptOptions.promptGuidelines.join(" ")).toContain("select that destination with browser_tabs");
      const messages = Array.from({ length: 5 }, (_, id) => ({ role: "toolResult", toolName: "orb_observe", content: [{ type: "image", data: String(id) }] }));
      const before = JSON.stringify(messages);
      expect(handlers.get("context")!({ messages } as never, ordinary)).toBeUndefined();
      expect(handlers.get("context")!({ messages } as never, orb)).toHaveProperty("messages");
      expect(JSON.stringify(messages)).toBe(before);
      const failed = { toolName: "orb_batch", details: { ok: false } };
      expect(handlers.get("tool_result")!(failed as never, ordinary)).toBeUndefined();
      expect(handlers.get("tool_result")!(failed as never, orb)).toEqual({ isError: true });
    } finally {
      vi.unstubAllEnvs();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("renders an action result with an observation id as action JSON", () => {
    const result = {
      ok: true,
      action: "click",
      observationId: "obs-1",
      observation: {
        observationId: "obs-after",
        window: { id: "42", pid: 24, title: "Target", appName: "target.exe" },
        coordinateSpace: { action: "screenshot-fraction", space: 1000, windowRect: { x: 0, y: 0, width: 1, height: 1 } },
        elements: [],
        image: { data: "AQID", mimeType: "image/png", width: 1, height: 1 },
      },
      next: "Use this fresh observation for the next action.",
    };

    expect(renderResult(result)).toContain("action: click completed");
    expect(renderResult(result)).toContain("observation_id: obs-after");
  });

  it("renders observations with their coordinate contract", () => {
    const result = {
      observationId: "obs-1",
      window: { id: "42", pid: 24, title: "Target", appName: "target.exe" },
      coordinateSpace: {
        action: "screenshot-fraction",
        space: 1000,
        windowRect: { x: 0, y: 0, width: 800, height: 600 },
      },
      elements: [],
      elementsUnavailable: true,
      degraded: false,
    };

    expect(renderResult(result)).toContain("observation_id: obs-1");
    expect(renderResult(result)).toContain("pixel columns and rows");
    expect(renderResult(result)).toContain("attached_size");
    expect(renderResult(result)).not.toContain("800x600");
  });

  it("returns a fresh action observation as a Pi image block without duplicating base64 in details", () => {
    const image = { data: "AQID", mimeType: "image/png", width: 1, height: 1 };
    const result = formatToolResult({
      ok: true,
      action: "drag",
      observation: {
        observationId: "obs-after-action",
        window: { id: "42", pid: 24, title: "Target", appName: "target.exe" },
        coordinateSpace: { action: "screenshot-fraction", space: 1000, windowRect: { x: 0, y: 0, width: 1, height: 1 } },
        elements: [{ token: "obsolete", role: "Button", label: "Old", actions: ["invoke"] }],
        elementsUnavailable: true,
        degraded: false,
        image,
      },
    });

    expect(result.content).toEqual([
      { type: "text", text: expect.stringContaining("observation_id: obs-after-action") },
      { type: "image", data: "AQID", mimeType: "image/png" },
    ]);
    expect(JSON.stringify(result.details)).not.toContain("AQID");
    expect(JSON.stringify(result.details)).not.toContain("obsolete");
  });
});
