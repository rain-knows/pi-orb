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
  /** Renderer -> main: change the reference-style floating ball/panel geometry. */
  setFloatingExpanded: "orb:set-floating-expanded",
  /** Renderer -> main: move the collapsed ball while dragging. */
  moveFloatingBall: "orb:move-floating-ball",
  /** Renderer -> main: commit a drag and clamp or dock the ball. */
  clampFloatingBall: "orb:clamp-floating-ball",
  /** Renderer -> main: pull a docked tab back into the display. */
  unsnapFloatingBall: "orb:unsnap-floating-ball",
  /**
   * Renderer -> main: collapse the orb.
   *
   * A floating window needs a way to hide itself that does not depend on a global shortcut or the
   * tray, and this goes through the same lifecycle routine, so collapsing from the window revokes
   * desktop operations exactly like the other routes.
   */
  collapseOrb: "orb:collapse",
  /**
   * Renderer -> main: show the shell's context menu at a point in the window.
   *
   * The menu is built in the main process because Electron has no default context menu: without one,
   * right-clicking the composer offers no cut/copy/paste at all. The reference builds the equivalent
   * surface the same way (`floatingContextMenuTemplate`), and its first block is the same
   * text-editing set, enabled from the focused field's `editFlags`.
   */
  shellMenu: "orb:shell-menu",
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
  /** Renderer -> main: start a fresh Pi session in the current workspace. */
  newConversation: "orb:new-conversation",
  /** Renderer -> main: list persisted sessions for the Orb workspace. */
  listSessionHistory: "orb:list-session-history",
  /** Renderer -> main: attach the Orb shell to one persisted session. */
  openSessionHistory: "orb:open-session-history",
  /** Renderer -> main: send a prompt into the Orb session. */
  sendPrompt: "orb:send-prompt",
  /** Renderer -> main: stop the running turn. */
  abort: "orb:abort",
  /** Renderer -> main: capture the previously recorded target window for preview. */
  captureScreenshot: "orb:capture-screenshot",
  /** Renderer -> main: confirm or cancel the previewed screenshot. */
  resolveScreenshot: "orb:resolve-screenshot",
  /** Renderer -> main: save the still-pending preview and copy it to the clipboard. */
  exportScreenshot: "orb:export-screenshot",
  /** Renderer -> main: discard any pending screenshot (idempotent). */
  discardScreenshot: "orb:discard-screenshot",
  /** Renderer -> main: grant a desktop task authorization after an explicit user decision. */
  authorizeDesktopTask: "orb:authorize-desktop-task",
  /** Renderer -> main: revoke the desktop task authorization. */
  revokeDesktopTask: "orb:revoke-desktop-task",
  /** Renderer -> main: read the desktop task state (authorization, budget, stop reason). */
  getDesktopTaskStatus: "orb:get-desktop-task-status",
  /** Renderer -> main: list the windows the user can choose to work with. */
  listDesktopWindows: "orb:list-desktop-windows",
  /** Renderer -> main: record which window desktop actions may target. */
  setDesktopTarget: "orb:set-desktop-target",
  /** Main -> renderer: streaming session events. */
  sessionEvent: "orb:session-event",
  /** Main -> renderer: the physical double-Alt gesture entered screenshot preview. */
  doubleAltGesture: "orb:double-alt-gesture",
  /** Main -> renderer: the foreground application's selected text changed. */
  selectionContext: "orb:selection-context",
  /** Renderer -> main: read the latest native selection snapshot. */
  getSelectionContext: "orb:get-selection-context",
  /** Renderer -> main: discard the latest native selection snapshot. */
  clearSelectionContext: "orb:clear-selection-context",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export interface FloatingWindowState {
  readonly expanded: boolean;
  readonly horizontal: "left" | "right";
  readonly vertical: "up" | "down";
  readonly docked: "left" | "right" | undefined;
}

/**
 * The focused field's editing capabilities, read in the renderer and forwarded when the shell's menu
 * opens. `isEditable` decides whether the edit block is offered at all; the rest enable individual
 * roles so a disabled item shows that there is nothing to cut or paste, rather than doing nothing
 * when clicked.
 */
export interface ShellMenuEditFlags {
  readonly isEditable: boolean;
  readonly canCut: boolean;
  readonly canCopy: boolean;
  readonly canPaste: boolean;
  readonly canSelectAll: boolean;
}

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
  /**
   * Desktop task state.
   *
   * Pull-based like the rest of the snapshot: an authorization grant and its remaining budget
   * are current state, and the user must be able to see exactly what was approved.
   */
  readonly desktopTask: DesktopTaskStatus;
}

/**
 * What the user can see about desktop authorization.
 *
 * Every field is here so the UI can state plainly whether the orb may touch the desktop, for
 * what, and why it stopped — the model's own claims are never the source of truth.
 */
