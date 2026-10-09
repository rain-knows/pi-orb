/**
 * Global shortcut registration with diagnostics.
 *
 * Electron's `globalShortcut.register` returns `false` when another application
 * already owns the accelerator; it does not throw. A silent failure would leave
 * the orb unreachable, so every attempt returns a structured result the shell can
 * surface (see doc/product-contract.md P1-03: "注册失败可诊断").
 */

import { validateAccelerator } from "../shared/accelerator";

export interface ShortcutRegistration {
  /**
   * The accelerator actually handed to the OS, in canonical form.
   *
   * Callers should persist this rather than the raw input, so the stored value is
   * exactly what is registered.
   */
  readonly accelerator: string;
  readonly registered: boolean;
  /** Populated only when `registered` is false. */
  readonly reason: string | null;
}

export interface GlobalShortcutLike {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  unregisterAll(): void;
  isRegistered(accelerator: string): boolean;
}

export class ShortcutRegistry {
  readonly #shortcuts: GlobalShortcutLike;
  #current: ShortcutRegistration | null = null;

  constructor(shortcuts: GlobalShortcutLike) {
    this.#shortcuts = shortcuts;
  }

  get current(): ShortcutRegistration | null {
    return this.#current;
  }

  /**
   * Register the wake accelerator, replacing any previous one.
   *
   * Order matters: the old accelerator is released before the new one is
   * attempted, so re-registering the same accelerator cannot fail against
   * itself.
   *
   * The accelerator is shape-checked first. Electron returns `false` both for a
   * malformed accelerator and for one another application owns, so without this
   * check the user would be told the wrong problem.
   */
  apply(accelerator: string, onTrigger: () => void): ShortcutRegistration {
    this.release();

    const validation = validateAccelerator(accelerator);
    if (!validation.ok) {
      this.#current = {
        accelerator,
        registered: false,
        reason: validation.message,
      };
      return this.#current;
    }

    let registered = false;
    let reason: string | null = null;
    const canonical = validation.normalized ?? accelerator;
    try {
      registered = this.#shortcuts.register(canonical, onTrigger);
    } catch (error) {
      registered = false;
      reason = `The shortcut was rejected by the operating system: ${(error as Error).message}`;
    }

    if (!registered && reason === null) {
      reason =
        "Another application already owns this shortcut. Choose a different one.";
    }

    this.#current = { accelerator: canonical, registered, reason: registered ? null : reason };
    return this.#current;
  }

  /** Release the current accelerator. Safe to call repeatedly. */
  release(): void {
    if (!this.#current) return;
    if (this.#current.registered) {
      this.#shortcuts.unregister(this.#current.accelerator);
    }
    this.#current = null;
  }

  /**
   * Release every accelerator this process registered.
   *
   * Used on quit. `unregisterAll` is the documented cleanup for an application
   * shutdown path and also covers a registration this object lost track of.
   */
  releaseAll(): void {
    this.#current = null;
    this.#shortcuts.unregisterAll();
  }
}
