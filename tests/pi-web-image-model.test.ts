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
