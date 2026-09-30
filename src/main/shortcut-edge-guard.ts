import { validateAccelerator } from "../shared/accelerator";

export interface KeyboardHookEvent {
  readonly keycode: number;
}

export interface KeyboardHookLike {
  on(event: "keydown" | "keyup", listener: (event: KeyboardHookEvent) => void): unknown;
  removeListener?(event: "keydown" | "keyup", listener: (event: KeyboardHookEvent) => void): unknown;
  start(): void;
  stop(): void;
}

/**
 * Turns an OS global-shortcut callback into one callback per physical key press.
 *
 * Electron's globalShortcut is intentionally retained for registration and conflict reporting, but
 * it exposes no key-up event. A low-level hook supplies only the missing edge: once the configured
 * primary key is released, the next globalShortcut callback is eligible again.
 */
export class ShortcutEdgeGuard {
  readonly #hook: KeyboardHookLike;
  #keyCode: number | null = null;
  #latched = false;
  #started = false;
  #enabled = false;
  #error: string | null = null;

  readonly #onKeyUp = (event: KeyboardHookEvent): void => {
    if (this.#keyCode !== null && event.keycode === this.#keyCode) {
      this.#latched = false;
    }
  };

  constructor(hook: KeyboardHookLike) {
    this.#hook = hook;
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  get error(): string | null {
    return this.#error;
  }

  /** Select the primary key for the currently registered accelerator. */
  configure(accelerator: string): void {
    const validation = validateAccelerator(accelerator);
    this.#keyCode = validation.ok && validation.key ? keyCodeForElectronKey(validation.key) : null;
    this.#latched = false;
    if (this.#keyCode === null && validation.ok) {
      this.#error = `No key-up mapping is available for shortcut key "${validation.key}".`;
    } else if (validation.ok) {
      this.#error = null;
    }
  }

  /** Start the hook once. Failure is reported to the caller so the app can keep running visibly. */
  start(): boolean {
    if (this.#started) return this.#enabled;
    this.#started = true;
    try {
      this.#hook.on("keyup", this.#onKeyUp);
      this.#hook.start();
      this.#enabled = true;
      return true;
    } catch (error) {
      this.#enabled = false;
      this.#error = `Keyboard edge detection is unavailable: ${error instanceof Error ? error.message : String(error)}`;
      return false;
    }
  }

  /** Release the native hook on shutdown. */
  stop(): void {
    if (!this.#started) return;
    if (this.#hook.removeListener) this.#hook.removeListener("keyup", this.#onKeyUp);
    try {
      this.#hook.stop();
    } catch (error) {
      this.#error = `Keyboard edge detection could not stop cleanly: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.#enabled = false;
      this.#started = false;
      this.#latched = false;
    }
  }

  /** Return true only for the first global-shortcut callback in one physical key hold. */
  accept(): boolean {
    // A registered accelerator without an active key-up source would silently reintroduce the
    // long-hold bug. Fail closed; the caller surfaces the hook error instead of falling back.
    if (!this.#enabled || this.#keyCode === null) return false;
    if (this.#latched) return false;
    this.#latched = true;
    return true;
  }

  /**
   * Forget a hold whose key-up was never delivered.
   *
   * `#latched` is cleared only by a key-up event, and there are cases where none ever arrives: the
   * machine locks or sleeps with the key down, the hook is unloaded, or the session is switched. The
   * guard then believes the key is still held and rejects every later press — the shortcut silently
   * stops working until the user happens to press and release that exact key again.
   *
   * Called on lock, suspend and resume, and when a session becomes active. Deliberately explicit
   * rather than time-based: there is no honest timeout for "the user is still holding a key".
   */
  releaseLatchedHold(): void {
    this.#latched = false;
  }
}

const KEY_CODES: Record<string, number> = {
  Backspace: 14,
  Backquote: 41,
  Backslash: 43,
  BracketLeft: 26,
  BracketRight: 27,
  CapsLock: 58,
  Comma: 51,
  Delete: 3667,
  End: 3663,
  Enter: 28,
  Escape: 1,
  Equal: 13,
  Home: 3655,
  Insert: 3666,
  Minus: 12,
  PageDown: 3665,
  PageUp: 3657,
  Period: 52,
  PrintScreen: 3639,
  Quote: 40,
  Semicolon: 39,
  Slash: 53,
  Space: 57,
  Tab: 15,
  ArrowDown: 57424,
  ArrowLeft: 57419,
  ArrowRight: 57421,
  ArrowUp: 57416,
  Numpad0: 82,
  Numpad1: 79,
  Numpad2: 80,
  Numpad3: 81,
  Numpad4: 75,
  Numpad5: 76,
  Numpad6: 77,
  Numpad7: 71,
  Numpad8: 72,
  Numpad9: 73,
  NumpadDecimal: 83,
  NumpadAdd: 78,
  NumpadSubtract: 74,
  NumpadMultiply: 55,
  NumpadDivide: 3637,
  NumLock: 69,
  ScrollLock: 70,
  "-": 12,
  "=": 13,
  "[": 26,
  "]": 27,
  "\\": 43,
  ";": 39,
  "'": 40,
  ",": 51,
  ".": 52,
  "/": 53,
  "`": 41,
};

for (const [index, keycode] of [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88, 91, 92, 93, 99, 100, 101, 102, 103, 104, 105, 106, 107].entries()) {
  KEY_CODES[`F${index + 1}`] = keycode;
}

for (let index = 0; index < 10; index += 1) {
  KEY_CODES[String(index)] = index === 0 ? 11 : index + 1;
}

for (const [letter, keycode] of Object.entries({
  A: 30, B: 48, C: 46, D: 32, E: 18, F: 33, G: 34, H: 35, I: 23, J: 36, K: 37, L: 38,
  M: 50, N: 49, O: 24, P: 25, Q: 16, R: 19, S: 31, T: 20, U: 22, V: 47, W: 17, X: 45,
  Y: 21, Z: 44,
})) KEY_CODES[letter] = keycode;

const NAMED_KEY_ALIASES: Readonly<Record<string, string>> = {
  plus: "Equal",
  space: "Space",
  tab: "Tab",
  capslock: "CapsLock",
  numlock: "NumLock",
  scrolllock: "ScrollLock",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  return: "Enter",
  enter: "Enter",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  escape: "Escape",
  esc: "Escape",
  printscreen: "PrintScreen",
  num0: "Numpad0",
  num1: "Numpad1",
  num2: "Numpad2",
  num3: "Numpad3",
  num4: "Numpad4",
  num5: "Numpad5",
  num6: "Numpad6",
  num7: "Numpad7",
  num8: "Numpad8",
  num9: "Numpad9",
  numdec: "NumpadDecimal",
  numadd: "NumpadAdd",
  numsub: "NumpadSubtract",
  nummult: "NumpadMultiply",
  numdiv: "NumpadDivide",
};

/** Map the key portion of Electron's accelerator grammar to uiohook's stable key codes. */
export function keyCodeForElectronKey(key: string): number | null {
  const trimmed = key.trim();
  const canonical = NAMED_KEY_ALIASES[trimmed.toLowerCase()] ?? trimmed;
  return KEY_CODES[canonical] ?? KEY_CODES[canonical.toUpperCase()] ?? null;
}
