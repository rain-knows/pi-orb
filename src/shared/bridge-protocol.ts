/**
 * The bridge between the Pi extension (inside the pi-web Node service) and the Orb
 * desktop broker (inside the Electron main process).
 *
 * Why a separate channel is needed (doc/pi-orb-development-goals.md §4.4, measured in
 * evidence/p0-03): the Pi extension runs in pi-web's Node process, so a renderer IPC
 * channel cannot reach it, and a renderer cannot be trusted with desktop authority
 * anyway. The seam is a Windows named pipe: no TCP listener, so no web page and no LAN
 * client can reach it.
 *
 * This module is a protocol definition only. It is shared by both sides so a field name
 * cannot drift, and it stays free of Electron and Node APIs so it can be bundled into the
 * Pi extension.
 */

/** Protocol version. Both sides refuse a mismatch instead of guessing. */
export const BRIDGE_PROTOCOL_VERSION = 2;

/** Designates the token file inside the Orb data directory. */
export const BRIDGE_TOKEN_FILENAME = "bridge-token.json";

/**
 * Environment variable overriding the pipe path.
 *
 * Optional: the handshake file already carries the pipe, so this exists only for tests and
 * unusual setups.
 */
export const BRIDGE_PIPE_ENV = "PI_ORB_BRIDGE_PIPE";

/** Environment variable overriding the token file path. */
export const BRIDGE_TOKEN_FILE_ENV = "PI_ORB_BRIDGE_TOKEN_FILE";

/** Environment variable telling the extension which workspace is the Orb workspace. */
export const BRIDGE_WORKSPACE_ENV = "PI_ORB_WORKSPACE";

/**
 * The token is written to a file that only the current user can read, rather than passed
 * in an environment variable, so it does not appear in a process listing.
 */
export interface BridgeTokenFile {
  readonly version: number;
  readonly token: string;
  readonly pid: number;
  readonly workspace: string;
  /** Identifies the shell's session even while Access is revoked. Browser routing uses
   * this identity, never cwd, so ordinary Pi Web sessions can share the same directory. */
  readonly orbSessionId: string | null;
  /**
   * The pipe this run listens on.
   *
   * The pipe name embeds the shell's process id, so it cannot be derived by the extension.
   * Carrying it in the handshake file is also what lets the extension work without any
   * environment variable: the Pi extension runs inside *pi-web's* process, whose environment
   * this project cannot set, so a file at a well-known path is the only reliable channel.
   */
  readonly pipePath: string;
  /**
   * The shell's current run generation.
   *
   * Carried here because the extension cannot otherwise know it: the extension runs inside pi-web's
   * process, so this project cannot pass it in an environment variable, and a value of 0 would be
   * refused as stale forever. The shell rewrites this file whenever the generation changes.
   */
  readonly generation: number;
  readonly createdAt: string;
}

export type BridgeRequest = ({ readonly version?: number; readonly requestId?: string }) & (
  | { readonly type: "hello"; readonly version: number; readonly token: string }
  | {
      readonly type: "observe";
      readonly token: string;
      readonly sessionId: string;
      readonly generation: number;
    }
  | {
      readonly type: "act";
      readonly token: string;
      readonly sessionId: string;
      readonly generation: number;
      readonly action: unknown;
    }
  | { readonly type: "code-agent"; readonly token: string; readonly sessionId: string; readonly generation: number; readonly command: "dispatch" | "status" | "stop"; readonly arguments?: unknown }
  | { readonly type: "status"; readonly token: string; readonly sessionId: string; readonly generation: number }
  | { readonly type: "revoke"; readonly token: string; readonly sessionId: string; readonly generation: number });

/**
 * `Omit` over a union type collapses the result to the members' common keys, which would
 * silently drop `sessionId` from every request variant. This distributive form keeps each
 * member's own fields, so a request body cannot be built with a missing or extra field.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A request as sent: the token is added by the client, never supplied by a caller. */
export type BridgeRequestBody = DistributiveOmit<BridgeRequest, "token">;

export type BridgeRefusal =
  | "malformed"
  | "version-mismatch"
  | "bad-token"
  | "browser-originated-request"
  | "stale-generation"
  | "unknown-session"
  | "no-task-authorization"
  | "not-configured";

export type BridgeResponse =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly reason: BridgeRefusal | string; readonly message: string; readonly result?: unknown };

/**
 * Detect a request that came from a browser context rather than from the extension.
 *
 * A named pipe is not reachable from a web page, so this is defence in depth: if the
 * transport ever changed, or a helper proxied it, a browser-flagged request must still be
 * refused. The fields are checked because a browser cannot omit them.
 */
export function looksBrowserOriginated(request: Record<string, unknown>): boolean {
  return (
    typeof request.origin === "string" ||
    typeof request.headers === "object" ||
    typeof request.secFetchSite === "string" ||
    typeof request.userAgent === "string"
  );
}

/**
 * Token comparison that does not leak length or content through timing.
 *
 * The token is generated per run on the shell side; the extension only ever receives it
 * from a file in the user's own profile.
 */
export function tokensMatch(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string") return false;
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return diff === 0;
}
