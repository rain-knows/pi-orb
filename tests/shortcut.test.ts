import { describe, expect, it, vi } from "vitest";
import { ShortcutRegistry, type GlobalShortcutLike } from "../src/main/shortcut";

function fakeShortcuts(
  behavior: (accelerator: string) => boolean = () => true,
): GlobalShortcutLike & { registered: string[]; unregistered: string[]; allReleased: number } {
  const registered: string[] = [];
  const unregistered: string[] = [];
  const state = { allReleased: 0 };
  return {
    registered,
    unregistered,
    register(accelerator: string) {
      if (!behavior(accelerator)) return false;
      registered.push(accelerator);
      return true;
    },
    unregister(accelerator: string) {
      unregistered.push(accelerator);
    },
    unregisterAll() {
      state.allReleased += 1;
    },
    isRegistered(accelerator: string) {
      return registered.includes(accelerator);
    },
    get allReleased() {
      return state.allReleased;
    },
  };
}

describe("ShortcutRegistry", () => {
  it("reports a successful registration", () => {
    const shortcuts = fakeShortcuts();
    const registry = new ShortcutRegistry(shortcuts);
    const result = registry.apply("CommandOrControl+Shift+Space", () => {});
    expect(result.registered).toBe(true);
    expect(result.reason).toBeNull();
    expect(registry.current).toEqual(result);
  });

  it("reports a diagnosable reason when the accelerator is already owned", () => {
    const shortcuts = fakeShortcuts(() => false);
    const registry = new ShortcutRegistry(shortcuts);
    const result = registry.apply("CommandOrControl+Shift+Space", () => {});
    expect(result.registered).toBe(false);
    expect(result.reason).toContain("already owns");
  });

  it("reports a rejected accelerator rather than throwing", () => {
    // A shape-valid accelerator that the OS refuses: the message must name the OS
    // as the source, not "another application owns it".
    const shortcuts = fakeShortcuts(() => {
      throw new Error("Invalid accelerator");
    });
    const registry = new ShortcutRegistry(shortcuts);
    const result = registry.apply("Control+Alt+O", () => {});
    expect(result.registered).toBe(false);
    expect(result.reason).toContain("Invalid accelerator");
  });

  it("rejects a malformed accelerator before asking the OS", () => {
    const shortcuts = fakeShortcuts();
    const registry = new ShortcutRegistry(shortcuts);
    const result = registry.apply("NotAKey", () => {});
    expect(result.registered).toBe(false);
    expect(result.reason).toContain("not a recognized key");
    // Electron returns false both for a malformed accelerator and for a conflict, so
    // validation must happen first or the user is told the wrong problem.
    expect(shortcuts.registered).toEqual([]);
  });

  it("releases the previous accelerator before registering the new one", () => {
    const shortcuts = fakeShortcuts();
    const registry = new ShortcutRegistry(shortcuts);
    registry.apply("Control+Alt+O", () => {});
    registry.apply("Control+Alt+P", () => {});
    expect(shortcuts.unregistered).toEqual(["Control+Alt+O"]);
    expect(shortcuts.registered).toEqual(["Control+Alt+O", "Control+Alt+P"]);
  });

  it("re-registers the same accelerator without colliding with itself", () => {
    const shortcuts = fakeShortcuts();
    const registry = new ShortcutRegistry(shortcuts);
    registry.apply("Control+Alt+O", () => {});
    const second = registry.apply("Control+Alt+O", () => {});    expect(second.registered).toBe(true);
    expect(shortcuts.unregistered).toEqual(["Control+Alt+O"]);
  });

  it("treats a blank accelerator as unavailable without calling the OS", () => {
    const shortcuts = fakeShortcuts();
    const registry = new ShortcutRegistry(shortcuts);
    const result = registry.apply("  ", () => {});
    expect(result.registered).toBe(false);
    expect(shortcuts.registered).toEqual([]);
  });

  it("refuses a modifier-only accelerator so it is never silently a no-op", () => {
    const shortcuts = fakeShortcuts();
    const registry = new ShortcutRegistry(shortcuts);
    const result = registry.apply("Alt+Alt", () => {});
    expect(result.registered).toBe(false);
    expect(result.reason).toContain("needs a key");
    expect(shortcuts.registered).toEqual([]);
  });

  it("invokes the callback only through the registered accelerator", () => {
    let captured: (() => void) | null = null;
    const shortcuts: GlobalShortcutLike = {
      register(_accelerator, callback) {
        captured = callback;
        return true;
      },
      unregister: vi.fn(),
      unregisterAll: vi.fn(),
      isRegistered: () => true,
    };
    const onTrigger = vi.fn();
    new ShortcutRegistry(shortcuts).apply("Control+Alt+O", onTrigger);
    expect(captured).toBeTypeOf("function");
    expect(onTrigger).not.toHaveBeenCalled();
    captured!();
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("releases everything on exit", () => {
    const shortcuts = fakeShortcuts();
    const registry = new ShortcutRegistry(shortcuts);
    registry.apply("Control+Alt+O", () => {});
    registry.releaseAll();
    expect(shortcuts.allReleased).toBe(1);
    expect(registry.current).toBeNull();
  });
});
