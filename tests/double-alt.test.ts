import { describe, expect, it, vi } from "vitest";
import {
  DoubleAltDetector,
  LEFT_ALT_KEYCODE,
  RIGHT_ALT_KEYCODE,
  type DoubleAltKeyboardEvent,
} from "../src/main/double-alt";

function hook() {
  const listeners = {
    keydown: [] as ((event: DoubleAltKeyboardEvent) => void)[],
    keyup: [] as ((event: DoubleAltKeyboardEvent) => void)[],
  };
  return {
    listeners,
    on(event: "keydown" | "keyup", listener: (input: DoubleAltKeyboardEvent) => void) { listeners[event].push(listener); },
    removeListener(event: "keydown" | "keyup", listener: (input: DoubleAltKeyboardEvent) => void) {
      listeners[event] = listeners[event].filter((candidate) => candidate !== listener);
    },
    emit(event: "keydown" | "keyup", input: DoubleAltKeyboardEvent) { for (const listener of listeners[event]) listener(input); },
  };
}

describe("DoubleAltDetector", () => {
  it("fires once when left and right Alt are pressed in either order", () => {
    const input = hook();
    const trigger = vi.fn();
    const detector = new DoubleAltDetector(input, trigger);
    detector.start();
    input.emit("keydown", { keycode: LEFT_ALT_KEYCODE });
    input.emit("keydown", { keycode: RIGHT_ALT_KEYCODE });
    input.emit("keydown", { keycode: RIGHT_ALT_KEYCODE });
    expect(trigger).toHaveBeenCalledTimes(1);
  });

  it("requires a fresh pair after both Alt keys are released", () => {
    const input = hook();
    const trigger = vi.fn();
    const detector = new DoubleAltDetector(input, trigger);
    detector.start();
    input.emit("keydown", { keycode: RIGHT_ALT_KEYCODE });
    input.emit("keydown", { keycode: LEFT_ALT_KEYCODE });
    input.emit("keyup", { keycode: LEFT_ALT_KEYCODE });
    input.emit("keyup", { keycode: RIGHT_ALT_KEYCODE });
    input.emit("keydown", { keycode: LEFT_ALT_KEYCODE });
    input.emit("keydown", { keycode: RIGHT_ALT_KEYCODE });
    expect(trigger).toHaveBeenCalledTimes(2);
  });

  it("rejects slow pairs and AltGr-like modifier chords", () => {
    const input = hook();
    const trigger = vi.fn();
    let now = 0;
    const detector = new DoubleAltDetector(input, trigger, { gapMs: 100, now: () => now });
    detector.start();
    input.emit("keydown", { keycode: LEFT_ALT_KEYCODE });
    now = 101;
    input.emit("keydown", { keycode: RIGHT_ALT_KEYCODE });
    input.emit("keyup", { keycode: LEFT_ALT_KEYCODE });
    input.emit("keyup", { keycode: RIGHT_ALT_KEYCODE });
    input.emit("keydown", { keycode: LEFT_ALT_KEYCODE });
    input.emit("keydown", { keycode: RIGHT_ALT_KEYCODE, ctrlKey: true });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("detaches listeners on stop", () => {
    const input = hook();
    const trigger = vi.fn();
    const detector = new DoubleAltDetector(input, trigger);
    detector.start();
    detector.stop();
    input.emit("keydown", { keycode: LEFT_ALT_KEYCODE });
    input.emit("keydown", { keycode: RIGHT_ALT_KEYCODE });
    expect(trigger).not.toHaveBeenCalled();
  });
});
