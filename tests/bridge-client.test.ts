import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../pi-package/extensions/bridge-client";
import { BRIDGE_PROTOCOL_VERSION } from "@shared/bridge-protocol";

let dir = "";

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
      "a".repeat(64),
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
    const result = await bridge.call({ type: "status", sessionId: "s", generation: 1 }, "a".repeat(64));
    expect(result.ok).toBe(false);
  });
});
