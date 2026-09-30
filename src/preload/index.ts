/**
 * Preload bridge.
 *
 * Exposes a small, fixed set of Orb operations to the renderer. It deliberately
 * does NOT expose:
 *  - raw Node APIs or `require`,
 *  - a generic `ipcRenderer.invoke` passthrough,
 *  - pi-web credentials or the authenticated client itself.
 *
 * The renderer runs with `contextIsolation: true`, `sandbox: true` and
 * `nodeIntegration: false` (doc/tech-stack.md §3.1).
 */

import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type AbortRequest,
  type AuthorizeDesktopTaskRequest,
  type CaptureRequest,
  type DesktopTaskStatus,
  type ListDesktopWindowsResult,
  type OrbSessionEvent,
  type PromptRequest,
  type ScreenshotCaptureResult,
  type ScreenshotResolveRequest,
  type ScreenshotResolveResult,
  type ScreenshotExportRequest,
  type ScreenshotExportResult,
  type SetDesktopTargetResult,
  type WorkspaceCandidateResult,
  type WorkspaceStatus,
  type FloatingWindowState,
  type ShellMenuEditFlags,
  type ListSessionHistoryResult,
  type OpenSessionHistoryResult,
  type OrbSelectionContext,
} from "@shared/ipc";

export interface OrbBridge {
  getStatus(): Promise<WorkspaceStatus>;
  refreshConnection(): Promise<WorkspaceStatus>;
  setShortcut(accelerator: string): Promise<WorkspaceStatus>;
  setFloatingExpanded(expanded: boolean): Promise<FloatingWindowState>;
  moveFloatingBall(x: number, y: number): Promise<FloatingWindowState>;
  clampFloatingBall(): Promise<FloatingWindowState>;
  unsnapFloatingBall(): Promise<FloatingWindowState>;
  collapseOrb(): Promise<DesktopTaskStatus>;
  /**
   * Open the shell's context menu. `editFlags` are the focused field's own flags from
   * `document.queryCommandEnabled`, which is the only way to learn whether there is a selection to
   * copy or a clipboard to paste from; the main process coerces them to booleans.
   */
  openShellMenu(flags: ShellMenuEditFlags): Promise<boolean>;
  authorizeDesktopTask(request: AuthorizeDesktopTaskRequest): Promise<DesktopTaskStatus>;
  revokeDesktopTask(): Promise<DesktopTaskStatus>;
  getDesktopTaskStatus(): Promise<DesktopTaskStatus>;
  listDesktopWindows(): Promise<ListDesktopWindowsResult>;
  setDesktopTarget(windowId: string): Promise<SetDesktopTargetResult>;
  validateWorkspace(candidate: string): Promise<WorkspaceCandidateResult>;
  chooseWorkspace(): Promise<WorkspaceCandidateResult>;
  setWorkspace(candidate: string, createConfirmed: boolean): Promise<WorkspaceStatus>;
  ensureSession(): Promise<string>;
  newConversation(): Promise<string>;
  listSessionHistory(): Promise<ListSessionHistoryResult>;
  openSessionHistory(sessionId: string): Promise<OpenSessionHistoryResult>;
  sendPrompt(request: PromptRequest): Promise<void>;
  abort(request: AbortRequest): Promise<void>;
  captureScreenshot(request: CaptureRequest): Promise<ScreenshotCaptureResult>;
  resolveScreenshot(request: ScreenshotResolveRequest): Promise<ScreenshotResolveResult>;
  exportScreenshot(request: ScreenshotExportRequest): Promise<ScreenshotExportResult>;
  discardScreenshot(): Promise<boolean>;
  onSessionEvent(listener: (event: OrbSessionEvent) => void): () => void;
  onDoubleAltGesture(listener: () => void): () => void;
  getSelectionContext(): Promise<OrbSelectionContext | null>;
  clearSelectionContext(): Promise<boolean>;
  onSelectionContext(listener: (context: OrbSelectionContext | null) => void): () => void;
}

