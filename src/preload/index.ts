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
  type OrbSessionEvent,
  type PromptRequest,
  type WorkspaceCandidateResult,
  type WorkspaceStatus,
} from "@shared/ipc";

export interface OrbBridge {
  getStatus(): Promise<WorkspaceStatus>;
  refreshConnection(): Promise<WorkspaceStatus>;
  validateWorkspace(candidate: string): Promise<WorkspaceCandidateResult>;
  chooseWorkspace(): Promise<WorkspaceCandidateResult>;
  setWorkspace(candidate: string, createConfirmed: boolean): Promise<WorkspaceStatus>;
  ensureSession(): Promise<string>;
  sendPrompt(request: PromptRequest): Promise<void>;
  abort(request: AbortRequest): Promise<void>;
  onSessionEvent(listener: (event: OrbSessionEvent) => void): () => void;
}

const bridge: OrbBridge = {
  getStatus: () => ipcRenderer.invoke(IPC.getStatus),
  refreshConnection: () => ipcRenderer.invoke(IPC.refreshConnection),
  validateWorkspace: (candidate: string) =>
    ipcRenderer.invoke(IPC.validateWorkspace, candidate),
  chooseWorkspace: () => ipcRenderer.invoke(IPC.chooseWorkspace),
  setWorkspace: (candidate: string, createConfirmed: boolean) =>
    ipcRenderer.invoke(IPC.setWorkspace, candidate, createConfirmed),
  ensureSession: () => ipcRenderer.invoke(IPC.ensureSession),
  sendPrompt: (request: PromptRequest) => ipcRenderer.invoke(IPC.sendPrompt, request),
  abort: (request: AbortRequest) => ipcRenderer.invoke(IPC.abort, request),
  onSessionEvent: (listener) => {
    const handler = (_event: unknown, payload: OrbSessionEvent) => listener(payload);
    ipcRenderer.on(IPC.sessionEvent, handler);
    return () => {
      ipcRenderer.removeListener(IPC.sessionEvent, handler);
    };
  },
};

contextBridge.exposeInMainWorld("orb", bridge);
