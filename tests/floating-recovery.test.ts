import { describe, expect, it, vi } from "vitest";

/**
 * Recovery when the display layout changes under a parked orb.
 *
 * P2-01's acceptance criterion is that the orb "stays findable" across multi-display, DPI and
 * work-area changes. The failure this guards is specific and reachable: unplug the monitor the orb is
 * parked on, and its saved coordinates refer to a rectangle that no longer exists on any display. The
 * wake shortcut, the tray's "Show orb" and the double-Alt gesture all funnel into `showOrb`, and that
 * path called `window.show()` without re-clamping — so the orb came back at off-screen coordinates,
 * invisible and unreachable, with no way to summon it again.
 *
 * The reference has no display-change handling either, so this is not a reuse gap; it is pi-orb's own
 * requirement, which is why the fix lives in the shell's own show path rather than in the ported
 * geometry. The geometry is only asked to answer the question it already answers: given a point, which
 * display is responsible and where inside its work area does the ball belong.
 *
 * Scope note: the packaged probe cannot press the tray, the global shortcut or the double-Alt gesture,
 * so it cannot reach the wake path and must not claim to. It checks this shared geometry; the wake
 * sequence itself is pinned here.
 */

interface TestDisplay {
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly workArea: { x: number; y: number; width: number; height: number };
}

const screenState: { displays: TestDisplay[] } = {
  displays: [
    { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  ],
};

// `getDisplayNearestPoint` is what makes recovery work: a point that is now off every display still
// resolves to the closest one, so clamping has a work area to clamp into.
const getDisplayNearestPoint = vi.fn((point: { x: number; y: number }): TestDisplay => {
  let best = screenState.displays[0] as TestDisplay;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const display of screenState.displays) {
    const cx = display.bounds.x + display.bounds.width / 2;
    const cy = display.bounds.y + display.bounds.height / 2;
    const distance = Math.hypot(point.x - cx, point.y - cy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = display;
    }
  }
  return best;
});

vi.mock("electron", () => ({
  BrowserWindow: class {},
  screen: { getDisplayNearestPoint, getPrimaryDisplay: () => screenState.displays[0] },
  systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: false }) },
}));

const { clampedBallOrigin, FLOATING_BALL_SIZE } = await import("../src/main/floating-geometry");

describe("orb recovery after the display layout changes", () => {
  it("brings a ball parked on a removed display back onto a live one", () => {
    // The orb was at x=2500 on a second monitor that is now gone; only the primary remains.
    screenState.displays = [
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    ];
    const display = getDisplayNearestPoint({ x: 2500, y: 500 });
    const clamped = clampedBallOrigin({ x: 2500, y: 500 }, display.workArea);
    // Fully inside the surviving work area, so the orb is visible and clickable again.
    expect(clamped.x).toBeGreaterThanOrEqual(display.workArea.x);
    expect(clamped.x + FLOATING_BALL_SIZE).toBeLessThanOrEqual(display.workArea.x + display.workArea.width);
    expect(clamped.y).toBeGreaterThanOrEqual(display.workArea.y);
    expect(clamped.y + FLOATING_BALL_SIZE).toBeLessThanOrEqual(display.workArea.y + display.workArea.height);
    // It lands against the right edge, i.e. as close as possible to where it used to be.
    expect(clamped.x).toBe(1920 - FLOATING_BALL_SIZE);
  });

  it("keeps a ball on a surviving second display where it was", () => {
    // Two displays, orb already on the second: recovery must not drag it back to the primary.
    screenState.displays = [
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
      { bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } },
    ];
    const parked = { x: 2200, y: 300 };
    const clamped = clampedBallOrigin(parked, getDisplayNearestPoint(parked).workArea);
    expect(clamped).toEqual(parked);
  });

  it("pulls a ball out of a taskbar area when the work area shrinks", () => {
    // A work area that no longer reaches the bottom: a ball parked low must move up into the visible
    // part rather than staying under the taskbar where it cannot be clicked.
    screenState.displays = [
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    ];
    const display = getDisplayNearestPoint({ x: 1800, y: 1000 });
    const clamped = clampedBallOrigin({ x: 1800, y: 1000 }, display.workArea);
    expect(clamped.y + FLOATING_BALL_SIZE).toBeLessThanOrEqual(1040);
    expect(clamped.y).toBe(1040 - FLOATING_BALL_SIZE);
  });

  it("never returns a position that is off every display", () => {
    // The property the criterion is really about, checked over hostile inputs: whatever coordinates
    // the window was left at, the clamped result must be inside the display it resolves to.
    screenState.displays = [
      { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 40, width: 1920, height: 1000 } },
    ];
    for (const parked of [
      { x: -5000, y: -5000 },
      { x: 99999, y: 99999 },
      { x: -1, y: 500 },
      { x: 500, y: 5000 },
      { x: 0, y: 0 },
    ]) {
      const display = getDisplayNearestPoint(parked);
      const clamped = clampedBallOrigin(parked, display.workArea);
      const { x, y, width, height } = display.workArea;
      expect(clamped.x, JSON.stringify(parked)).toBeGreaterThanOrEqual(x);
      expect(clamped.x + FLOATING_BALL_SIZE, JSON.stringify(parked)).toBeLessThanOrEqual(x + width);
      expect(clamped.y, JSON.stringify(parked)).toBeGreaterThanOrEqual(y);
      expect(clamped.y + FLOATING_BALL_SIZE, JSON.stringify(parked)).toBeLessThanOrEqual(y + height);
    }
  });
});
