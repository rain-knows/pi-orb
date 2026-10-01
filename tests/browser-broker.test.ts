import { describe, expect, it, vi } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { BrowserBroker } from "../src/main/browser-broker";
import type { BrokerStatus } from "../src/main/desktop-broker";

function fixture() {
  let access: BrokerStatus = { authorized: true, level: "full-access", sessionId: "orb", generation: 4, stopped: false, stoppedReason: null, lastObservationId: null };
  const calls: string[] = [];
  const create = vi.fn(async () => {
    const server = new Server({ name: "fixture", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ["browser_snapshot", "browser_run_code"].map(name => ({ name, inputSchema: { type: "object" as const, properties: {} } })) }));
    server.setRequestHandler(CallToolRequestSchema, async request => {
      calls.push(request.params.name);
      return { content: [{ type: "text", text: 'button "Play" [ref=e7]' }] };
    });
    return server;
  });
  const broker = new BrowserBroker(() => access, create);
  return { broker, calls, create, setAccess: (next: Partial<BrokerStatus>) => { access = { ...access, ...next }; } };
}

describe("Browser connection session boundary", () => {
  it("redacts authentication tokens from failed connection results", async () => {
    vi.stubEnv("PLAYWRIGHT_MCP_EXTENSION_TOKEN", "fixture-secret");
    try {
      const broker = new BrowserBroker(() => ({ authorized: true, level: "full-access", sessionId: "orb", generation: 4, stopped: false, stoppedReason: null, lastObservationId: null }), async () => { throw new Error("Rejected fixture-secret"); });
      expect(await broker.call({ name: "tools" }, "orb", 4)).toMatchObject({ ok: false, message: "Rejected [redacted]" });
    } finally { vi.unstubAllEnvs(); }
  });
  it("refuses an absent grant, weaker level, other session and stale generation before opening MCP", async () => {
    const f = fixture();
    expect(await f.broker.call({ name: "browser_snapshot" }, "other", 4)).toMatchObject({ ok: false, reason: "no-task-authorization" });
    expect(await f.broker.call({ name: "browser_snapshot" }, "orb", 3)).toMatchObject({ ok: false });
    f.setAccess({ level: "workspace-write" });
    expect(await f.broker.call({ name: "browser_snapshot" }, "orb", 4)).toMatchObject({ ok: false });
    f.setAccess({ authorized: false, level: "full-access" });
    expect(await f.broker.call({ name: "tools" }, "orb", 4)).toMatchObject({ ok: false });
    expect(f.create).not.toHaveBeenCalled();
  });

  it("filters executable browser tools and preserves MCP snapshot text", async () => {
    const f = fixture();
    const discovered = await f.broker.call({ name: "tools" }, "orb", 4) as { tools: { name: string }[] };
    expect(discovered.tools.map(t => t.name)).toEqual(["browser_snapshot"]);
    expect(await f.broker.call({ name: "browser_run_code", arguments: { code: "danger" } }, "orb", 4)).toMatchObject({ ok: false, reason: "malformed" });
    expect(await f.broker.call({ name: "browser_snapshot" }, "orb", 4)).toMatchObject({ ok: true, content: [{ text: 'button "Play" [ref=e7]' }] });
    expect(f.calls).toEqual(["browser_snapshot"]);
    f.broker.revoke();
  });

  it("cannot adopt a connection that finishes opening after revocation", async () => {
    const f = fixture();
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    const broker = new BrowserBroker(() => ({ authorized: true, level: "full-access", sessionId: "orb", generation: 4 } as BrokerStatus), async () => { await delayed; return f.create(); });
    const pending = broker.call({ name: "browser_snapshot" }, "orb", 4);
    broker.revoke();
    release();
    expect(await pending).toMatchObject({ ok: false, reason: "cancelled" });
    expect(f.calls).toEqual([]);
  });

  it("returns the current inline snapshot in the same action request", async () => {
    const f = fixture();
    const result = await f.broker.call({ name: "browser_click", arguments: { target: "e7" } }, "orb", 4) as { content: unknown[] };
    expect(f.calls).toEqual(["browser_click", "browser_snapshot"]);
    expect(result.content).toHaveLength(2);
    f.broker.revoke();
  });

  it("does not open a connection for an already aborted call", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    expect(await f.broker.call({ name: "browser_snapshot" }, "orb", 4, controller.signal)).toMatchObject({ ok: false, reason: "cancelled" });
    expect(f.create).not.toHaveBeenCalled();
  });
});
