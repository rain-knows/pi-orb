import { describe, it, expect, vi, afterEach } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
const mocks = vi.hoisted(() => ({ call: vi.fn(), revoke: vi.fn(), bridge: vi.fn(), create: vi.fn() }));
vi.mock("../src/main/browser-broker", () => ({ BrowserBroker: class {
  constructor(...args: unknown[]) { mocks.create(...args); }
  call = mocks.call; revoke = mocks.revoke;
} }));
vi.mock("../pi-package/extensions/bridge-client", () => ({ BridgeClient: { fromEnvironment: mocks.bridge } }));
import { registerBrowserTool } from "../pi-package/extensions/browser";

function fixture() {
  const handlers = new Map<string, (() => unknown)[]>();
  let tool: { execute: (...args: unknown[]) => Promise<unknown> };
  registerBrowserTool({ on: (event: string, handler: () => unknown) => handlers.set(event, [...handlers.get(event) ?? [], handler]),
    registerTool: (registered: typeof tool) => { tool = registered; } } as unknown as ExtensionAPI);
  const execute = (sessionId: string, cwd: string) => tool.execute("call", { name: "browser_snapshot" }, new AbortController().signal, undefined,
    { cwd, sessionManager: { getSessionId: () => sessionId } } as ExtensionContext);
  return { handlers, execute };
}
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
describe("public Playwright tool", () => {
  it("works in ordinary Pi Web without a shell and closes the previous session's connection", async () => {
    mocks.bridge.mockReturnValue(null);
    mocks.call.mockResolvedValue({ ok: true, content: [{ type: "text", text: "page" }] });
    const f = fixture();
    expect(await f.execute("ordinary-1", "/ordinary")).toMatchObject({ details: { ok: true } });
    await f.execute("ordinary-1", "/ordinary");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    await f.execute("ordinary-2", "/ordinary");
    expect(mocks.revoke).toHaveBeenCalledTimes(1);
    for (const handler of f.handlers.get("session_shutdown") ?? []) handler();
    expect(mocks.revoke).toHaveBeenCalledTimes(2);
  });
  it("keeps the shell's revoked session on the bridge while other sessions in the same cwd use public Playwright", async () => {
      const f = fixture();
      const call = vi.fn().mockResolvedValue({ ok: false, reason: "no-task-authorization", message: "Access revoked" });
      mocks.bridge.mockReturnValue({ readToken: () => ({ generation: 3, orbSessionId: "orb" }), call });
      expect(await f.execute("orb", "/same-workspace")).toMatchObject({ details: { ok: false, reason: "no-task-authorization" } });
      expect(mocks.create).not.toHaveBeenCalled();
      mocks.call.mockResolvedValue({ ok: true, content: [{ type: "text", text: "page" }] });
      expect(await f.execute("ordinary", "/same-workspace")).toMatchObject({ details: { ok: true } });
      expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
