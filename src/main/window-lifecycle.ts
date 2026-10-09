/**
 * The orb window's lifecycle rules.
 *
 * Hiding the orb is not cosmetic. The agreed first-version rule
 * (doc/product-contract.md §6.1, "收起就撤销桌面操作") is that a hidden orb must not keep
 * the ability to move the user's mouse or keyboard, and must not hold an image waiting to be sent.
 * The chat session is deliberately unaffected, so a running conversation continues.
 *
 * The rule lives here, as one object with one `collapse` method, because it was previously spread
 * across every place that hid the window: the wake shortcut, the window's close button and the tray
 * menu each hid the window independently, and only one of them revoked. Collapsing through a
 * different door silently kept desktop authority alive.
 *
 * Free of Electron so the pairing is testable directly; the caller supplies the two side effects.
 */

export interface CollapseTarget {
  /** Hide the window. */
  hide(): void;
  /** True when the window no longer exists and cannot be hidden. */
  isDestroyed(): boolean;
}

export interface DesktopOperations {
  /** Revoke the session-level Orb desktop authority. Idempotent. */
  revokeOrbAccess(): void;
  /** Drop any unconfirmed screenshot. Idempotent. */
  discardPendingCapture(): void;
  /**
   * Drop the record of "the window the user was looking at". Idempotent.
   *
   * Collapsing means the user has moved on from that window, so the record stops being current. This
   * was a real gap: the collapse routine revoked the task authority and dropped the pending capture
   * but left the record, so after hiding the orb a screenshot would still silently capture the window
   * that was in front whenever the orb last woke — the very reuse `revokeDesktopOperations` documents
   * as forbidden. Because collapse is the path a user actually takes, the stale record was reachable
   * in normal use, not just in theory.
   */
  clearRecordedTarget(): void;
}

export type WindowLifecycleAction = "collapsed" | "noop";

export class OrbWindowLifecycle {
  readonly #target: CollapseTarget;
  readonly #operations: DesktopOperations;
  readonly #log: (message: string) => void;
  #collapseCount = 0;

  constructor(target: CollapseTarget, operations: DesktopOperations, log: (message: string) => void = () => {}) {
    this.#target = target;
    this.#operations = operations;
    this.#log = log;
  }

  /** How many times the orb has been collapsed, for lifecycle assertions. */
  get collapseCount(): number {
    return this.#collapseCount;
  }

  /**
   * Hide the orb and revoke everything desktop-related.
   *
   * Returns `"noop"` for a destroyed window rather than throwing: collapsing a window that is
   * already gone is not an error, but it must also not pretend to have revoked anything.
   */
  collapse(): WindowLifecycleAction {
    if (this.#target.isDestroyed()) return "noop";
    this.#target.hide();
    // Order matters only in that all of them must happen; there is no window in which hiding should
    // outlive the authority, the pending capture or the record of the target window.
    this.#operations.revokeOrbAccess();
    this.#operations.discardPendingCapture();
    this.#operations.clearRecordedTarget();
    this.#collapseCount += 1;
    this.#log("[pi-orb] orb collapsed: desktop operations revoked");
    return "collapsed";
  }

  /** Wake the orb. Waking grants nothing: authority still requires an explicit user decision. */
  wake(show: () => void): void {
    show();
  }
}
