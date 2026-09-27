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
  type CaptureRequest,
  type OrbSessionEvent,
  type PromptRequest,
  type ScreenshotCaptureResult,
  type ScreenshotResolveRequest,
  type ScreenshotResolveResult,
  type WorkspaceCandidateResult,
  type WorkspaceStatus,
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

const bridge: OrbBridge = {
  getStatus: () => ipcRenderer.invoke(IPC.getStatus),
  refreshConnection: () => ipcRenderer.invoke(IPC.refreshConnection),
  setShortcut: (accelerator: string) => ipcRenderer.invoke(IPC.setShortcut, accelerator),
  validateWorkspace: (candidate: string) =>
    ipcRenderer.invoke(IPC.validateWorkspace, candidate),
  chooseWorkspace: () => ipcRenderer.invoke(IPC.chooseWorkspace),
  setWorkspace: (candidate: string, createConfirmed: boolean) =>
    ipcRenderer.invoke(IPC.setWorkspace, candidate, createConfirmed),
  ensureSession: () => ipcRenderer.invoke(IPC.ensureSession),
  sendPrompt: (request: PromptRequest) => ipcRenderer.invoke(IPC.sendPrompt, request),
  abort: (request: AbortRequest) => ipcRenderer.invoke(IPC.abort, request),
  captureScreenshot: (request: CaptureRequest) =>
    ipcRenderer.invoke(IPC.captureScreenshot, request),
  resolveScreenshot: (request: ScreenshotResolveRequest) =>
    ipcRenderer.invoke(IPC.resolveScreenshot, request),
  discardScreenshot: () => ipcRenderer.invoke(IPC.discardScreenshot),
  onSessionEvent: (listener) => {
    const handler = (_event: unknown, payload: OrbSessionEvent) => listener(payload);
    ipcRenderer.on(IPC.sessionEvent, handler);
    return () => {
      ipcRenderer.removeListener(IPC.sessionEvent, handler);
    };
  },
};

contextBridge.exposeInMainWorld("orb", bridge);
