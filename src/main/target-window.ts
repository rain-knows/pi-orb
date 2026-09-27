/**
 * Records the window the user was looking at, before the orb takes focus.
 *
 * Why this exists (doc/pi-orb-development-goals.md §6.2): the target must be
 * recorded *before* waking, otherwise the orb becomes the foreground window and
 * captures itself.
 *
 * Implementation note for P1-05: the locked Cua contract exposes an `active` flag on
 * its window records (`cua_driver_contract.d.ts`), which is the intended replacement
 * for this lookup once the driver is installed. This module is the seam: only
 * `readTargetWindow` has to change, and the capture, limit and confirmation rules
 * above it stay as they are.
 */

import { execFile } from "node:child_process";
import { join } from "node:path";
import type { CaptureTarget, CaptureTargetSnapshot } from "@shared/screenshot";

export interface TargetWindowReader {
  read(pidToIgnore: number): Promise<CaptureTarget | null>;
  /** True when the recorded handle is still the active window. */
  isStillForeground(handle: string): Promise<boolean>;
}

interface HelperWindowPayload {
  readonly handle: string;
  readonly processId: number;
  readonly title: string;
  readonly visible: boolean;
  readonly dpi: number;
  readonly bounds: { x: number; y: number; width: number; height: number };
}

interface HelperPayload {
  readonly ok: boolean;
  readonly reason?: string;
  readonly foreground?: HelperWindowPayload | null;
  readonly stillForeground?: boolean;
  readonly dpiAwareness?: {
    readonly isPerMonitorV2: boolean;
    readonly setCallSucceeded: boolean;
  };
}

export interface Win32TargetWindowReaderOptions {
  readonly scriptPath?: string;
  readonly timeoutMs?: number;
}

export class Win32TargetWindowReader implements TargetWindowReader {
  readonly #scriptPath: string;
  readonly #timeoutMs: number;

  constructor(options: Win32TargetWindowReaderOptions = {}) {
    this.#scriptPath =
      options.scriptPath ?? join(__dirname, "native", "foreground-window.ps1");
    this.#timeoutMs = options.timeoutMs ?? 8000;
  }

  async read(pidToIgnore: number): Promise<CaptureTarget | null> {
    const payload = await this.#run([]);
    const window = payload.foreground ?? null;
    if (!window) return null;
    // Defensive: if the orb somehow already holds focus, refusing here means we
    // report "no target" rather than silently capturing the orb.
    if (pidToIgnore > 0 && window.processId === pidToIgnore) return null;
    return {
      handle: window.handle,
      processId: window.processId,
      title: window.title,
      bounds: window.bounds,
      dpi: window.dpi,
    };
  }

  async isStillForeground(handle: string): Promise<boolean> {
    const payload = await this.#run(["-IsStillForeground", handle]);
    return payload.stillForeground === true;
  }

  /** Exposed so the DPI-awareness declaration can be verified, not assumed. */
  async readDpiAwareness(): Promise<HelperPayload["dpiAwareness"] | null> {
    const payload = await this.#run([]);
    return payload.dpiAwareness ?? null;
  }

  async #run(extraArgs: readonly string[]): Promise<HelperPayload> {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        this.#powershell(),
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          this.#scriptPath,
          ...extraArgs,
        ],
        { timeout: this.#timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
        (error, out) => {
          if (error) {
            reject(new Error(`Target-window helper failed: ${error.message}`));
            return;
          }
          resolve(out);
        },
      );
    });

    const line = stdout
      .split(/\r?\n/)
      .reverse()
      .find((entry) => entry.trim().startsWith("{"));
    if (!line) {
      throw new Error("Target-window helper returned no JSON.");
    }
    const parsed = JSON.parse(line) as HelperPayload;
    if (!parsed.ok) {
      throw new Error(parsed.reason ?? "Target-window helper reported a failure.");
    }
    return parsed;
  }

  #powershell(): string {
    return process.platform === "win32" ? "powershell.exe" : "pwsh";
  }
}

export interface TargetRecording {
  readonly snapshot: CaptureTargetSnapshot;
  /**
   * True when the recorded window is already gone or is no longer the active
   * window. The capture is still attempted for the recorded handle, and the preview
   * says so, so the user can decide instead of being surprised by a stale image.
   */
  readonly stale: boolean;
}
