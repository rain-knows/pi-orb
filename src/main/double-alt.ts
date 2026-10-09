/**
 * Physical double-Alt gesture detection. This is a pi-orb capability with no reference counterpart:
 * deepseek-harness-orb has no global shortcut and no double-Alt gesture, so there is nothing to
 * port here and nothing to claim parity with. See doc/reference-playbook.md
 *
 * The detector only identifies the gesture. The caller decides what it means (pi-orb opens the
 * existing screenshot preview), so this module never captures a screen or sends a prompt.
 */

export const LEFT_ALT_KEYCODE = 56;
export const RIGHT_ALT_KEYCODE = 3640;
export const DEFAULT_DOUBLE_ALT_GAP_MS = 300;

export interface DoubleAltKeyboardEvent {
  readonly keycode: number;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

export interface DoubleAltHookLike {
  on(event: "keydown" | "keyup", listener: (event: DoubleAltKeyboardEvent) => void): unknown;
  removeListener?(event: "keydown" | "keyup", listener: (event: DoubleAltKeyboardEvent) => void): unknown;
}

export class DoubleAltDetector {
  readonly #hook: DoubleAltHookLike;
  readonly #onTrigger: () => void;
  readonly #gapMs: number;
  readonly #now: () => number;
  #started = false;
  #leftDown = false;
  #rightDown = false;
  #blocked = false;
  #firstDownAt: number | null = null;
  #triggered = false;

  readonly #onKeyDown = (event: DoubleAltKeyboardEvent): void => {
    if (event.keycode !== LEFT_ALT_KEYCODE && event.keycode !== RIGHT_ALT_KEYCODE) return;
    const isLeft = event.keycode === LEFT_ALT_KEYCODE;
    if (isLeft ? this.#leftDown : this.#rightDown) return;
    if (event.ctrlKey === true || event.metaKey === true || event.shiftKey === true) this.#blocked = true;
    if (isLeft) this.#leftDown = true;
    else this.#rightDown = true;

    const now = this.#now();
    if (this.#firstDownAt === null) {
      this.#firstDownAt = now;
      return;
    }
    if (
      this.#leftDown &&
      this.#rightDown &&
      !this.#blocked &&
      !this.#triggered &&
      now - this.#firstDownAt <= this.#gapMs
    ) {
      this.#triggered = true;
      this.#onTrigger();
    }
  };

  readonly #onKeyUp = (event: DoubleAltKeyboardEvent): void => {
    if (event.keycode === LEFT_ALT_KEYCODE) this.#leftDown = false;
    else if (event.keycode === RIGHT_ALT_KEYCODE) this.#rightDown = false;
    else return;
    if (!this.#leftDown && !this.#rightDown) this.reset();
  };

  constructor(
    hook: DoubleAltHookLike,
    onTrigger: () => void,
    options: { readonly gapMs?: number; readonly now?: () => number } = {},
  ) {
    this.#hook = hook;
    this.#onTrigger = onTrigger;
    this.#gapMs = options.gapMs ?? DEFAULT_DOUBLE_ALT_GAP_MS;
    this.#now = options.now ?? (() => Date.now());
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#hook.on("keydown", this.#onKeyDown);
    this.#hook.on("keyup", this.#onKeyUp);
  }

  stop(): void {
    if (!this.#started) return;
    this.#hook.removeListener?.("keydown", this.#onKeyDown);
    this.#hook.removeListener?.("keyup", this.#onKeyUp);
    this.#started = false;
    this.reset();
  }

  reset(): void {
    this.#leftDown = false;
    this.#rightDown = false;
    this.#blocked = false;
    this.#firstDownAt = null;
    this.#triggered = false;
  }

  /**
   * Forget held state whose key-up was never delivered (P2-02's "锁屏／休眠恢复无卡键").
   *
   * `#leftDown`/`#rightDown` are cleared only by key-up events, and a machine that locks or sleeps
   * with Alt held never delivers one. The detector then treats the first real press afterwards as a
   * repeat and discards it, so the gesture stops working — silently, and until the user happens to
   * press and release that Alt again. `#triggered` has the same exposure, which would limit the
   * gesture to once per lock cycle.
   *
   * Kept as a named method rather than having callers reach for `reset`: the reason differs (recovery
   * from a lost edge versus clearing between gestures), and that distinction is the whole point of the
   * requirement.
   */
  recoverFromLostKeyUp(): void {
    this.reset();
  }
}
