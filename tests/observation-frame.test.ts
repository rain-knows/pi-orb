import { describe, expect, it, vi } from "vitest";

// `observation-frame` imports `electron` for `screen.screenToDipRect`. The geometry under test is
// pure, so the module is loaded with a stub whose platform we control, which is also how the DIP
// conversion branch gets exercised on Windows.
const screenStub = { screenToDipRect: vi.fn((_window: unknown, rect: unknown) => rect), getDisplayNearestPoint: vi.fn() };
vi.mock("electron", () => ({ BrowserWindow: class {}, screen: screenStub }));

const {
  OBSERVATION_FRAME_GLOW_PX,
  OBSERVATION_FRAME_OUTSET,
  OBSERVATION_FRAME_STROKE_PX,
  observationFrameCssScript,
  observationFramePadding,
  observationFramePlacement,
} = await import("../src/main/observation-frame");

/**
 * The observation ribbon, ported from `deepseek-harness-orb` commit 72f1d73,
 * `apps/desktop/src/observation-frame-window.ts`. It marks which window a desktop grant covers.
 *
 * What must be right is the *hole*: the ribbon's inner edge has to land exactly on the observed
 * rectangle, because a ribbon that is a few pixels off points at pixels the actions do not use. The
 * reference computes that as the window bounds inflated by stroke + glow, then subtracts the actual
 * per-edge insets, which is what these tests pin.
 */

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

function holeOf(placement: { bounds: { x: number; y: number; width: number; height: number }; glow: { top: number; right: number; bottom: number; left: number }; stroke: { top: number; right: number; bottom: number; left: number } }) {
  // The hole is the content box inset by the body glow and then by the stroke padding.
  const left = placement.bounds.x + placement.glow.left + placement.stroke.left;
  const top = placement.bounds.y + placement.glow.top + placement.stroke.top;
  const right = placement.bounds.x + placement.bounds.width - placement.glow.right - placement.stroke.right;
  const bottom = placement.bounds.y + placement.bounds.height - placement.glow.bottom - placement.stroke.bottom;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

describe("ported observation frame", () => {
  it("uses the reference stroke, glow and outset", () => {
    expect(OBSERVATION_FRAME_STROKE_PX).toBe(8);
    expect(OBSERVATION_FRAME_GLOW_PX).toBe(28);
    expect(OBSERVATION_FRAME_OUTSET).toBe(36);
  });

  it("places the hole exactly on the observed rectangle", () => {
    // The property that matters: whatever the padding does, the inner edge must equal the region.
    const region = { x: 400, y: 300, width: 640, height: 480 };
    const placement = observationFramePlacement(region, workArea);
    expect(holeOf(placement)).toEqual(region);
    // And the window is inflated by the outset on every side, so the glow is not clipped.
    expect(placement.bounds).toEqual({ x: 364, y: 264, width: 712, height: 552 });
  });

  it("keeps the hole on the region when a work-area edge clips the window", () => {
    // A region flush against the left edge cannot be inflated past it. The reference's rule for that
    // case is documented on `observationFramePadding`: "a flush edge (no leftover outset) uses the
    // stroke just inside that edge". So the glow collapses to 0 and the 8px stroke is drawn *inside*
    // the region rather than outside it, which is deliberate — the alternative would push the ribbon
    // off-screen and lose the mark entirely.
    const region = { x: 0, y: 100, width: 400, height: 300 };
    const placement = observationFramePlacement(region, workArea);
    expect(placement.bounds.x).toBe(0);
    expect(placement.glow.left).toBe(0);
    const hole = holeOf(placement);
    expect(hole.y).toBe(region.y);
    expect(hole.height).toBe(region.height);
    // The clipped edge carries the stroke inside; the unclipped right edge keeps the hole flush with
    // the region, so only the left side of the hole is inset.
    expect(hole.x).toBe(region.x + OBSERVATION_FRAME_STROKE_PX);
    expect(hole.x + hole.width).toBe(region.x + region.width);

    // At the far edge the same rule applies on the right and bottom.
    const far = { x: 1620, y: 840, width: 300, height: 200 };
    const farPlacement = observationFramePlacement(far, workArea);
    expect(farPlacement.bounds.x + farPlacement.bounds.width).toBe(1920);
    expect(farPlacement.bounds.y + farPlacement.bounds.height).toBe(1040);
    expect(farPlacement.glow.right).toBe(0);
    expect(farPlacement.glow.bottom).toBe(0);
    const farHole = holeOf(farPlacement);
    expect(farHole.x).toBe(far.x);
    expect(farHole.y).toBe(far.y);
    expect(farHole.width).toBe(far.width - OBSERVATION_FRAME_STROKE_PX);
    expect(farHole.height).toBe(far.height - OBSERVATION_FRAME_STROKE_PX);
  });

  it("clips the window to the work area without translating it", () => {
    // A region partly off-screen: intersecting must shrink the window, not slide it back on-screen,
    // because a translated ribbon would point at the wrong pixels.
    const region = { x: -200, y: -100, width: 500, height: 400 };
    const placement = observationFramePlacement(region, workArea);
    expect(placement.bounds.x).toBe(0);
    expect(placement.bounds.y).toBe(0);
    // It keeps full size only in the directions that were not clipped.
    expect(placement.bounds.width).toBe(336);
    expect(placement.bounds.height).toBe(336);
  });

  it("splits the inset into glow and stroke, never negative", () => {
    // `edgePadding` reserves the stroke first and gives the remainder to the glow; a negative inset
    // (the window sits inside the region) must not produce a negative padding.
    const padding = observationFramePadding({ x: 100, y: 100, width: 200, height: 200 }, { x: 100, y: 100, width: 200, height: 200 });
    expect(padding.glow).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(padding.stroke).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });

    const partial = observationFramePadding({ x: 110, y: 110, width: 180, height: 180 }, { x: 100, y: 100, width: 200, height: 200 });
    // Inset 10 = 8 stroke + 2 glow.
    expect(partial.glow).toEqual({ top: 2, right: 2, bottom: 2, left: 2 });
    expect(partial.stroke).toEqual({ top: 8, right: 8, bottom: 8, left: 8 });
  });

  it("rounds to whole pixels so the ribbon never lands on a half pixel", () => {
    const region = { x: 100.4, y: 200.6, width: 300.5, height: 200.4 };
    const placement = observationFramePlacement(region, workArea);
    for (const value of Object.values(placement.bounds)) expect(Number.isInteger(value)).toBe(true);
    for (const value of [...Object.values(placement.glow), ...Object.values(placement.stroke)]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("emits every CSS variable the renderer reads", () => {
    // The stylesheet has fallbacks for all eight; a missing assignment would silently fall back to
    // the flush-edge value and put the hole in the wrong place.
    const script = observationFrameCssScript(
      { top: 1, right: 2, bottom: 3, left: 4 },
      { top: 8, right: 8, bottom: 8, left: 8 },
    );
    for (const name of ["--glow-top", "--glow-right", "--glow-bottom", "--glow-left", "--stroke-top", "--stroke-right", "--stroke-bottom", "--stroke-left"]) {
      expect(script).toContain(name);
    }
    expect(script).toContain('"1px"');
    expect(script).toContain('"4px"');
  });
});