const bridge: OrbBridge = {
  getStatus: () => ipcRenderer.invoke(IPC.getStatus),
  refreshConnection: () => ipcRenderer.invoke(IPC.refreshConnection),
  setShortcut: (accelerator: string) => ipcRenderer.invoke(IPC.setShortcut, accelerator),
  setFloatingExpanded: (expanded: boolean) => ipcRenderer.invoke(IPC.setFloatingExpanded, expanded),
  moveFloatingBall: (x: number, y: number) => ipcRenderer.invoke(IPC.moveFloatingBall, x, y),
  clampFloatingBall: () => ipcRenderer.invoke(IPC.clampFloatingBall),
  unsnapFloatingBall: () => ipcRenderer.invoke(IPC.unsnapFloatingBall),
  collapseOrb: () => ipcRenderer.invoke(IPC.collapseOrb),
  openShellMenu: (flags: ShellMenuEditFlags) => ipcRenderer.invoke(IPC.shellMenu, flags),
  authorizeDesktopTask: (request: AuthorizeDesktopTaskRequest) =>
    ipcRenderer.invoke(IPC.authorizeDesktopTask, request),
  revokeDesktopTask: () => ipcRenderer.invoke(IPC.revokeDesktopTask),
  getDesktopTaskStatus: () => ipcRenderer.invoke(IPC.getDesktopTaskStatus),
  listDesktopWindows: () => ipcRenderer.invoke(IPC.listDesktopWindows),
  setDesktopTarget: (windowId: string) => ipcRenderer.invoke(IPC.setDesktopTarget, windowId),
  validateWorkspace: (candidate: string) =>
    ipcRenderer.invoke(IPC.validateWorkspace, candidate),
  chooseWorkspace: () => ipcRenderer.invoke(IPC.chooseWorkspace),
  setWorkspace: (candidate: string, createConfirmed: boolean) =>
    ipcRenderer.invoke(IPC.setWorkspace, candidate, createConfirmed),
  ensureSession: () => ipcRenderer.invoke(IPC.ensureSession),
  newConversation: () => ipcRenderer.invoke(IPC.newConversation),
  listSessionHistory: () => ipcRenderer.invoke(IPC.listSessionHistory),
  openSessionHistory: (sessionId: string) => ipcRenderer.invoke(IPC.openSessionHistory, sessionId),
  sendPrompt: (request: PromptRequest) => ipcRenderer.invoke(IPC.sendPrompt, request),
  abort: (request: AbortRequest) => ipcRenderer.invoke(IPC.abort, request),
  captureScreenshot: (request: CaptureRequest) =>
    ipcRenderer.invoke(IPC.captureScreenshot, request),
  resolveScreenshot: (request: ScreenshotResolveRequest) =>
    ipcRenderer.invoke(IPC.resolveScreenshot, request),
  exportScreenshot: (request: ScreenshotExportRequest) =>
    ipcRenderer.invoke(IPC.exportScreenshot, request),
  discardScreenshot: () => ipcRenderer.invoke(IPC.discardScreenshot),
  onSessionEvent: (listener) => {
    const handler = (_event: unknown, payload: OrbSessionEvent) => listener(payload);
    ipcRenderer.on(IPC.sessionEvent, handler);
    return () => {
      ipcRenderer.removeListener(IPC.sessionEvent, handler);
    };
  },
  onDoubleAltGesture: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(IPC.doubleAltGesture, handler);
    return () => {
      ipcRenderer.removeListener(IPC.doubleAltGesture, handler);
    };
  },
  getSelectionContext: () => ipcRenderer.invoke(IPC.getSelectionContext),
  clearSelectionContext: () => ipcRenderer.invoke(IPC.clearSelectionContext),
  onSelectionContext: (listener) => {
    const handler = (_event: unknown, payload: OrbSelectionContext | null) => listener(payload);
    ipcRenderer.on(IPC.selectionContext, handler);
    return () => {
      ipcRenderer.removeListener(IPC.selectionContext, handler);
    };
  },
};

contextBridge.exposeInMainWorld("orb", bridge);
