/**
 * The orb window's lifecycle rules.
 *
 * Hiding the orb is not cosmetic. The agreed first-version rule
 * (doc/pi-orb-development-goals.md §6.1, "收起就撤销桌面操作") is that a hidden orb must not keep
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
  /** Revoke the desktop task authority. Idempotent. */
  revokeDesktopTask(): void;
  /** Drop any unconfirmed screenshot. Idempotent. */
  discardPendingCapture(): void;
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
    // Order matters only in that both must happen; there is no window in which hiding should
    // outlive the authority.
    this.#operations.revokeDesktopTask();
    this.#operations.discardPendingCapture();
    this.#collapseCount += 1;
    this.#log("[pi-orb] orb collapsed: desktop operations revoked");
    return "collapsed";
  }

  /** Wake the orb. Waking grants nothing: authority still requires an explicit user decision. */
  wake(show: () => void): void {
    show();
  }
}
