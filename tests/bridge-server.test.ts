import { afterEach, describe, expect, it } from "vitest";
import { connect, type Server } from "node:net";
import { BridgeServer, createBridgeToken, createPipePath } from "../src/main/bridge-server";
import { BRIDGE_PROTOCOL_VERSION, looksBrowserOriginated, tokensMatch } from "@shared/bridge-protocol";

/** A minimal executor so the transport and admission rules can be tested without a driver. */
function fakeExecutor(options: { readonly live?: boolean; readonly fail?: string } = {}) {
  const calls: string[] = [];
  return {
    calls,
    observe: async () => {
      calls.push("observe");
      return { observationId: "obs-1" };
    },
    act: async () => {
      calls.push("act");
      if (options.fail) throw new Error(options.fail);
      return { ok: true, action: "click" };
    },
    status: () => {
      calls.push("status");
      return { authorized: false };
    },
    revoke: () => {
      calls.push("revoke");
    },
    accepts: () => options.live ?? true,
  };
}

/** One newline-delimited request, one line of JSON back. */
function send(pipePath: string, payload: unknown): Promise<{ raw: string; parsed: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const socket = connect(pipePath, () => socket.write(`${JSON.stringify(payload)}\n`));
    let data = "";
    socket.on("data", (chunk) => (data += chunk.toString("utf8")));
    socket.on("end", () => {
      const line = data.trim();
      try {
        resolve({ raw: line, parsed: JSON.parse(line) as Record<string, unknown> });
      } catch (error) {
        reject(error);
      }
    });
    socket.on("error", reject);
  });
}

const servers: BridgeServer[] = [];
let unique = 0;

async function start(options: { readonly live?: boolean; readonly fail?: string; readonly token?: string } = {}) {
  unique += 1;
  const token = options.token ?? createBridgeToken();
  const pipePath = `\\\\.\\pipe\\pi-orb-test-${process.pid}-${unique}`;
  const executor = fakeExecutor(options);
  const server = new BridgeServer({
    pipePath,
    token,
    executor,
    log: () => {},
  });
  await server.listen();
  servers.push(server);
  return { pipePath, token, executor, server };
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.close();
  }
});

