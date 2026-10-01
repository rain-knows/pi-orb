import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient, bridgeTimeoutMs } from "../pi-package/extensions/bridge-client";
import { BridgeServer } from "../src/main/bridge-server";
import { BRIDGE_PROTOCOL_VERSION } from "@shared/bridge-protocol";

let dir = "";

it("retains a pre-input surface change screenshot across the real named pipe", async () => {
  const pipePath = `\\\\.\\pipe\\orb-surface-${process.pid}-${Date.now()}`;
  const observation = { observationId: "new-page", image: { data: "AQID", mimeType: "image/png" } };
  const server = new BridgeServer({ pipePath, token: "a".repeat(64), executor: {
    accepts: () => true, status: () => ({}), revoke: () => {}, observe: async () => ({}), batch: async () => ({}),
    act: async () => ({ ok: false, reason: "surface-changed", message: "No input sent.", observation }),
  } });
  await server.listen();
  try {
    const client = new BridgeClient({ pipePath, tokenFile: "unused" });
    const result = await client.call({ type: "act", sessionId: "s", generation: 1, action: {} },
      { version: 2, token: "a".repeat(64), pid: 1, workspace: "test", pipePath, generation: 1, createdAt: "now" });
    expect(result).toMatchObject({ ok: false, reason: "surface-changed", result: { observation } });
  } finally { await server.close(); }
});

it("budgets declared waits and batches", () => {
  expect(bridgeTimeoutMs({type:"act",sessionId:"s",generation:1,action:{kind:"longWait",waitSeconds:120}})).toBe(150_000);
  expect(bridgeTimeoutMs({type:"batch",sessionId:"s",generation:1,batch:{actions:[{}, {}, {}]}})).toBe(90_000);
  expect(bridgeTimeoutMs({type:"browser",sessionId:"s",generation:1,browser:{name:"browser_click"}})).toBeGreaterThan(90_000 + 15_000);
});

