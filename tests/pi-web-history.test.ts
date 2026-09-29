import { describe, expect, it, vi } from "vitest";
import { PiWebClient } from "../src/main/pi-web-client";

describe("PiWebClient session history", () => {
  it("reads summaries and filters malformed records", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ sessions: [
      { id: "s1", cwd: "C:\\orb", modified: "2026-09-29T00:00:00.000Z", firstMessage: "hello", messageCount: 2 },
      { id: 4, cwd: "C:\\bad" },
    ] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const client = new PiWebClient({ baseUrl: "http://127.0.0.1:30141" });
    await expect(client.listSessions()).resolves.toEqual([{ id: "s1", cwd: "C:\\orb", modified: "2026-09-29T00:00:00.000Z", firstMessage: "hello", messageCount: 2 }]);
    vi.unstubAllGlobals();
  });

  it("maps text blocks from a persisted session context", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      info: { id: "s1", cwd: "C:\\orb" },
      context: { messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: [{ type: "text", text: "world" }, { type: "thinking", thinking: "private" }] },
        { role: "toolResult", content: "hidden" },
      ] },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const client = new PiWebClient({ baseUrl: "http://127.0.0.1:30141" });
    await expect(client.getSessionHistory("s1")).resolves.toEqual({ cwd: "C:\\orb", messages: [
      { role: "user", text: "hello" },
      { role: "assistant", text: "world" },
    ] });
    vi.unstubAllGlobals();
  });
});