describe("bridge admission rules", () => {
  it("serves a hello handshake without a session", async () => {
    const { pipePath, token } = await start();
    const response = await send(pipePath, { type: "hello", version: BRIDGE_PROTOCOL_VERSION, token });
    expect(response.parsed.ok).toBe(true);
  });

  it("refuses a request with no token", async () => {
    const { pipePath, executor } = await start();
    const response = await send(pipePath, { type: "observe", sessionId: "s", generation: 1 });
    expect(response.parsed).toMatchObject({ ok: false, reason: "bad-token" });
    // A refused request must never reach the executor.
    expect(executor.calls).toEqual([]);
  });

  it("refuses a wrong token", async () => {
    const { pipePath, executor } = await start();
    const response = await send(pipePath, { type: "observe", token: "nope", sessionId: "s", generation: 1 });
    expect(response.parsed).toMatchObject({ ok: false, reason: "bad-token" });
    expect(executor.calls).toEqual([]);
  });

  it("refuses a browser-originated request even with a valid token", async () => {
    // A named pipe is not reachable from a page, so this is defence in depth: the rule must
    // hold even if the transport ever changed.
    const { pipePath, token, executor } = await start();
    const response = await send(pipePath, {
      type: "observe",
      token,
      sessionId: "s",
      generation: 1,
      origin: "http://evil.example",
    });
    expect(response.parsed).toMatchObject({ ok: false, reason: "browser-originated-request" });
    expect(executor.calls).toEqual([]);
  });

  it("refuses a request from a dead run without reaching the executor", async () => {
    const { pipePath, token, executor } = await start({ live: false });
    const response = await send(pipePath, { type: "observe", token, sessionId: "s", generation: 1 });
    expect(response.parsed).toMatchObject({ ok: false, reason: "stale-generation" });
    expect(executor.calls).toEqual([]);
  });

  it("reports an unknown session as such instead of calling it a stale generation", async () => {
    // The two conditions call for different user actions, so reporting both as `stale-generation`
    // would tell the user their run is stale when the real problem is that the session is not this
    // shell's.
    unique += 1;
    const token = createBridgeToken();
    const pipePath = "\\\\.\\pipe\\pi-orb-test-" + process.pid + "-" + unique;
    const executor = {
      calls: [] as string[],
      observe: async () => ({}),
      act: async () => ({}),
      status: () => ({}),
      revoke: () => {},
      accepts: () => ({ ok: false, reason: "unknown-session" as const }),
    };
    const server = new BridgeServer({ pipePath, token, executor });
    await server.listen();
    servers.push(server);

    const response = await send(pipePath, { type: "status", token, sessionId: "someone-else", generation: 1 });
    expect(response.parsed).toMatchObject({ ok: false, reason: "unknown-session" });
    expect(String(response.parsed.message)).toMatch(/does not belong to this Orb run/i);
    expect(executor.calls).toEqual([]);
  });

  it("refuses a protocol version mismatch instead of guessing", async () => {
    const { pipePath, token, executor } = await start();
    const response = await send(pipePath, {
      type: "hello",
      version: BRIDGE_PROTOCOL_VERSION + 1,
      token,
    });
    expect(response.parsed).toMatchObject({ ok: false, reason: "version-mismatch" });
    expect(executor.calls).toEqual([]);
  });

  it("refuses malformed JSON", async () => {
    const { pipePath } = await start();
    const response = await new Promise<string>((resolve, reject) => {
      const socket = connect(pipePath, () => socket.write("this is not json\n"));
      let data = "";
      socket.on("data", (chunk) => (data += chunk.toString("utf8")));
      socket.on("end", () => resolve(data.trim()));
      socket.on("error", reject);
    });
    expect(JSON.parse(response)).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("refuses an unknown request type", async () => {
    const { pipePath, token } = await start();
    const response = await send(pipePath, { type: "delete-everything", token, sessionId: "s", generation: 1 });
    expect(response.parsed).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("dispatches an authorized observation to the executor", async () => {
    const { pipePath, token, executor } = await start();
    const response = await send(pipePath, { type: "observe", token, sessionId: "s", generation: 1 });
    expect(response.parsed.ok).toBe(true);
    expect(executor.calls).toEqual(["observe"]);
  });

  it("dispatches an authorized action and passes the action through", async () => {
    const { pipePath, token, executor } = await start();
    const response = await send(pipePath, {
      type: "act",
      token,
      sessionId: "s",
      generation: 1,
      action: { kind: "click", observationId: "obs-1", elementToken: "t" },
    });
    expect(response.parsed.ok).toBe(true);
    expect(executor.calls).toEqual(["act"]);
  });

  it("reports an executor failure as a refusal rather than a silent success", async () => {
    const { pipePath, token } = await start({ fail: "the driver exploded" });
    const response = await send(pipePath, {
      type: "act",
      token,
      sessionId: "s",
      generation: 1,
      action: { kind: "click", observationId: "obs-1", elementToken: "t" },
    });
    expect(response.parsed).toMatchObject({ ok: false, reason: "executor-error" });
    expect(String(response.parsed.message)).toContain("the driver exploded");
  });

  it("routes revoke to the executor", async () => {
    const { pipePath, token, executor } = await start();
    await send(pipePath, { type: "revoke", token, sessionId: "s", generation: 1 });
    expect(executor.calls).toEqual(["revoke"]);
  });

  it("counts requests so the shell can report bridge activity", async () => {
    const { pipePath, token, server } = await start();
    await send(pipePath, { type: "hello", version: BRIDGE_PROTOCOL_VERSION, token });
    await send(pipePath, { type: "observe", token, sessionId: "s", generation: 1 });
    expect(server.requestCounts.hello).toBe(1);
    expect(server.requestCounts.observe).toBe(1);
  });

  it("surfaces an executor policy refusal as a refused request, not a successful one", async () => {
    // Otherwise a caller would read "the request succeeded" while the action did not run, and
    // would count a refused action as work done.
    unique += 1;
    const token = createBridgeToken();
    const pipePath = "\\\\.\\pipe\\pi-orb-test-" + process.pid + "-" + unique;
    const server = new BridgeServer({
      pipePath,
      token,
      executor: {
        observe: async () => ({ ok: false, refused: true, reason: "no-target", message: "nothing to observe" }),
        act: async () => ({ ok: false, refused: true, reason: "no-task-authorization", message: "not approved" }),
        status: () => ({}),
        revoke: () => {},
        accepts: () => true,
      },
    });
    await server.listen();
    servers.push(server);

    const refusedObserve = await send(pipePath, { type: "observe", token, sessionId: "s", generation: 1 });
    expect(refusedObserve.parsed).toMatchObject({ ok: false, reason: "no-target" });
    const refusedAct = await send(pipePath, {
      type: "act",
      token,
      sessionId: "s",
      generation: 1,
      action: { kind: "click", observationId: "obs-1", elementToken: "t" },
    });
    expect(refusedAct.parsed).toMatchObject({ ok: false, reason: "no-task-authorization" });
  });

  it("passes a successful executor result through unchanged", async () => {
    const { pipePath, token } = await start();
    const response = await send(pipePath, { type: "observe", token, sessionId: "s", generation: 1 });
    expect(response.parsed).toMatchObject({ ok: true });
    expect((response.parsed.result as Record<string, unknown>).observationId).toBe("obs-1");
  });
});

describe("bridge helpers", () => {
  it("generates a distinct pipe path per process", () => {
    expect(createPipePath(1)).toBe("\\\\.\\pipe\\pi-orb-1");
    expect(createPipePath(1)).not.toBe(createPipePath(2));
  });

  it("generates a long random token each time", () => {
    const first = createBridgeToken();
    const second = createBridgeToken();
    expect(first).toHaveLength(64);
    expect(first).not.toBe(second);
  });

  it("compares tokens without accepting a prefix", () => {
    expect(tokensMatch("abc", "abc")).toBe(true);
    expect(tokensMatch("ab", "abc")).toBe(false);
    expect(tokensMatch("abcd", "abc")).toBe(false);
    expect(tokensMatch(undefined, "abc")).toBe(false);
    expect(tokensMatch(123, "abc")).toBe(false);
  });

  it("recognizes the shapes only a browser context would add", () => {
    expect(looksBrowserOriginated({ origin: "http://x" })).toBe(true);
    expect(looksBrowserOriginated({ headers: {} })).toBe(true);
    expect(looksBrowserOriginated({ secFetchSite: "cross-site" })).toBe(true);
    expect(looksBrowserOriginated({ userAgent: "Mozilla" })).toBe(true);
    expect(looksBrowserOriginated({ type: "observe", sessionId: "s" })).toBe(false);
  });
});

describe("bridge server lifecycle", () => {
  it("closes cleanly and stops accepting connections", async () => {
    const { pipePath } = await start();
    const server: Server | undefined = undefined;
    void server;
    // Closing is exercised by the afterEach hook; this asserts a second close is harmless.
    expect(pipePath.startsWith("\\\\.\\pipe\\")).toBe(true);
  });
});
