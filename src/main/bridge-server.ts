/**
 * The Electron side of the bridge: a Windows named pipe that serves the Pi extension.
 *
 * Verified properties this depends on (evidence/p0-03):
 *  - a named pipe has no TCP listener, so no web page and no LAN client can reach it;
 *  - every request carries the per-run token, the session id and the run generation;
 *  - a request from an older generation is refused.
 *
 * This module owns the transport and the admission checks. It delegates the actual
 * desktop work to an injected executor, so the admission rules can be tested without any
 * driver and without a desktop.
 */

import { createServer, type Server } from "node:net";
import { withToolTiming, timeToolPhase } from "@shared/tool-timing";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_TOKEN_FILENAME,
  looksBrowserOriginated,
  tokensMatch,
  type BridgeRefusal,
  type BridgeResponse,
} from "@shared/bridge-protocol";
import { MAX_SCREENSHOT_BYTES } from "@shared/screenshot";

/** JSON/base64 overhead requires headroom over the per-image byte ceiling. */
export const MAX_BRIDGE_FRAME_BYTES = Math.ceil(MAX_SCREENSHOT_BYTES * 1.5) + 256 * 1024;

export interface BridgeExecutor {
  /** Perform an observation. Returns a JSON-serializable result. */
  observe(input: { readonly sessionId: string; readonly generation: number; readonly signal?: AbortSignal }): Promise<unknown>;
  /** Perform one action. Returns a JSON-serializable result. */
  act(action: unknown, sessionId: string, generation: number, signal?: AbortSignal): Promise<unknown>;
  batch(value: unknown, sessionId: string, generation: number, signal?: AbortSignal, progress?: (step: number, total: number) => void): Promise<unknown>;
  /** Report the task state for the session. */
  status(): unknown;
  /** Revoke the current session desktop Access grant. */
  revoke(): void;
  /**
   * Confirm that a session/generation pair is the live run.
   *
   * Returns a falsey value when it is not, or an explicit reason when the caller can tell the two cases
   * apart. "The session does not belong to this shell" and "the generation is old" call for different
   * user actions, so reporting both as `stale-generation` is misleading: it tells the user their run is
   * stale when the real problem is that the session is not this shell's.
   */
  accepts(
    sessionId: string,
    generation: number,
  ): boolean | { readonly ok: boolean; readonly reason?: "stale-generation" | "unknown-session" };
}

export interface BridgeServerOptions {
  readonly pipePath: string;
  readonly token: string;
  readonly executor: BridgeExecutor;
  readonly log?: (entry: Record<string, unknown>) => void;
}

export class BridgeServer {
  readonly #options: BridgeServerOptions;
  #server: Server | null = null;
  #connections = 0;
  #requests: Record<string, number> = {};

  constructor(options: BridgeServerOptions) {
    this.#options = options;
  }

  get connectionCount(): number {
    return this.#connections;
  }

  get requestCounts(): Record<string, number> {
    return { ...this.#requests };
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => {
        this.#connections += 1;
        let buffer = "";
        let handled = false;
        let finished = false;
        const controller = new AbortController();
        const cancel = () => { if (!finished) controller.abort(new Error("Bridge client disconnected.")); };
        socket.on("end", cancel);
        socket.on("data", (chunk) => {
          if (handled) return;
          buffer += chunk.toString("utf8");
          const newline = buffer.indexOf("\n");
          if (buffer.length > MAX_BRIDGE_FRAME_BYTES) { handled = true; socket.end(`${JSON.stringify(refuse("malformed", "Request frame too large."))}\n`); return; }
          if (newline === -1) {
            // A request must be a single newline-terminated JSON object. Refusing an
            // oversized frame keeps a misbehaving client from growing this buffer forever.
            return;
          }
          handled = true;
          const frame = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          const requestId = (() => { try { const id = JSON.parse(frame).requestId; return typeof id === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(id) ? id : randomUUID(); } catch { return randomUUID(); } })();
          void withToolTiming(requestId, entry => this.#log(entry), () => timeToolPhase("executor-total", () => this.#handle(frame, controller.signal, (step, total) => { if (!socket.destroyed) socket.write(`${JSON.stringify({ type: "progress", requestId, step, total })}\n`); }))).then((response) => {
            finished = true;
            socket.end(`${JSON.stringify(response)}\n`);
          });
        });
        socket.on("error", () => {
          // A client that vanishes mid-request is not an error worth surfacing.
        });
        socket.on("close", () => {
          cancel();
          this.#connections = Math.max(0, this.#connections - 1);
        });
      });

