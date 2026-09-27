/**
 * Owns the single pending screenshot and the explicit-consent decision.
 *
 * The whole point of this module is that the *only* way an image can reach the Orb
 * session is: user asks to capture → the image is validated → the user confirms that
 * exact image → it is attached to a prompt. Cancelling, a stale confirmation, or an
 * automatic capture request all end with nothing sent.
 *
 * It is deliberately free of Electron and network access so the rule can be tested
 * directly, because a mistake here is a privacy failure rather than a bug.
 */

import {
  authorizeCapture,
  resolveConfirmation,
  type CaptureOrigin,
  type CaptureTargetSnapshot,
  type PendingCapture,
  type ScreenshotImage,
} from "@shared/screenshot";

export interface PendingCaptureStoreDeps {
  readonly now?: () => number;
  readonly newObservationId?: () => string;
}

export interface StartCaptureInput {
  readonly origin: CaptureOrigin;
  readonly userInitiated: boolean;
  readonly target: CaptureTargetSnapshot | null;
  readonly image: ScreenshotImage | null;
  readonly targetStale: boolean;
}

export type StartCaptureResult =
  | { readonly ok: true; readonly pending: PendingCapture }
  | { readonly ok: false; readonly message: string };

export class PendingCaptureStore {
  readonly #now: () => number;
  readonly #newId: () => string;
  #pending: PendingCapture | null = null;

  constructor(deps: PendingCaptureStoreDeps = {}) {
    this.#now = deps.now ?? Date.now;
    this.#newId = deps.newObservationId ?? (() => randomObservationId());
  }

  get pending(): PendingCapture | null {
    return this.#pending;
  }

  /**
   * Validate a capture and hold it for confirmation.
   *
   * Any previous pending capture is dropped first: the user is looking at this new
   * image, so an older confirmation must not be able to act on the old one.
   */
  start(input: StartCaptureInput): StartCaptureResult {
    this.#pending = null;

    const validation = authorizeCapture(
      {
        userInitiated: input.userInitiated,
        target: input.target,
        image: input.image,
      },
      input.origin,
    );
    if (!validation.ok || !input.target || !input.image) {
      return { ok: false, message: validation.message };
    }

    this.#pending = {
      observationId: this.#newId(),
      target: input.target,
      image: input.image,
      capturedAt: this.#now(),
    };
    return { ok: true, pending: this.#pending };
  }

  /**
   * Apply the user's decision.
   *
   * Only a decision that matches the capture currently held consumes it. A stale or
   * unmatched decision is refused and leaves the current capture and its message
   * intact, so a late click from an earlier preview cannot cost the user the preview
   * they are looking at.
   */
  resolve(
    observationId: string,
    confirmed: boolean,
  ):
    | { action: "refuse"; reason: string }
    | { action: "discard"; reason: string }
    | { action: "send"; pending: PendingCapture } {
    const outcome = resolveConfirmation({
      pending: this.#pending,
      observationId,
      confirmed,
    });
    if (outcome.action !== "refuse") {
      this.#pending = null;
    }
    return outcome;
  }

  /** Drop any pending capture. Idempotent; used on disconnect and shutdown. */
  discard(): void {
    this.#pending = null;
  }
}

/**
 * An opaque, unguessable-enough identifier.
 *
 * It only has to distinguish this preview from an earlier one within one run. It
 * carries no authority: the confirmation is accepted solely because it matches the
 * capture currently held in memory, never because of what the value contains.
 */
export function randomObservationId(): string {
  return `obs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
