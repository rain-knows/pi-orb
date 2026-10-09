import { afterEach, describe, expect, it, vi } from "vitest";
import { PiWebClient } from "../src/main/pi-web-client";

afterEach(() => vi.unstubAllGlobals());

describe("image prompt model check", () => {
  it.each([
    { input: ["text"], accepted: false },
    { input: ["text", "image"], accepted: true },
  ])("checks the selected model before uploading an image: $input", async ({ input, accepted }) => {
    const commands: string[] = [];
    const fetchMock = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/models") {
        expect(new URL(String(url)).searchParams.get("cwd")).toBe("D:/disposable");
        return Response.json({ modelList: [{ provider: "test", id: "selected", input }] });
      }
      const command = JSON.parse(String(init?.body)) as { type: string };
      commands.push(command.type);
      if (command.type === "get_state") {
        return Response.json({ success: true, data: { model: { provider: "test", id: "selected" } } });
      }
      return Response.json({ success: true, data: {} });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new PiWebClient({ baseUrl: "http://127.0.0.1:30141" });
    const send = client.prompt("disposable-session", "inspect this", [
      { type: "image", mimeType: "image/png", data: "AA==" },
    ], "D:/disposable");
    if (accepted) await expect(send).resolves.toBeUndefined();
    else await expect(send).rejects.toThrow("does not support image input");
    expect(commands).toEqual(accepted ? ["get_state", "prompt"] : ["get_state"]);
  });
});

describe("Pi Web session creation diagnostics", () => {
  it("preserves the server error when a background session cannot be created", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      error: "toolNames must contain only built-in tool names",
    }, { status: 500 })));
    const client = new PiWebClient({ baseUrl: "http://127.0.0.1:30141" });
    await expect(client.createSession("D:/worker", { toolNames: ["write"] })).rejects.toMatchObject({
      message: "toolNames must contain only built-in tool names",
      status: 500,
    });
  });
});

describe("Pi Web final background outcome", () => {
  it.each([
    { stopReason: "stop", errorMessage: undefined, expectedError: null },
    { stopReason: "error", errorMessage: "400 invalid model", expectedError: "400 invalid model" },
    { stopReason: "aborted", errorMessage: undefined, expectedError: "Background prompt aborted." },
  ])("reads the final assistant outcome, including $stopReason", async ({ stopReason, errorMessage, expectedError }) => {
    vi.stubGlobal("fetch", vi.fn(async (url, init?: RequestInit) => {
      expect(String(url)).toBe("http://127.0.0.1:30141/api/sessions/worker?tail=1&tree=summary&deferThinking=1&deferMedia=1");
      expect(init?.method).toBe("GET");
      return Response.json({ context: { messages: [
        { role: "assistant", stopReason: "error", errorMessage: "old error", content: [] },
        { role: "user", content: [{ type: "text", text: "continue" }] },
        { role: "assistant", stopReason, errorMessage, content: [{ type: "text", text: "final" }] },
      ] } });
    }));
    const client = new PiWebClient({ baseUrl: "http://127.0.0.1:30141" });
    await expect(client.lastAssistantOutcome("worker")).resolves.toEqual({ text: "final", error: expectedError, userStopped: stopReason === "aborted" });
  });
});

describe("Orb model and extension UI commands", () => {
  it("uses Pi Web's model catalog and set_model session command", async () => {
    const commands: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL | string, init?: RequestInit) => {
      if (new URL(String(url)).pathname === "/api/models") {
        return Response.json({ modelList: [{ provider: "test", id: "one", name: "One", input: ["text", "image"] }] });
      }
      const command = JSON.parse(String(init?.body)) as { type: string };
      commands.push(command);
      return Response.json({ success: true, data: command.type === "get_state" ? { model: { provider: "test", id: "one" } } : {} });
    }));
    const client = new PiWebClient({ baseUrl: "http://127.0.0.1:30141" });
    expect(await client.listModels("D:/orb")).toEqual([{ provider: "test", id: "one", name: "One", input: ["text", "image"] }]);
    expect(await client.setModel("session-1", "test", "one")).toMatchObject({ provider: "test", modelId: "one" });
    await client.respondToExtensionUi("session-1", { id: "ask-1", confirmed: true });
    expect(commands).toEqual([
      { type: "set_model", provider: "test", modelId: "one" },
      { type: "get_state" },
      { type: "extension_ui_response", id: "ask-1", confirmed: true },
    ]);
  });
});
