/**
 * Renderer view of the preload bridge.
 *
 * The renderer has no Node access, so the bridge type is declared locally instead
 * of being imported from the preload module.
 */

import type {
  AbortRequest,
  AuthorizeDesktopTaskRequest,
  CaptureRequest,
  DesktopTaskStatus,
  ListDesktopWindowsResult,
  OrbSessionEvent,
  PromptRequest,
  ScreenshotCaptureResult,
  ScreenshotResolveRequest,
  ScreenshotResolveResult,
  ScreenshotExportRequest,
  ScreenshotExportResult,
  SetDesktopTargetResult,
  WorkspaceCandidateResult,
  WorkspaceStatus,
  FloatingWindowState,
  ListSessionHistoryResult,
  OpenSessionHistoryResult,
  OrbSelectionContext,
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

declare global {
  interface Window {
    orb?: OrbBridge;
  }
}

export function getBridge(): OrbBridge {
  const bridge = window.orb;
  if (!bridge) {
    throw new Error("The Orb bridge is unavailable.");
  }
  return bridge;
}
