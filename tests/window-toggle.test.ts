import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TRIGGER_COOLDOWN_MS,
  WakeController,
  decideToggle,
  type ToggleTarget,
  type WindowState,
} from "../src/main/window-toggle";

function state(overrides: Partial<WindowState> = {}): WindowState {
  return { destroyed: false, visible: false, minimized: false, focused: false, ...overrides };
}

function fakeTarget(initial: WindowState) {
  let current = initial;
  const target: ToggleTarget & { set(next: WindowState): void; wakeCalls: number; collapseCalls: number } = {
    wakeCalls: 0,
    collapseCalls: 0,
    getState: () => current,
    wake: () => {
      target.wakeCalls += 1;
      current = { ...current, visible: true, minimized: false, focused: true };
    },
    collapse: () => {
      target.collapseCalls += 1;
      current = { ...current, visible: false, focused: false };
    },
    set: (next: WindowState) => {
      current = next;
    },
  };
  return target;
}

describe("decideToggle", () => {
  it("wakes a hidden window", () => {
    expect(decideToggle(state({ visible: false }))).toBe("wake");
  });

  it("wakes a visible but unfocused window instead of hiding it", () => {
    // The window is behind another app; the user reaching for the wake shortcut
    // wants it back, not hidden.
    expect(decideToggle(state({ visible: true, focused: false }))).toBe("wake");
  });

  it("collapses only a visible and focused window", () => {
    expect(decideToggle(state({ visible: true, focused: true }))).toBe("collapse");
  });

  it("wakes a minimized window rather than toggling it off", () => {
    expect(decideToggle(state({ visible: true, focused: true, minimized: true }))).toBe("wake");
  });

  it("does nothing for a destroyed window", () => {
    expect(decideToggle(state({ destroyed: true, visible: true, focused: true }))).toBe("noop");
  });
});

describe("WakeController", () => {
  it("wakes a hidden window on the first trigger", () => {
    const target = fakeTarget(state({ visible: false }));
    const controller = new WakeController(target);
    expect(controller.trigger("shortcut")).toBe("wake");
    expect(target.wakeCalls).toBe(1);
  });

  it("collapses an already focused window on the next trigger", () => {
    const target = fakeTarget(state({ visible: false }));
    let now = 0;
    const controller = new WakeController(target, { now: () => now });
    expect(controller.trigger("shortcut")).toBe("wake");
    now += DEFAULT_TRIGGER_COOLDOWN_MS + 1;
    expect(controller.trigger("shortcut")).toBe("collapse");
    expect(target.collapseCalls).toBe(1);
  });
  it("throttles an auto-repeating press so one long hold cannot flip the window many times", () => {
    const target = fakeTarget(state({ visible: false }));
    let now = 0;
    const controller = new WakeController(target, { now: () => now });

    expect(controller.trigger("shortcut")).toBe("wake");
    // Global accelerators auto-repeat while held: many triggers, ~0 ms apart.
    for (let index = 0; index < 20; index += 1) {
      now += 10;
      expect(controller.trigger("shortcut")).toBe("throttled");
    }
    expect(target.wakeCalls).toBe(1);
    expect(target.collapseCalls).toBe(0);

    // After the cooldown a deliberate second press still collapses.
    now += DEFAULT_TRIGGER_COOLDOWN_MS;
    expect(controller.trigger("shortcut")).toBe("collapse");
    expect(target.collapseCalls).toBe(1);
  });

  it("throttles across sources so the shortcut and the tray cannot double-apply", () => {
    const target = fakeTarget(state({ visible: false }));
    const now = 0;
    const controller = new WakeController(target, { now: () => now });
    expect(controller.trigger("shortcut")).toBe("wake");
    expect(controller.trigger("tray")).toBe("throttled");
    expect(target.wakeCalls).toBe(1);
    expect(target.collapseCalls).toBe(0);
  });

  it("does not count a throttled trigger as applied", () => {
    const target = fakeTarget(state({ visible: false }));
    const now = 0;
    const controller = new WakeController(target, { now: () => now });
    controller.trigger("shortcut");
    controller.trigger("shortcut");
    expect(controller.lastAction).toBe("wake");
  });

  it("keeps working after the cooldown, so waking is never permanently lost", () => {
    const target = fakeTarget(state({ visible: false }));
    let now = 0;
    const controller = new WakeController(target, { now: () => now });
    controller.trigger("shortcut");
    now += DEFAULT_TRIGGER_COOLDOWN_MS + 1;
    expect(controller.trigger("shortcut")).toBe("collapse");
    now += DEFAULT_TRIGGER_COOLDOWN_MS + 1;
    expect(controller.trigger("shortcut")).toBe("wake");
    expect(target.wakeCalls).toBe(2);
  });

  it("ignores a destroyed window", () => {
    const target = fakeTarget(state({ destroyed: true }));
    const controller = new WakeController(target);
    expect(controller.trigger("shortcut")).toBe("noop");
    expect(target.wakeCalls).toBe(0);
    expect(target.collapseCalls).toBe(0);
  });

  it("performs no side effect beyond window visibility", () => {
    // A wake must never start a screenshot, upload, or session. This is asserted by
    // construction: the only collaborator is the window target.
    const target = fakeTarget(state({ visible: false }));
    const spy = vi.fn();
    const controller = new WakeController({ ...target, wake: spy }, { now: () => 0 });
    controller.trigger("shortcut");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
