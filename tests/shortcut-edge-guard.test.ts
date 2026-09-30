import { describe, expect, it } from "vitest";
import {
  ShortcutEdgeGuard,
  keyCodeForElectronKey,
  type KeyboardHookEvent,
  type KeyboardHookLike,
} from "../src/main/shortcut-edge-guard";

function fakeHook() {
  const listeners = {
    keydown: [] as Array<(event: KeyboardHookEvent) => void>,
    keyup: [] as Array<(event: KeyboardHookEvent) => void>,
  };
  const hook: KeyboardHookLike & {
    started: number;
    stopped: number;
    emit(event: "keydown" | "keyup", keycode: number): void;
  } = {
    started: 0,
    stopped: 0,
    on(event, listener) {
      listeners[event].push(listener);
    },
    removeListener(event, listener) {
      const index = listeners[event].indexOf(listener);
      if (index >= 0) listeners[event].splice(index, 1);
    },
    start() {
      hook.started += 1;
    },
    stop() {
      hook.stopped += 1;
    },
    emit(event, keycode) {
      for (const listener of listeners[event]) listener({ keycode });
    },
  };
  return hook;
}

describe("ShortcutEdgeGuard", () => {
  it("allows one global shortcut callback until the primary key is released", () => {
    const hook = fakeHook();
    const guard = new ShortcutEdgeGuard(hook);
    guard.configure("Control+Alt+F9");
    expect(guard.start()).toBe(true);

    expect(guard.accept()).toBe(true);
    expect(guard.accept()).toBe(false);
    hook.emit("keyup", 67);
    expect(guard.accept()).toBe(true);
  });

  it("does not clear the latch for an unrelated key release", () => {
    const hook = fakeHook();
    const guard = new ShortcutEdgeGuard(hook);
    guard.configure("Control+Shift+Space");
    guard.start();

    expect(guard.accept()).toBe(true);
    hook.emit("keyup", keyCodeForElectronKey("A")!);
    expect(guard.accept()).toBe(false);
  });

  it("releases a hold whose key-up was lost across a lock or sleep", () => {
    const hook = fakeHook();
    const guard = new ShortcutEdgeGuard(hook);
    guard.configure("Control+Alt+F9");
    guard.start();
    expect(guard.accept()).toBe(true);
    expect(guard.accept()).toBe(false);

    guard.releaseLatchedHold();
    expect(guard.accept()).toBe(true);
    expect(guard.accept()).toBe(false);
  });

  it("resets the edge when the registered accelerator changes", () => {
    const hook = fakeHook();
    const guard = new ShortcutEdgeGuard(hook);
    guard.configure("Control+Alt+F9");
    guard.start();
    expect(guard.accept()).toBe(true);

    guard.configure("Control+Alt+F10");
    expect(guard.accept()).toBe(true);
    hook.emit("keyup", 67);
    expect(guard.accept()).toBe(false);
    hook.emit("keyup", 68);
    expect(guard.accept()).toBe(true);
  });

  it("stops the native hook cleanly", () => {
    const hook = fakeHook();
    const guard = new ShortcutEdgeGuard(hook);
    guard.configure("Control+Shift+Space");
    guard.start();
    guard.stop();
    expect(hook.started).toBe(1);
    expect(hook.stopped).toBe(1);
    expect(guard.enabled).toBe(false);
  });

  it("reports an unavailable hook instead of pretending edge protection is active", () => {
    const hook = fakeHook();
    hook.start = () => {
      throw new Error("hook denied");
    };
    const guard = new ShortcutEdgeGuard(hook);
    guard.configure("Control+Shift+Space");
    expect(guard.start()).toBe(false);
    expect(guard.error).toContain("hook denied");
    // The missing protection fails closed rather than silently claiming that a long hold is handled.
    expect(guard.accept()).toBe(false);
  });

  it.each([
    ["A", 30],
    ["0", 11],
    ["F16", 99],
    ["Space", 57],
    ["Plus", 13],
    ["-", 12],
    ["Left", 57419],
  ])("maps Electron key %s to the hook keycode", (key, expected) => {
    expect(keyCodeForElectronKey(key)).toBe(expected);
  });
});
