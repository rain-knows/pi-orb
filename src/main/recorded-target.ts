/**
 * The one record of "the window the user was looking at".
 *
 * The rule this enforces (doc/pi-orb-development-goals.md §6.2 P1-04): the target must be recorded
 * **before the orb takes focus**, because afterwards the orb is the foreground window and a lookup
 * would return the orb itself.
 *
 * Two consequences follow from recording once and sharing the record:
 *
 *  1. The screenshot flow must **consume** the record rather than re-read the foreground window.
 *     Re-reading at the moment the user presses the screenshot button always fails — by then the
 *     user is interacting with the orb — which made the positive capture path unreachable.
 *  2. Recording happens on a wake and on a deliberate user action, never on a timer, and never after
 *     the window is shown.
 *
 * Kept free of Electron so the ordering rules are testable directly.
 */

import type { CaptureTarget, CaptureTargetSnapshot } from "@shared/screenshot";

export interface RecordedTargetStoreDeps {
  /** Read the current foreground window, excluding this process. */
  readonly readForeground: () => Promise<CaptureTarget | null>;
  /** True when a recorded handle still refers to the same window. */
  readonly isStillValid: (handle: string, title: string) => Promise<{ valid: boolean; currentTitle: string }>;
  readonly now?: () => number;
  readonly log?: (message: string) => void;
}

export type RecordOutcome =
  | { readonly ok: true; readonly snapshot: CaptureTargetSnapshot }
  | { readonly ok: false; readonly reason: "no-foreground-window" | "orb-has-focus" };

export interface TargetValidity {
  readonly valid: boolean;
  readonly reason: "ok" | "no-record" | "window-gone" | "window-changed";
  readonly snapshot: CaptureTargetSnapshot | null;
  /** Present when the window changed, so the user can be told what it is now. */
  readonly currentTitle?: string;
}

export class RecordedTargetStore {
  readonly #deps: RecordedTargetStoreDeps;
  #snapshot: CaptureTargetSnapshot | null = null;
  #recordCount = 0;

  constructor(deps: RecordedTargetStoreDeps) {
    this.#deps = deps;
  }

  get snapshot(): CaptureTargetSnapshot | null {
    return this.#snapshot;
  }

  get recordCount(): number {
    return this.#recordCount;
  }

  /**
   * Record the current foreground window.
   *
   * Call this **before** showing or focusing the orb. Returns a refusal rather than storing nothing
   * silently, so the caller can tell the user why nothing can be captured.
   */
  async record(): Promise<RecordOutcome> {
    const target = await this.#deps.readForeground().catch(() => null);
    if (!target) {
      // A record that cannot be taken means there is no *current* record, so the previous one must
      // not survive it. The whole reason a record is written at a wake is that the user is saying
      // "this is the window I am looking at now"; keeping the older snapshot would let a later
      // capture silently use a window the user has already moved away from — a privacy failure that
      // presents as a successful capture.
      //
      // The most common cause is that the orb itself already has focus. Saying so is more useful
      // than a generic failure, because it tells the user the order to do things in.
      this.#snapshot = null;
      this.#deps.log?.("[pi-orb] no foreground window to record; the orb must not take focus first");
      return { ok: false, reason: "no-foreground-window" };
    }
    const now = this.#deps.now ?? Date.now;
    this.#snapshot = { target, recordedAt: now() };
    this.#recordCount += 1;
    this.#deps.log?.(
      `[pi-orb] recorded target: pid ${target.processId} "${target.title}" (${target.bounds.width}x${target.bounds.height}, dpi ${target.dpi})`,
    );
    return { ok: true, snapshot: this.#snapshot };
  }

  /**
   * Discard the record.
   *
   * Called when the record can no longer be trusted as "what the user was looking at": a workspace
   * change, a collapse, or shutdown.
   */
  clear(): void {
    this.#snapshot = null;
  }

  /**
   * Check that the record still refers to the same window.
   *
   * This is deliberately not a foreground test. After the user switches to the orb the recorded
   * window is no longer in front by design, so requiring foreground-ness would refuse every capture
   * the user asked for. What must hold is that the window still exists and its title still agrees,
   * which catches a destroyed and recycled handle.
   */
  async validate(): Promise<TargetValidity> {
    const snapshot = this.#snapshot;
    if (!snapshot) return { valid: false, reason: "no-record", snapshot: null };

    const check = await this.#deps
      .isStillValid(snapshot.target.handle, snapshot.target.title)
      .catch(() => ({ valid: false, currentTitle: "" }));

    if (check.valid) return { valid: true, reason: "ok", snapshot };
    return {
      valid: false,
      reason: check.currentTitle.length > 0 ? "window-changed" : "window-gone",
      snapshot,
      currentTitle: check.currentTitle,
    };
  }
}