it("streams correlated progress and cancels a disconnected execution", async () => {
  const pipePath=`\\\\.\\pipe\\orb-cancel-${process.pid}-${Date.now()}`;
  let cancelled=false;let entered!:()=>void;const started=new Promise<void>(r=>entered=r);
  const server=new BridgeServer({pipePath,token:"a".repeat(64),executor:{accepts:()=>true,status:()=>({}),revoke:()=>{},observe:async()=>({}),act:async()=>({}),batch:async(_batch,_id,_generation,signal,progress)=>{progress?.(1,2);entered();await new Promise<void>(r=>signal?.addEventListener("abort",()=>{cancelled=true;r();},{once:true}));return {ok:false,completed:0};}}});
  await server.listen();
  const handshake={version:2,token:"a".repeat(64),pid:1,workspace:dir,pipePath,generation:1,createdAt:"now"};
  const controller=new AbortController();const updates:number[]=[];
  try {
    const client=new BridgeClient({pipePath,tokenFile:"unused"});
    const pending=client.call({type:"batch",sessionId:"s",generation:1,batch:{actions:[{},{}]}},handshake,controller.signal,(step)=>updates.push(step));
    await started;await new Promise(r=>setTimeout(r,20));expect(updates).toEqual([1]);controller.abort();
    expect(await pending).toMatchObject({reason:"cancelled"});await new Promise(r=>setTimeout(r,20));expect(cancelled).toBe(true);
  } finally {await server.close();}
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-orb-handshake-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write a handshake file, overriding individual fields to exercise the validation. */
function writeHandshakeFile(overrides: Record<string, unknown> = {}): string {
  const path = join(dir, "bridge-token.json");
  writeFileSync(
    path,
    JSON.stringify({
      version: BRIDGE_PROTOCOL_VERSION,
      token: "a".repeat(64),
      pid: 1234,
      workspace: "C:\\work\\orb",
      pipePath: "\\\\.\\pipe\\pi-orb-1234",
      generation: 7,
      createdAt: new Date().toISOString(),
      ...overrides,
    }),
    "utf8",
  );
  return path;
}

function client(path: string) {
  return new BridgeClient({ pipePath: "", tokenFile: path });
}

describe("handshake reading", () => {
  it("reads the token, pipe path and run generation", () => {
    const parsed = client(writeHandshakeFile()).readToken();
    expect(parsed).not.toBeNull();
    expect(parsed?.token).toHaveLength(64);
    expect(parsed?.pipePath).toBe("\\\\.\\pipe\\pi-orb-1234");
    expect(parsed?.generation).toBe(7);
  });

  it("returns null when the file is absent", () => {
    expect(client(join(dir, "missing.json")).readToken()).toBeNull();
  });

  it("returns null for a version mismatch instead of guessing", () => {
    expect(client(writeHandshakeFile({ version: BRIDGE_PROTOCOL_VERSION + 1 })).readToken()).toBeNull();
  });

  it("requires the generation rather than defaulting it", () => {
    // Defaulting it would produce a request the shell refuses as stale, which looks like a policy
    // decision instead of a missing handshake. This was a real defect: the extension sent 0 and every
    // desktop tool call was refused.
    expect(client(writeHandshakeFile({ generation: undefined })).readToken()).toBeNull();
    expect(client(writeHandshakeFile({ generation: "7" })).readToken()).toBeNull();
    expect(client(writeHandshakeFile({ generation: 1.5 })).readToken()).toBeNull();
  });

  it("requires the pipe path and the token", () => {
    expect(client(writeHandshakeFile({ pipePath: "" })).readToken()).toBeNull();
    expect(client(writeHandshakeFile({ pipePath: undefined })).readToken()).toBeNull();
    expect(client(writeHandshakeFile({ token: "" })).readToken()).toBeNull();
    expect(client(writeHandshakeFile({ workspace: 5 })).readToken()).toBeNull();
  });

  it("returns null for malformed JSON rather than throwing", () => {
    const path = join(dir, "broken.json");
    writeFileSync(path, "{not json", "utf8");
    expect(client(path).readToken()).toBeNull();
  });

  it("accepts generation 1, which is the shell's first run", () => {
    // The off-by-one trap: the shell starts at 1, so a default of 0 is always stale.
    const parsed = client(writeHandshakeFile({ generation: 1 })).readToken();
    expect(parsed?.generation).toBe(1);
  });

  it("re-reads the file each time, so a bumped generation is picked up", () => {
    const path = writeHandshakeFile({ generation: 1 });
    const bridge = client(path);
    expect(bridge.readToken()?.generation).toBe(1);
    writeHandshakeFile({ generation: 2 });
    expect(bridge.readToken()?.generation).toBe(2);
  });
});

describe("bridge call targets", () => {
  it("reports a clear refusal when no pipe is known", async () => {
    const result = await client(writeHandshakeFile()).call(
      { type: "status", sessionId: "s", generation: 1 },
      { ...client(writeHandshakeFile()).readToken()!, pipePath: "" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-configured");
  });

  it("reports unreachable rather than throwing when the pipe does not exist", async () => {
    const bridge = new BridgeClient({
      pipePath: "\\\\.\\pipe\\pi-orb-does-not-exist",
      tokenFile: writeHandshakeFile(),
      timeoutMs: 2000,
    });
    const result = await bridge.call({ type: "status", sessionId: "s", generation: 1 }, bridge.readToken()!);
    expect(result.ok).toBe(false);
  });

  it("connects using the handshake pipe when no pipe environment override exists", async () => {
    const pipePath = process.platform === "win32"
      ? `\\\\.\\pipe\\pi-orb-handshake-test-${process.pid}-${Date.now()}`
      : join(dir, "bridge.sock");
    const bridge = client(writeHandshakeFile({ pipePath }));
    const server = createServer((socket) => {
      socket.on("data", (chunk) => {
        const request = JSON.parse(chunk.toString("utf8")) as { type: string; token: string };
        socket.end(`${JSON.stringify({ ok: request.type === "status" && request.token === "a".repeat(64), result: { reached: true } })}\n`);
      });
    });
    await new Promise<void>((resolve) => server.listen(pipePath, resolve));
    try {
      const result = await bridge.call({ type: "status", sessionId: "s", generation: 7 }, bridge.readToken()!);
      expect(result).toEqual({ ok: true, result: { reached: true } });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
