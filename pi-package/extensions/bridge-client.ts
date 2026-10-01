/**
 * The Pi extension side of the bridge.
 *
 * Runs inside pi-web's Node service, so it must not import Electron and must not assume it
 * can talk to a renderer. It connects to the shell's named pipe, authenticates with the
 * per-run token, and forwards desktop requests.
 *
 * Failure policy: when the bridge is unavailable, every tool reports a clear reason. It
 * must never silently succeed, and it must never fall back to acting without the shell —
 * the shell is what holds the user's authorization decision.
 */

import { randomUUID } from "node:crypto";
import { timeToolPhase, withToolTiming } from "../../src/shared/tool-timing.js";
import { connect } from "node:net";
import { readFileSync, existsSync } from "node:fs";
import type {
  BridgeRefusal,
  BridgeRequestBody,
  BridgeTokenFile,
} from "../../src/shared/bridge-protocol.js";
import { BRIDGE_PROTOCOL_VERSION, BRIDGE_TOKEN_FILENAME } from "../../src/shared/bridge-protocol.js";

/**
 * Where the shell writes its handshake.
 *
 * Mirrors the shell's own default (`%APPDATA%\pi-orb` on Windows, `$XDG_CONFIG_HOME/pi-orb`
 * elsewhere). Kept as a local helper rather than importing the Electron-facing module so the
 * extension stays free of Electron.
 */
export function defaultTokenFilePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir?: string,
): string {
  const separator = platform === "win32" ? "\\" : "/";
  if (platform === "win32") {
    const appData =
      nonBlank(env.APPDATA) ??
      `${nonBlank(env.USERPROFILE) ?? homeDir ?? ""}${separator}AppData${separator}Roaming`;
    return `${appData}${separator}pi-orb${separator}${BRIDGE_TOKEN_FILENAME}`;
  }
  const configHome = nonBlank(env.XDG_CONFIG_HOME) ?? `${homeDir ?? "/root"}${separator}.config`;
  return `${configHome}${separator}pi-orb${separator}${BRIDGE_TOKEN_FILENAME}`;
}

function nonBlank(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export interface BridgeClientOptions {
  /** Explicit pipe override for tests or controlled embedding; production uses the handshake pipe. */
  readonly pipePath: string;
  readonly tokenFile: string;
  /** Per-request timeout. A hung shell must not hang the model's tool call. */
  readonly timeoutMs?: number;
}

export type BridgeCallResult =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly reason: BridgeRefusal | string; readonly message: string; readonly result?: unknown };

export class BridgeClient {
  readonly #options: BridgeClientOptions;

  constructor(options: BridgeClientOptions) {
    this.#options = options;
  }

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): BridgeClient | null {
    // The environment is optional: it only overrides where to look. The default is the same
    // well-known handshake file the shell writes, which is what makes this work inside
    // pi-web's process, whose environment this project cannot set.
    const tokenFile = env.PI_ORB_BRIDGE_TOKEN_FILE ?? defaultTokenFilePath(env);
    const pipePath = env.PI_ORB_BRIDGE_PIPE ?? "";
    return new BridgeClient({ pipePath, tokenFile });
  }

  /**
 * Read the token written by the shell for this run.
 *
 * Returns `null` when the file is absent, unreadable, mismatched in version, or missing the token,
 * pipe path or run generation. Every one of those cases means "no desktop capability", which is the
 * safe direction: a request with a guessed generation is refused by the shell anyway, so failing here
 * just reports it earlier and more clearly.
 */
