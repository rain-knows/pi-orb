/**
 * Wake/collapse behaviour for the orb window.
 *
 * P1-03 requires that waking and collapsing work while the window is not focused,
 * and that a repeated press cannot produce a surprising state. Both rules are
 * decided here, as pure logic, so they can be tested without an OS.
 *
 * The window itself is abstracted to a few observable booleans, which is what the
 * main process can actually read from `BrowserWindow`.
 */

export interface WindowState {
  readonly destroyed: boolean;
  readonly visible: boolean;
  readonly minimized: boolean;
  readonly focused: boolean;
}

export type ToggleAction = "noop" | "wake" | "collapse";

/**
 * Decide what a wake/collapse trigger should do.
 *
 * Rules:
 *  - a destroyed window does nothing,
 *  - a minimized window wakes (and must be restored, not just shown),
 *  - only a visible **and focused** window collapses. A visible but unfocused
 *    window is sitting behind something else, and a user reaching for the wake
 *    shortcut wants it back, not hidden.
 */
export function decideToggle(state: WindowState): ToggleAction {
  if (state.destroyed) return "noop";
  if (state.minimized) return "wake";
  if (state.visible && state.focused) return "collapse";
  return "wake";
}

export interface ToggleTarget {
  getState(): WindowState;
  wake(): void;
  collapse(): void;
}

export type TriggerSource = "shortcut" | "tray";

export interface WakeControllerOptions {
  /**
   * Ignore triggers that arrive within this many milliseconds of the last applied
   * one.
   *
   * Suppress closely spaced callbacks from global accelerator repeat and simultaneous
   * shortcut/tray triggers. This time window cannot distinguish a long hold from a
   * later deliberate press; see the A4 manual result in evidence/p1-03/README.md.
   */
  readonly cooldownMs?: number;
  readonly now?: () => number;
}

export const DEFAULT_TRIGGER_COOLDOWN_MS = 250;

export class WakeController {
  readonly #target: ToggleTarget;
  readonly #cooldownMs: number;
  readonly #now: () => number;
  #lastAppliedAt = Number.NEGATIVE_INFINITY;
  #lastAction: ToggleAction = "noop";

  constructor(target: ToggleTarget, options: WakeControllerOptions = {}) {
    this.#target = target;
    this.#cooldownMs = options.cooldownMs ?? DEFAULT_TRIGGER_COOLDOWN_MS;
    this.#now = options.now ?? (() => Date.now());
  }

  /** The action applied by the most recent accepted trigger. */
  get lastAction(): ToggleAction {
    return this.#lastAction;
  }

  /**
   * Apply one trigger.
   *
   * Returns the action taken, or `"throttled"` when the trigger arrived inside the
   * cooldown window. Waking never creates a session, starts a screenshot or sends
   * anything: it only changes window visibility.
   */
  trigger(_source: TriggerSource): Promise<ToggleAction | "throttled"> {
    return this.#apply();
  }

  async #apply(): Promise<ToggleAction | "throttled"> {
    const now = this.#now();
    if (now - this.#lastAppliedAt < this.#cooldownMs) return "throttled";

    const action = decideToggle(this.#target.getState());
    this.#lastAppliedAt = now;
    this.#lastAction = action;

    // Awaited, not fired and forgotten: the order of side effects is part of the contract. A
    // floating window that appears before its target is recorded would record itself, because once
    // the orb takes focus the window the user was looking at is no longer the foreground window.
    if (action === "wake") await this.#target.wake();
    else if (action === "collapse") await this.#target.collapse();
    return action;
  }
}
