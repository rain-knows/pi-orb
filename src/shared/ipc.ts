/**
 * IPC contract shared by the Electron main process, the preload bridge and the
 * renderer.
 *
 * Rules (see doc/pi-orb-development-goals.md §4.4 and doc/tech-stack.md §3.1):
 *  - The renderer never receives credentials, a generic IPC handle, or Node APIs.
 *  - Every request carries the running generation, so a message produced for an
 *    earlier run cannot act on the current one.
 *  - The channel list below is exhaustive; the preload exposes nothing else.
 */

export const IPC = {
  /** Renderer -> main: re-probe the pi-web connection. */
  refreshConnection: "orb:refresh-connection",
  /** Renderer -> main: change the global wake shortcut. */
  setShortcut: "orb:set-shortcut",
  /** Renderer -> main: read the Orb configuration and workspace status. */
  getStatus: "orb:get-status",
  /** Renderer -> main: validate a candidate workspace directory (read-only). */
  validateWorkspace: "orb:validate-workspace",
  /** Renderer -> main: pick a directory through the native dialog. */
  chooseWorkspace: "orb:choose-workspace",
  /** Renderer -> main: commit a workspace, optionally creating it. */
  setWorkspace: "orb:set-workspace",
  /** Renderer -> main: create/resume the Orb session for the current workspace. */
  ensureSession: "orb:ensure-session",
  /** Renderer -> main: send a prompt into the Orb session. */
  sendPrompt: "orb:send-prompt",
  /** Renderer -> main: stop the running turn. */
  abort: "orb:abort",
  /** Main -> renderer: streaming session events. */
  sessionEvent: "orb:session-event",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export interface WorkspaceStatus {
  readonly configured: boolean;
  /** Resolved directory, or `null` when no workspace is configured. */
  readonly workspace: string | null;
  /** Human-readable reason shown to the user when the workspace is unusable. */
  readonly problem: string | null;
  readonly shortcut: string;
  readonly shortcutRegistered: boolean;
  /**
   * Why the configured shortcut is not active, or `null` when it is.
   *
   * A shortcut that silently fails to register leaves the orb unreachable, so the
   * reason is part of the snapshot the user can see.
   */
  readonly shortcutProblem: string | null;
  /**
   * The run generation a client must echo back on a prompt or abort.
   *
   * This is part of the status snapshot rather than a pushed event: the initial
   * generation is decided before the renderer has subscribed, so a pushed message
   * would be lost and every prompt would be refused as stale.
   */
  readonly generation: number;
  /** True while a turn is running, so a second chat request is refused. */
  readonly busy: boolean;
  /**
   * The pi-web session this shell is bound to, or `null` before one is created.
   *
   * Exposed so a client can confirm which session it is acting on, and so two
   * clients can tell whether they are looking at the same conversation.
   */
  readonly sessionId: string | null;
  /**
   * State of the pi-web service this shell talks to.
   *
   * Also pull-based, for the same reason: a startup notice is produced before the
   * renderer has subscribed, so a pushed message would be lost and the shell would
   * look healthy when it is not.
   */
  readonly piWeb: PiWebStatus;
}

export interface PiWebStatus {
  readonly baseUrl: string;
  readonly reachable: boolean;
  /** Set when the shell could not authenticate or reach the service. */
  readonly problem: string | null;
}

export interface WorkspaceCandidateResult {
  readonly ok: boolean;
  readonly message: string;
  readonly resolved: string | null;
}

export const SESSION_EVENT_CHANNEL_NAME = "orb:session-event";

export type OrbSessionEvent =
  | { readonly type: "session"; readonly sessionId: string; readonly generation: number }
  | { readonly type: "assistant-delta"; readonly text: string }
  | { readonly type: "assistant-message"; readonly text: string }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "idle"; readonly stopReason: string | null };

export interface PromptRequest {
  readonly generation: number;
  readonly text: string;
}

export interface AbortRequest {
  readonly generation: number;
}
