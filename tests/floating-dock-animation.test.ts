import { describe, expect, it } from "vitest";
import {
  FLOATING_DOCK_SLIDE_IN_MS,
  FLOATING_DOCK_SLIDE_OFF_MS,
  FLOATING_DOCK_TAB_FILL,
  easeInOutCubic,
  easeOutCubic,
  lerpRect,
} from "../src/main/floating-geometry";

/**
 * The dock gesture slides the window off the screen edge and back, ported from the reference's
 * `animateOverlayBounds` (deepseek-harness-orb commit 72f1d73, `apps/desktop/src/floating-window.ts`).
 * pi-orb previously snapped with a bare `setBounds`, which made the gesture read as a jump.
 *
 * The animation itself runs on real timers against a real BrowserWindow, so what is unit-testable
 * here is the contract it is built from: the reference durations, the two easing curves at their
 * boundaries, and the rect interpolation. The end-to-end slide is covered by the dock lifecycle
 * probe, which observes the window's bounds over time.
 */

describe("ported dock slide contract", () => {
  it("uses the reference slide durations", () => {
    // The reference's own constants; changing them changes the gesture's feel, not a detail.
    expect(FLOATING_DOCK_SLIDE_OFF_MS).toBe(250);
    expect(FLOATING_DOCK_SLIDE_IN_MS).toBe(300);
  });

  it("keeps the reference dock-tab fill", () => {
    // The reference matches its CoView scrollbar palette; the CSS paints the same value.
    expect(FLOATING_DOCK_TAB_FILL.toLowerCase()).toBe("#75757f");
  });

  it("eases in-out for the slide off and out for the slide in", () => {
    // Both curves must start at 0 and end at 1, or the window would jump at the seam.
    for (const ease of [easeInOutCubic, easeOutCubic]) {
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
    }
    // Cubic in-out is symmetric about the midpoint; cubic-out is ahead of linear throughout.
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
    for (const t of [0.25, 0.5, 0.75]) expect(easeOutCubic(t)).toBeGreaterThan(t);
    // In-out is slower at the start than linear, which is what makes it read as a slide.
    for (const t of [0.1, 0.2]) expect(easeInOutCubic(t)).toBeLessThan(t);
  });

  it("interpolates rects edge by edge, rounding like the reference", () => {
    const start = { x: 0, y: 0, width: 96, height: 96 };
    const end = { x: -100, y: 40, width: 96, height: 96 };
    expect(lerpRect(start, end, 0)).toEqual(start);
    expect(lerpRect(start, end, 1)).toEqual(end);
    const middle = lerpRect(start, end, 0.5);
    expect(middle).toEqual({ x: -50, y: 20, width: 96, height: 96 });
    // Every edge is an integer, so the window never lands on a half-pixel mid-slide.
    for (const t of [0.13, 0.37, 0.61, 0.89]) {
      const frame = lerpRect({ x: 0, y: 0, width: 96, height: 96 }, { x: -101, y: 41, width: 90, height: 91 }, t);
      for (const value of Object.values(frame)) expect(Number.isInteger(value)).toBe(true);
    }
  });
});