export interface DesktopTaskStatus {
  readonly authorized: boolean;
  readonly taskId: string | null;
  readonly scope: string | null;
  readonly actionsUsed: number;
  readonly actionLimit: number;
  readonly expiresAt: number | null;
  readonly stopped: boolean;
  readonly stoppedReason: string | null;
  /** Whether the shell's bridge is listening, so the extension can reach it at all. */
  readonly bridgeReady: boolean;
  /**
   * The window desktop actions will target, or `null` when none is chosen.
   *
   * Surfaced because the orb refuses to guess a target: the user has to see which window it is
   * about to act on before approving a task.
   */
  readonly target: DesktopWindowChoice | null;
}

export interface AuthorizeDesktopTaskRequest {
  readonly generation: number;
  readonly scope: string;
}

/** A window the user can choose to work with. */
export interface DesktopWindowChoice {
  /** Driver window id as a string; the driver reports it as a bigint. */
  readonly windowId: string;
  readonly pid: number;
  readonly appName: string;
  readonly title: string;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Higher is closer to the front, or `null` when the driver reports no order. */
  readonly zIndex: string | null;
  /** True when this is the window the shell recorded before taking focus. */
  readonly isRecorded: boolean;
}

export type ListDesktopWindowsResult =
  | { readonly ok: true; readonly windows: readonly DesktopWindowChoice[] }
  | { readonly ok: false; readonly message: string };

export type SetDesktopTargetResult =
  | { readonly ok: true; readonly target: DesktopWindowChoice }
  | { readonly ok: false; readonly message: string };

export interface PiWebStatus {
  readonly baseUrl: string;
  readonly reachable: boolean;
  /** Set when the shell could not authenticate or reach the service. */
  readonly problem: string | null;
}

/** Text selected in another application through the native accessibility API. */
export interface OrbSelectionContext {
  readonly text: string;
  /** The source process id is an observation label, not an authorization token. */
  readonly pid: number | null;
  /** Best-effort visible source label; full paths and clipboard contents are never read. */
  readonly sourceLabel: string | null;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
  readonly capturedAt: number;
}

export interface WorkspaceCandidateResult {
  readonly ok: boolean;
  readonly message: string;
  readonly resolved: string | null;
}

export interface OrbSessionHistoryItem {
  readonly sessionId: string;
  readonly name: string | null;
  readonly modified: string;
  readonly firstMessage: string;
  readonly messageCount: number;
}

export type ListSessionHistoryResult =
  | { readonly ok: true; readonly sessions: readonly OrbSessionHistoryItem[] }
  | { readonly ok: false; readonly message: string };

export interface OrbHistoryMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export type OpenSessionHistoryResult =
  | { readonly ok: true; readonly sessionId: string; readonly messages: readonly OrbHistoryMessage[] }
  | { readonly ok: false; readonly message: string };

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
  /**
   * Screenshot attachments for this message.
   *
   * An image reaches here only through the explicit confirm path, and the data is
   * exactly what the user previewed.
   */
  readonly images?: readonly ImageContent[];
}

/** Pi's image content block; the shape pi-web's `validateAgentImages` accepts. */
export interface ImageContent {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
}

/**
 * Result of a screenshot capture request.
 *
 * The image is carried as base64 for display. Capture itself never writes to disk; an explicit
 * renderer export action may save this still-pending image through the main process.
 */
export type ScreenshotCaptureResult =
  | {
      readonly ok: true;
      readonly observationId: string;
      readonly data: string;
      readonly mimeType: string;
      readonly width: number;
      readonly height: number;
      readonly bytes: number;
      /** Target description for the preview; pixel data is never part of it. */
      readonly targetDescription: string;
      /** True when the previous target window is no longer the active window. */
      readonly targetStale: boolean;
    }
  | { readonly ok: false; readonly message: string };

/**
 * Ask for a capture of the recorded target window, for preview only.
 *
 * `text` is the message the capture belongs to. It is held in the main process and
 * sent only if the user confirms that exact image.
 */
export interface CaptureRequest {
  readonly generation: number;
  readonly text: string;
}

export interface ScreenshotResolveRequest {
  readonly generation: number;
  readonly observationId: string;
  readonly confirmed: boolean;
}

/** Export the exact screenshot currently shown in the preview. */
export interface ScreenshotExportRequest {
  readonly generation: number;
  readonly observationId: string;
}

export type ScreenshotExportResult =
  | { readonly ok: true; readonly path: string; readonly clipboard: boolean }
  | { readonly ok: false; readonly canceled: boolean; readonly message: string };

/**
 * Outcome of confirming a screenshot.
 *
 * On success the image is already attached to the message that was sent, so the
 * renderer only needs the prompt text it was queued with.
 */
export type ScreenshotResolveResult =
  | { readonly ok: true; readonly sent: true }
  | { readonly ok: false; readonly sent: false; readonly message: string };

export interface AbortRequest {
  readonly generation: number;
}
