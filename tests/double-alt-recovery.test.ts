import { describe, expect, it } from "vitest";
import { DoubleAltDetector, LEFT_ALT_KEYCODE, RIGHT_ALT_KEYCODE } from "../src/main/double-alt";

/**
 * P2-02 requires that the double-Alt gesture survives "锁屏／休眠恢复无卡键" — locking the screen or
 * sleeping with a key held must not leave the detector wedged. There is no reference counterpart (the
 * reference project has no global shortcut and no double-Alt gesture), so this is pi-orb's own
 * requirement and pi-orb's own failure mode.
 *
 * The mechanism to guard: the detector tracks `#leftDown`/`#rightDown` from key events, and a held key
 * that is never released — because the machine locked, or slept, or the hook was unloaded — leaves
 * those flags set with no keyup coming. Every later gesture then starts from a false "already down"
 * and is discarded at the guard, so the shortcut silently stops working.
 */

function harness() {
  const listeners = new Map<string, ((event: { keycode: number; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void)[]>();
  const hook = {
    on(event: "keydown" | "keyup", listener: (event: { keycode: number }) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener as never]);
    },
    removeListener(event: "keydown" | "keyup", listener: (event: { keycode: number }) => void) {
      listeners.set(event, (listeners.get(event) ?? []).filter((entry) => entry !== (listener as never)));
    },
  };
  let now = 0;
  const triggers: number[] = [];
  const detector = new DoubleAltDetector(hook, () => triggers.push(now), { now: () => now });
  const emit = (event: "keydown" | "keyup", input: { keycode: number; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => {
    for (const listener of listeners.get(event) ?? []) listener(input);
  };
  return { detector, emit, triggers, advance: (ms: number) => { now += ms; }, listenerCount: () => (listeners.get("keydown")?.length ?? 0) + (listeners.get("keyup")?.length ?? 0) };
}

describe("double-Alt survives a lock or sleep with a key held", () => {
  it("still fires after a keyup was lost while the machine was locked", () => {
    // The user holds Left Alt, the machine locks and the hook never sees the release.
    const { detector, emit, triggers } = harness();
    detector.start();
    emit("keydown", { keycode: LEFT_ALT_KEYCODE });

    // Time passes (lock, then unlock). No keyup was delivered.
    detector.recoverFromLostKeyUp();

    // After unlocking, the user performs the gesture normally.
    emit("keydown", { keycode: LEFT_ALT_KEYCODE });
    emit("keydown", { keycode: RIGHT_ALT_KEYCODE });
    expect(triggers.length).toBe(1);
  });

  it("does not treat a stale held key as already down", () => {
    // The same failure seen from the guard: with `#leftDown` stuck true, the next real Left Alt press
    // is discarded as a repeat, so the pair never forms and the gesture is dead.
    const { detector, emit, triggers, advance } = harness();
    detector.start();
    emit("keydown", { keycode: RIGHT_ALT_KEYCODE });
    detector.recoverFromLostKeyUp();
    advance(1000);

    emit("keydown", { keycode: LEFT_ALT_KEYCODE });
    emit("keydown", { keycode: RIGHT_ALT_KEYCODE });
    expect(triggers.length, "the pair after recovery must trigger").toBe(1);
  });

  it("allows the same pair again after a lock instead of staying latched", () => {
    // `#triggered` also has to clear, or the gesture works exactly once per lock cycle.
    const { detector, emit, triggers, advance } = harness();
    detector.start();
    emit("keydown", { keycode: LEFT_ALT_KEYCODE });
    emit("keydown", { keycode: RIGHT_ALT_KEYCODE });
    expect(triggers.length).toBe(1);
    emit("keyup", { keycode: LEFT_ALT_KEYCODE });
    emit("keyup", { keycode: RIGHT_ALT_KEYCODE });

    // Lock and unlock without any further events, then gesture again.
    detector.recoverFromLostKeyUp();
    advance(5000);
    emit("keydown", { keycode: LEFT_ALT_KEYCODE });
    emit("keydown", { keycode: RIGHT_ALT_KEYCODE });
    expect(triggers.length).toBe(2);
  });

  it("forgets a pending half-press across a lock so a stale half cannot complete later", () => {
    // A half-gesture (one Alt pressed) must not be completable minutes later across a lock; the gap
    // rule measures from the first press, and recovery has to drop that timestamp.
    const { detector, emit, triggers, advance } = harness();
    detector.start();
    emit("keydown", { keycode: LEFT_ALT_KEYCODE });
    detector.recoverFromLostKeyUp();
    advance(60_000);
    emit("keydown", { keycode: RIGHT_ALT_KEYCODE });
    expect(triggers.length, "a stale half-press must not complete after a lock").toBe(0);
  });

  it("recovers even when reset is not called, using the elapsed-time guard", () => {
    // The hook cannot always know a lock happened, so the gap rule is the backstop: a press whose
    // partner arrives long afterwards must not fire.
    const { detector, emit, triggers, advance } = harness();
    detector.start();
    emit("keydown", { keycode: LEFT_ALT_KEYCODE });
    advance(600_000);
    emit("keydown", { keycode: RIGHT_ALT_KEYCODE });
    expect(triggers.length).toBe(0);
  });

  it("detaches both listeners on stop so an unloaded hook cannot fire", () => {
    const { detector, emit, triggers, listenerCount } = harness();
    detector.start();
    expect(listenerCount()).toBe(2);
    detector.stop();
    expect(listenerCount()).toBe(0);
    emit("keydown", { keycode: LEFT_ALT_KEYCODE });
    emit("keydown", { keycode: RIGHT_ALT_KEYCODE });
    expect(triggers.length).toBe(0);
  });
});