readToken(): BridgeTokenFile | null {
  if (!existsSync(this.#options.tokenFile)) return null;
  try {
    const parsed = JSON.parse(readFileSync(this.#options.tokenFile, "utf8")) as Partial<BridgeTokenFile>;
    if (parsed.version !== BRIDGE_PROTOCOL_VERSION) return null;
    if (typeof parsed.token !== "string" || parsed.token.length === 0) return null;
    if (typeof parsed.workspace !== "string") return null;
    if (parsed.orbSessionId !== null && typeof parsed.orbSessionId !== "string") return null;
    if (typeof parsed.pipePath !== "string" || parsed.pipePath.length === 0) return null;
    // The generation is required, not defaulted. Defaulting it (to 0, say) would produce a request the
    // shell refuses as stale, which looks like a policy decision rather than a missing handshake.
    if (typeof parsed.generation !== "number" || !Number.isInteger(parsed.generation)) return null;
    return {
      version: parsed.version,
      token: parsed.token,
      pid: typeof parsed.pid === "number" ? parsed.pid : -1,
      workspace: parsed.workspace,
      orbSessionId: parsed.orbSessionId,
      pipePath: parsed.pipePath,
      generation: parsed.generation,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : "",
    };
  } catch {
    return null;
  }
}

  /** Send one request and await the single line of JSON the shell replies with. */
  async call(request: BridgeRequestBody, handshake: BridgeTokenFile, signal?: AbortSignal, onProgress?: (step: number, total: number) => void): Promise<BridgeCallResult> {
    const requestId = request.requestId ?? randomUUID();
    if (signal?.aborted) return { ok: false, reason: "cancelled", message: "Request cancelled." };
    const payload = `${JSON.stringify({ version: BRIDGE_PROTOCOL_VERSION, ...request, requestId, token: handshake.token })}\n`;
    const timeoutMs = this.#options.timeoutMs ?? bridgeTimeoutMs(request);
    const target = handshake.pipePath || this.#options.pipePath;
    if (!target) {
      return {
        ok: false,
        reason: "not-configured",
        message: "No Orb bridge pipe is known, so desktop actions are unavailable.",
      };
    }

    return withToolTiming(requestId, entry => console.log(`[pi-orb] timing ${JSON.stringify(entry)}`), () => timeToolPhase("bridge-roundtrip", () => new Promise<BridgeCallResult>((resolve) => {
      let settled = false;
      const finish = (value: BridgeCallResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        socket.destroy();
        resolve(value);
      };

      const socket = connect(target);
      const timer = setTimeout(() => {
        finish({
          ok: false,
          reason: "timeout",
          message: `The Orb shell did not answer within ${timeoutMs} ms.`,
        });
      }, timeoutMs);

      socket.on("connect", () => socket.write(payload));
      const cancel = () => finish({ ok: false, reason: "cancelled", message: "Request cancelled." });
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      let data = "";
      socket.on("data", (chunk) => {
        data += chunk.toString("utf8");
        while (data.includes("\n")) {
          const newline = data.indexOf("\n"); const line = data.slice(0, newline); data = data.slice(newline + 1);
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === "progress") { if (parsed.requestId === requestId) onProgress?.(parsed.step, parsed.total); continue; }
            if (parsed.ok) finish({ ok: true, result: parsed.result });
            else finish({ ok: false, reason: parsed.reason, message: parsed.message, ...(parsed.result ? { result: parsed.result } : {}) });
          } catch { finish({ ok: false, reason: "malformed", message: "Invalid bridge response." }); }
        }
      });
      socket.on("end", () => { if (!settled) finish({ ok: false, reason: "malformed", message: "Bridge closed without a result." }); });
      socket.on("error", (error) => {
        // A missing pipe is the normal "shell is not running" case, not an exception to
        // propagate into the model's tool call.
        finish({
          ok: false,
          reason: "unreachable",
          message: `The Orb shell is not reachable on its bridge: ${(error as NodeJS.ErrnoException).code ?? error.message}`,
        });
      });
    })));
  }
}

/** Declared waits must outlive their work; batches budget each native action independently. */
export function bridgeTimeoutMs(request: BridgeRequestBody): number {
  // Browser actions allow 90s plus a 15s inline snapshot; leave 5s for transport.
  if (request.type === "browser") return 110_000;
  if (request.type === "batch") {
    const count = (request.batch as { actions?: unknown[] } | null)?.actions?.length ?? 1;
    return 30_000 * Math.min(8, Math.max(1, count));
  }
  if (request.type === "act") {
    const action = request.action as { kind?: string; waitSeconds?: number } | null;
    if (action?.kind === "longWait" && typeof action.waitSeconds === "number" && Number.isFinite(action.waitSeconds)) return 30_000 + Math.min(120, Math.max(0, action.waitSeconds)) * 1000;
  }
  return 30_000;
}
