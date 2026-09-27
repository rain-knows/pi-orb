/**
 * Renderer view of the preload bridge.
 *
 * The renderer has no Node access, so the bridge type is declared locally instead
 * of being imported from the preload module.
 */

import type {
  AbortRequest,
  CaptureRequest,
  OrbSessionEvent,
  PromptRequest,
  ScreenshotCaptureResult,
  ScreenshotResolveRequest,
  ScreenshotResolveResult,
  WorkspaceCandidateResult,
  WorkspaceStatus,
} from "@shared/ipc";

export interface OrbBridge {
  getStatus(): Promise<WorkspaceStatus>;
  refreshConnection(): Promise<WorkspaceStatus>;
  setShortcut(accelerator: string): Promise<WorkspaceStatus>;
  validateWorkspace(candidate: string): Promise<WorkspaceCandidateResult>;
  chooseWorkspace(): Promise<WorkspaceCandidateResult>;
  setWorkspace(candidate: string, createConfirmed: boolean): Promise<WorkspaceStatus>;
  ensureSession(): Promise<string>;
  sendPrompt(request: PromptRequest): Promise<void>;
  abort(request: AbortRequest): Promise<void>;
  captureScreenshot(request: CaptureRequest): Promise<ScreenshotCaptureResult>;
  resolveScreenshot(request: ScreenshotResolveRequest): Promise<ScreenshotResolveResult>;
  discardScreenshot(): Promise<boolean>;
  onSessionEvent(listener: (event: OrbSessionEvent) => void): () => void;
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
