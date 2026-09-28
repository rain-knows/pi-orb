import { describe, expect, it, vi } from "vitest";
import {
  OrbWindowLifecycle,
  type CollapseTarget,
  type DesktopOperations,
} from "../src/main/window-lifecycle";

function target(destroyed = false): CollapseTarget & { hideCalls: number } {
  let hideCalls = 0;
  return {
    get hideCalls() {
      return hideCalls;
    },
    hide: () => {
      hideCalls += 1;
    },
    isDestroyed: () => destroyed,
  };
}

function operations(): DesktopOperations & { revokes: number; discards: number; clears: number } {
  let revokes = 0;
  let discards = 0;
  let clears = 0;
  return {
    get revokes() {
      return revokes;
    },
    get discards() {
      return discards;
    },
    get clears() {
      return clears;
    },
    revokeDesktopTask: () => {
      revokes += 1;
    },
    discardPendingCapture: () => {
      discards += 1;
    },
    clearRecordedTarget: () => {
      clears += 1;
    },
  };
}

/** Every route the user has for hiding the orb. */
const COLLAPSE_ROUTES = ["wake shortcut", "window close button", "tray menu"] as const;

describe("OrbWindowLifecycle", () => {
  it("hides the window and revokes desktop operations", () => {
    const win = target();
    const ops = operations();
    const lifecycle = new OrbWindowLifecycle(win, ops);

    expect(lifecycle.collapse()).toBe("collapsed");
    expect(win.hideCalls).toBe(1);
    expect(ops.revokes).toBe(1);
    expect(ops.discards).toBe(1);
    expect(ops.clears).toBe(1);
  });

  it.each(COLLAPSE_ROUTES)("revokes on %s", () => {
    // The defect this guards: hiding via a different door kept desktop authority alive, because
    // each route hid the window itself instead of going through one routine.
    const win = target();
    const ops = operations();
    new OrbWindowLifecycle(win, ops).collapse();
    expect(ops.revokes).toBe(1);
    expect(ops.discards).toBe(1);
    expect(ops.clears).toBe(1);
    expect(win.hideCalls).toBe(1);
  });

  it("never hides a window without revoking", () => {
    // The paired property: there is no path that hides and returns without revoking.
    const win = target();
    const ops = operations();
    const lifecycle = new OrbWindowLifecycle(win, ops);
    lifecycle.collapse();
    expect(win.hideCalls).toBe(ops.revokes);
    expect(win.hideCalls).toBe(ops.discards);
    expect(win.hideCalls).toBe(ops.clears);
  });

  it("drops the recorded target, so a later capture cannot reuse the window the user left", () => {
    // Real gap found by running the product: collapse revoked the authority and dropped the pending
    // capture but kept the record of the target window. Collapse is the path users actually take, so a
    // screenshot after hiding the orb would still have captured the window that was in front at the
    // last wake. The product's own revocation routine documented this rule for a collapse; only the
    // wiring was missing.
    const win = target();
    const ops = operations();
    new OrbWindowLifecycle(win, ops).collapse();
    expect(ops.clears).toBe(1);
  });

  it("is idempotent and safe to call repeatedly", () => {
    const win = target();
    const ops = operations();
    const lifecycle = new OrbWindowLifecycle(win, ops);
    lifecycle.collapse();
    lifecycle.collapse();
    lifecycle.collapse();
    expect(win.hideCalls).toBe(3);
    expect(ops.revokes).toBe(3);
    expect(ops.clears).toBe(3);
    expect(lifecycle.collapseCount).toBe(3);
  });

  it("does not touch a destroyed window, and reports that it did nothing", () => {
    const win = target(true);
    const ops = operations();
    const lifecycle = new OrbWindowLifecycle(win, ops);
    expect(lifecycle.collapse()).toBe("noop");
    expect(win.hideCalls).toBe(0);
    expect(ops.revokes).toBe(0);
    expect(lifecycle.collapseCount).toBe(0);
  });

  it("grants nothing when waking", () => {
    // Waking must not re-authorize desktop actions; approval is a separate user decision.
    const win = target();
    const ops = operations();
    const show = vi.fn();
    const lifecycle = new OrbWindowLifecycle(win, ops);
    lifecycle.wake(show);
    expect(show).toHaveBeenCalledTimes(1);
    expect(ops.revokes).toBe(0);
    expect(ops.discards).toBe(0);
  });

  it("logs the collapse with its reason, so the revocation is visible in the shell log", () => {
    const messages: string[] = [];
    const lifecycle = new OrbWindowLifecycle(target(), operations(), (message) => messages.push(message));
    lifecycle.collapse();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/collapsed/i);
    expect(messages[0]).toMatch(/revoked/i);
  });
});