      server.once("error", reject);
      server.listen(this.#options.pipePath, () => {
        this.#server = server;
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async #handle(frame: string, signal: AbortSignal, progress: (step: number, total: number) => void): Promise<BridgeResponse> {
    let request: Record<string, unknown>;
    try {
      request = JSON.parse(frame) as Record<string, unknown>;
    } catch {
      return refuse("malformed", "Request is not valid JSON.");
    }

    const type = typeof request.type === "string" ? request.type : "unknown";
    this.#requests[type] = (this.#requests[type] ?? 0) + 1;

    // Defence in depth: a named pipe is not reachable from a web page, but a browser-flagged
    // request is refused anyway so the rule cannot be lost by a future transport change.
    if (looksBrowserOriginated(request)) {
      this.#log({ event: "refused", type, reason: "browser-originated-request" });
      return refuse("browser-originated-request", "Browser-originated requests are not accepted.");
    }

    if (!tokensMatch(request.token, this.#options.token)) {
      this.#log({ event: "refused", type, reason: "bad-token" });
      return refuse("bad-token", "The bridge token is missing or wrong.");
    }

    if (request.version !== BRIDGE_PROTOCOL_VERSION) {
      return refuse(
        "version-mismatch",
        `Bridge protocol version ${String(request.version)} is not supported (expected ${BRIDGE_PROTOCOL_VERSION}).`,
      );
    }

    if (typeof request.requestId !== "string" || request.requestId.length < 1 || request.requestId.length > 128) return refuse("malformed", "Request correlation ID required.");
    const sessionId = typeof request.sessionId === "string" ? request.sessionId : "";
    const generation = typeof request.generation === "number" ? request.generation : -1;

    switch (type) {
      case "hello":
        return { ok: true, result: { version: BRIDGE_PROTOCOL_VERSION } };
      case "observe":
      case "act":
      case "batch":
      case "status":
      case "revoke": {
        const admission = this.#options.executor.accepts(sessionId, generation);
        const admitted = typeof admission === "boolean" ? admission : admission.ok;
        if (!admitted) {
          const reason =
            typeof admission === "boolean" ? "stale-generation" : (admission.reason ?? "stale-generation");
          const message =
            reason === "unknown-session"
              ? "That session does not belong to this Orb run. Start the Orb session first."
              : "This request belongs to an earlier run and was refused.";
          this.#log({ event: "refused", type, reason, sessionId, generation });
          return refuse(reason, message);
        }
        try {
          if (type === "observe") {
            const result = await this.#options.executor.observe({ sessionId, generation, signal });
            return promoteRefusal(result);
          }
          if (type === "act") {
            const result = await this.#options.executor.act(request.action, sessionId, generation, signal);
            return promoteRefusal(result);
          }
          if (type === "batch") return { ok: true, result: await this.#options.executor.batch(request.batch, sessionId, generation, signal, progress) };
          if (type === "revoke") {
            this.#options.executor.revoke();
            return { ok: true, result: { revoked: true } };
          }
          return { ok: true, result: this.#options.executor.status() };
        } catch (error) {
          // An executor failure is returned as a refusal, never as a silent success.
          return { ok: false, reason: "executor-error", message: errorMessage(error) };
        }
      }
      default:
        return refuse("malformed", `Unknown request type: ${type}`);
    }
  }

  #log(entry: Record<string, unknown>): void {
    this.#options.log?.({ at: new Date().toISOString(), ...entry });
  }
}

function refuse(reason: BridgeRefusal, message: string): BridgeResponse {
  return { ok: false, reason, message };
}

/**
 * Surface a policy refusal as a refused request rather than a successful one.
 *
 * The broker answers with `{ ok: false, refused: true, reason, message }` when policy blocks an
 * action. Wrapping that in a successful bridge reply would tell the caller "the request
 * succeeded" while the action did not run — the caller would then render a refusal as a plain
 * result, and any admission counter would count it as work done. Promoting it keeps a refusal
 * a refusal all the way to the extension, whose own contract is `ok: false` means refused.
 */
function promoteRefusal(result: unknown): BridgeResponse {
  if (result !== null && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (record.ok === false && typeof record.reason === "string") {
      return {
        ok: false,
        reason: record.reason,
        message: typeof record.message === "string" ? record.message : "The request was refused.",
      };
    }
  }
  return { ok: true, result };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Generate a per-run bridge token.
 *
 * 32 bytes of randomness is far beyond what is needed to stop a local process from
 * guessing it; the real protection is that the pipe only accepts the current run's token
 * *and* a live session/generation pair.
 */
export function createBridgeToken(): string {
  return randomBytes(32).toString("hex");
}

/** A pipe name unique to this process, so two Orb instances cannot collide. */
export function createPipePath(processId: number): string {
  return `\\\\.\\pipe\\pi-orb-${processId}`;
}

export interface BridgeHandshakeFiles {
  readonly tokenFile: string;
  readonly workspace: string;
  readonly pipePath: string;
}

/**
 * Write the handshake files the extension reads.
 *
 * The token goes into a file under the Orb data directory rather than into an environment
 * variable, because the extension runs inside pi-web's process, whose environment this project
 * cannot set. Environment variables are also visible in process listings on this platform.
 *
 * The pipe name and the run generation are carried here too. The extension cannot derive either: the
 * pipe name embeds the shell's process id, and the generation is the shell's own counter. Without the
 * generation the extension could only guess, and a wrong guess is refused as stale — so the desktop
 * tools would never run.
 *
 * The file is rewritten on every start and whenever the generation changes, so a token or a
 * generation from a previous run cannot be replayed.
 */
export function writeHandshake(
  dataDir: string,
  token: string,
  workspace: string,
  processId: number,
  generation: number,
): BridgeHandshakeFiles {
  mkdirSync(dataDir, { recursive: true });
  const pipePath = createPipePath(processId);
  const tokenFile = join(dataDir, BRIDGE_TOKEN_FILENAME);
  writeFileSync(
    tokenFile,
    `${JSON.stringify(
      {
        version: BRIDGE_PROTOCOL_VERSION,
        token,
        pid: processId,
        workspace,
        pipePath,
        generation,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  return { tokenFile, workspace, pipePath };
}

/** Remove the token file on exit so a later run cannot read a stale token. */
export function removeHandshake(dataDir: string): void {
  try {
    rmSync(join(dataDir, BRIDGE_TOKEN_FILENAME), { force: true });
  } catch {
    // Best effort: the file is rewritten on the next start regardless.
  }
}
