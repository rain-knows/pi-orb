import { describe, expect, it } from "vitest";
import {
  FLOATING_BALL_SIZE,
  FLOATING_DOCK_HIT_HEIGHT,
  FLOATING_DOCK_HIT_WIDTH,
  FLOATING_PANEL_WINDOW_SIZE,
  ballOriginFromWindow,
  clampedBallOrigin,
  collapsedWindowBounds,
  dockSideForBallOrigin,
  dockedTabBounds,
  expandDirection,
  expandedOverlayBounds,
} from "../src/main/floating-geometry";

const display = { x: 0, y: 0, width: 1920, height: 1040 };

describe("reference floating orb geometry", () => {
  it("uses the reference 72px ball and 320x420 panel contract", () => {
    expect(FLOATING_BALL_SIZE).toBe(72);
    expect(FLOATING_PANEL_WINDOW_SIZE).toEqual({ width: 344, height: 444 });
    expect(collapsedWindowBounds({ x: 100, y: 200 })).toEqual({ x: 88, y: 188, width: 96, height: 96 });
  });

  it("chooses growth away from the nearest display edge", () => {
    expect(expandDirection({ x: 40, y: 120 }, display)).toEqual({ horizontal: "right", vertical: "down" });
    expect(expandDirection({ x: 1800, y: 800 }, display)).toEqual({ horizontal: "left", vertical: "up" });
  });

  it("keeps the expanded panel in the work area while preserving the ball corner", () => {
    const expanded = expandedOverlayBounds({ x: 1800, y: 800 }, display);
    expect(expanded.width).toBe(344);
    expect(expanded.height).toBe(444);
    expect(expanded.x).toBeGreaterThanOrEqual(-12);
    expect(expanded.y).toBeGreaterThanOrEqual(-12);
    expect(ballOriginFromWindow(expanded, expanded)).toEqual({ x: 1800, y: 800 });
  });

  it("docks on edge contact with the upstream three-DIP tolerance", () => {
    expect(dockSideForBallOrigin({ x: 0, y: 100 }, display)).toBe("left");
    expect(dockSideForBallOrigin({ x: 4, y: 100 }, display)).toBeUndefined();
    expect(dockSideForBallOrigin({ x: -20, y: 100 }, display)).toBe("left");
    expect(dockSideForBallOrigin({ x: 1870, y: 100 }, display)).toBe("right");
  });

  it("clamps the dock tab to the display and keeps its reference hit size", () => {
    const tab = dockedTabBounds("right", -100, display);
    expect(tab).toEqual({ x: 1886, y: 0, width: FLOATING_DOCK_HIT_WIDTH, height: FLOATING_DOCK_HIT_HEIGHT });
    expect(tab.width).toBe(34);
    expect(tab.height).toBe(88);
    expect(clampedBallOrigin({ x: -500, y: 2000 }, display)).toEqual({ x: 0, y: 968 });
  });
});
