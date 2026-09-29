/**
 * Accelerator validation.
 *
 * Electron's `globalShortcut.register` returns `false` for an accelerator it
 * cannot parse, which is indistinguishable from "another application owns it".
 * P1-03 requires a diagnosable failure, so the shape is checked before registering
 * and the caller gets a specific reason instead of a generic one.
 *
 * Rules follow Electron's accelerator grammar
 * (https://www.electronjs.org/docs/latest/api/accelerator):
 *  - zero or more modifiers, then exactly one key code;
 *  - the key code may be a letter, a digit, a function key, or a named key.
 */

const MODIFIERS = new Set([
  "command",
  "cmd",
  "control",
  "ctrl",
  "commandorcontrol",
  "cmdorctrl",
  "alt",
  "option",
  "altgr",
  "shift",
  "super",
  "meta",
]);

/**
 * Named keys Electron accepts. Only the names that are meaningful on the first
 * platform (Windows x64) plus the obvious cross-platform ones are listed; an
 * unknown name is reported rather than silently sent to the OS.
 */
const NAMED_KEYS = new Set([
  "plus", "space", "tab", "capslock", "numlock", "scrolllock", "backspace",
  "delete", "insert", "return", "enter", "up", "down", "left", "right", "home",
  "end", "pageup", "pagedown", "escape", "esc", "printscreen",
  "num0", "num1", "num2", "num3", "num4", "num5", "num6", "num7", "num8", "num9",
  "numdec", "numadd", "numsub", "nummult", "numdiv",
]);

export interface AcceleratorValidation {
  readonly ok: boolean;
  /** User-facing reason. Empty only when `ok` is true. */
  readonly message: string;
  /** Modifiers that were recognized, lower-cased. */
  readonly modifiers: readonly string[];
  /** The single key code, or `null` when the accelerator is invalid. */
  readonly key: string | null;
  /**
   * The canonical accelerator to hand to Electron.
   *
   * Validation must describe exactly what gets registered. Passing the raw input
   * while validating a cleaned-up form would let a value pass here and be refused
   * by the OS, which then reports it as a conflict with another application — a
   * misleading message for a malformed shortcut.
   */
  readonly normalized: string | null;
};

const INVALID = (message: string, modifiers: string[] = []): AcceleratorValidation => ({
  ok: false,
  message,
  modifiers,
  key: null,
  normalized: null,
});

/**
 * Validate an accelerator string.
 *
 * Deliberately rejects a modifier-only accelerator (for example `Alt+Alt` or just
 * `Control`): Electron's parser refuses those, and a user asking for "double Alt"
 * needs the separate listener work described in P2-02, not a silent no-op here.
 */
export function validateAccelerator(input: string | null | undefined): AcceleratorValidation {
  if (typeof input !== "string" || input.trim().length === 0) {
    return INVALID("Enter a shortcut, for example Ctrl+Alt+O.");
  }

  const parts = input.split("+").map((part) => part.trim());

  // A doubled separator is a typo, not an empty modifier. Accepting it would mean
  // validating a shortened form and registering the original, which the OS may
  // then refuse as a conflict.
  if (parts.some((part) => part.length === 0)) {
    return INVALID("The shortcut contains an empty part; check the "+" separators.");
  }

  if (parts.length === 0) {
    return INVALID("Enter a shortcut, for example Ctrl+Alt+O.");
  }

  const modifiers: string[] = [];
  const keys: string[] = [];

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (MODIFIERS.has(lower)) {
      modifiers.push(lower);
      continue;
    }
    if (isKeyCode(part)) {
      keys.push(part);
      continue;
    }
    return INVALID(`"${part}" is not a recognized key or modifier.`, modifiers);
  }

  if (keys.length === 0) {
    return INVALID(
      modifiers.length > 0
        ? "A shortcut needs a key, not only modifiers. Add a letter, digit, or named key."
        : "Enter a shortcut, for example Ctrl+Alt+O.",
      modifiers,
    );
  }

  if (keys.length > 1) {
    return INVALID(
      `A shortcut can only press one key at a time, but ${keys.length} were given: ${keys.join(", ")}.`,
      modifiers,
    );
  }

  return {
    ok: true,
    message: "",
    modifiers,
    key: keys[0] ?? null,
    // Canonical form = the trimmed parts rejoined with a single separator. Spelling
    // is preserved because Electron parses modifier names case-insensitively, so
    // rewriting the casing would only make the stored value differ from what the
    // user typed without being more correct.
    normalized: parts.join("+"),
  };
}

function isKeyCode(part: string): boolean {
  // A single letter or digit.
  if (/^[a-z0-9]$/i.test(part)) return true;
  const lower = part.toLowerCase();
  // F1–F24.
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return true;
  // Punctuation Electron accepts by literal symbol.
  if (["-", "=", "[", "]", "\\", ";", "'", ",", ".", "/", "`"].includes(part)) return true;
  return NAMED_KEYS.has(lower);
}
