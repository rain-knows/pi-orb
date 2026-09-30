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
  type SetOrbAccessRequest,
  type CaptureRequest,
  type DesktopTaskStatus,
  type OrbSessionEvent,
  type PromptRequest,
  type ScreenshotCaptureResult,
  type ScreenshotResolveRequest,
  type ScreenshotResolveResult,
  type ScreenshotExportRequest,
  type ScreenshotExportResult,
  type WorkspaceCandidateResult,
  type WorkspaceStatus,
  type FloatingWindowState,
  type ShellMenuEditFlags,
  type ShellMenuAction,
  type ListSessionHistoryResult,
  type OpenSessionHistoryResult,
  type OrbSelectionContext,
  type ListModelsResult,
  type SetModelRequest,
  type SetModelResult,
  type QuestionResponseRequest,
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
  onShellMenuAction(listener: (action: ShellMenuAction) => void): () => void;
  setOrbAccess(request: SetOrbAccessRequest): Promise<DesktopTaskStatus>;
  revokeOrbAccess(): Promise<DesktopTaskStatus>;
  getOrbAccess(): Promise<DesktopTaskStatus>;
  validateWorkspace(candidate: string): Promise<WorkspaceCandidateResult>;
  chooseWorkspace(): Promise<WorkspaceCandidateResult>;
  setWorkspace(candidate: string, createConfirmed: boolean): Promise<WorkspaceStatus>;
  ensureSession(): Promise<string>;
  newConversation(): Promise<string>;
  listSessionHistory(): Promise<ListSessionHistoryResult>;
  openSessionHistory(sessionId: string): Promise<OpenSessionHistoryResult>;
  sendPrompt(request: PromptRequest): Promise<void>;
  abort(request: AbortRequest): Promise<void>;
  listModels(): Promise<ListModelsResult>;
  setModel(request: SetModelRequest): Promise<SetModelResult>;
  respondQuestion(request: QuestionResponseRequest): Promise<void>;
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
  onShellMenuAction: (listener) => {
    const handler = (_event: unknown, action: ShellMenuAction) => listener(action);
    ipcRenderer.on(IPC.shellMenuAction, handler);
    return () => ipcRenderer.removeListener(IPC.shellMenuAction, handler);
  },
  setOrbAccess: (request: SetOrbAccessRequest) => ipcRenderer.invoke(IPC.setOrbAccess, request),
  revokeOrbAccess: () => ipcRenderer.invoke(IPC.revokeOrbAccess),
  getOrbAccess: () => ipcRenderer.invoke(IPC.getOrbAccess),
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
  listModels: () => ipcRenderer.invoke(IPC.listModels),
  setModel: (request: SetModelRequest) => ipcRenderer.invoke(IPC.setModel, request),
  respondQuestion: (request: QuestionResponseRequest) => ipcRenderer.invoke(IPC.respondQuestion, request),
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
