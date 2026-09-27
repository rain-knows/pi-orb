/**
 * The screenshot consent flow: record a target, capture it, hold it for review, and
 * act on the user's decision.
 *
 * Extracted from the main process so it can be driven directly in tests with stubbed
 * collaborators. That matters because the properties worth proving here are not
 * "did Electron capture a window" but:
 *   - the bytes the user previewed are the exact bytes that get sent;
 *   - cancelling, or a confirmation that does not match the shown preview, uploads
 *     nothing;
 *   - a failure to identify the target never degrades into a full-screen capture.
 *
 * These are privacy properties, so they are verified against the real decision code
 * rather than re-described in a document.
 */

import { describeTarget, toImageContent, type CaptureTargetSnapshot, type ScreenshotImage } from "@shared/screenshot";
import type { ScreenshotCaptureResult, ScreenshotResolveResult } from "@shared/ipc";
import { PendingCaptureStore } from "./pending-capture";

export interface CaptureOutcomeLike {
  readonly image: ScreenshotImage | null;
  readonly reason: string | null;
}

export interface ScreenshotFlowDeps {
  /** Record the window the user was looking at, before the orb takes focus. */
  readonly readTarget: () => Promise<CaptureTargetSnapshot | null>;
  /** Whether the recorded window is still the active window. */
  readonly isStillForeground: (handle: string) => Promise<boolean>;
  /** Capture one already-recorded window. */
  readonly capture: (target: CaptureTargetSnapshot["target"]) => Promise<CaptureOutcomeLike>;
  /** Send the confirmed message and image together. */
  readonly send: (text: string, images: readonly ReturnType<typeof toImageContent>[]) => Promise<void>;
  readonly store?: PendingCaptureStore;
}

export class ScreenshotFlow {
  readonly #deps: ScreenshotFlowDeps;
  readonly #store: PendingCaptureStore;
  #queuedText: string | null = null;

  constructor(deps: ScreenshotFlowDeps) {
    this.#deps = deps;
    this.#store = deps.store ?? new PendingCaptureStore();
  }

  get pending() {
    return this.#store.pending;
  }

  /**
   * Capture the recorded target for preview.
   *
   * `text` is the message the capture belongs to. It is kept here and sent only
   * together with the confirmed image, so a cancelled preview cannot leave a message
   * behind waiting to be sent.
   */
  async start(text: string): Promise<ScreenshotCaptureResult> {
    const target = await this.#deps.readTarget().catch(() => null);
    if (!target) {
      this.#store.discard();
      this.#queuedText = null;
      return {
        ok: false,
        message:
          "No target window was recorded. The target is recorded before the orb takes focus, so bring the window you want to share to the front first.",
      };
    }

    // Ask the OS whether that window is still active. A stale answer is reported;
    // it is not used to switch to a different window.
    const stillForeground = await this.#deps.isStillForeground(target.target.handle).catch(() => false);

    const outcome = await this.#deps.capture(target.target).catch((error: Error) => ({
      image: null,
      reason: error.message,
    }));

    const started = this.#store.start({
      origin: "user-request",
      userInitiated: true,
      target,
      image: outcome.image,
      targetStale: !stillForeground,
    });
    if (!started.ok) {
      this.#queuedText = null;
      return { ok: false, message: outcome.reason ?? started.message };
    }

    this.#queuedText = text;
    const image = started.pending.image;
    return {
      ok: true,
      observationId: started.pending.observationId,
      data: image.data,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      bytes: base64Bytes(image.data),
      targetDescription: describeTarget(target.target),
      targetStale: !stillForeground,
    };
  }

  /**
   * Apply the user's decision.
   *
   * The image sent is read from the store's pending capture, which holds the same
   * object the preview was built from. There is no path here that re-captures or
   * re-encodes, so "what was previewed" and "what was sent" cannot diverge.
   */
  async resolve(
    observationId: string,
    confirmed: boolean,
  ): Promise<ScreenshotResolveResult> {
    const outcome = this.#store.resolve(observationId, confirmed);
    if (outcome.action === "refuse") {
      // A decision that does not match the live preview changes nothing: the user's
      // pending screenshot and its message stay available.
      return { ok: false, sent: false, message: outcome.reason };
    }
    if (outcome.action === "discard") {
      this.#queuedText = null;
      return { ok: false, sent: false, message: outcome.reason };
    }

    const text = this.#queuedText;
    this.#queuedText = null;
    if (text === null) {
      return {
        ok: false,
        sent: false,
        message: "The message this screenshot belonged to is no longer pending. Nothing was sent.",
      };
    }

    try {
      await this.#deps.send(text, [toImageContent(outcome.pending.image)]);
    } catch (error) {
      return {
        ok: false,
        sent: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return { ok: true, sent: true };
  }

  /** Drop the pending capture and its message. Idempotent. */
  discard(): void {
    this.#store.discard();
    this.#queuedText = null;
  }
}

function base64Bytes(data: string): number {
  if (data.length % 4 !== 0) return 0;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}
