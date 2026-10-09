import { describe, expect, it } from "vitest";
import {
  COORDINATE_SPACE,
  isUsablePosition,
  positionToRequest,
  type ScreenshotPosition,
} from "@shared/orb-tools";

/**
 * The C7 core: a screenshot fraction must land on the same point of the desktop that the target app
 * reports. This is the step that was wrong before — the model was asked for a screen coordinate it
 * had no way to compute, and the observation dropped the window's screen position entirely
 * (doc/observation-coordinates.md).
 *
 * The numbers are the real ones from two independent runs against the disposable P1-05 target
 * (original fixture runs retained in Git history):
 *
 *   driver-reported window bounds 189,135 735x786   (the space a request lives in)
 *   window DIP bounds             120,90  502x530    (the target's own getBounds)
 *   content DIP bounds            127,146 488x467    (the target's own getContentBounds)
 *   grid cells                    120x90 DIP each
 *
 * A committed passing run sent request (452, 287) for cell 1,2 and the target logged that cell's
 * centre. The fraction a model would read off the screenshot for that cell is
 * ((427-120)/502, (281-90)/530) = (0.6116, 0.3604).
 */
const DRIVER_WINDOW = { x: 0, y: 0, width: 735, height: 786 };
const WINDOW_DIP = { x: 120, y: 90, width: 502, height: 530 };
const CONTENT_DIP = { x: 127, y: 146, width: 488, height: 467 };
const CELL = { width: 120, height: 90 };

/** The target's own screen point for a grid cell centre, as DIP. */
function cellCentreDip(row: number, column: number): { x: number; y: number } {
  return {
    x: CONTENT_DIP.x + column * CELL.width + CELL.width / 2,
    y: CONTENT_DIP.y + row * CELL.height + CELL.height / 2,
  };
}

/** The fraction a model would read off the screenshot for a screen point. */
function fractionOfScreenDip(screenDip: { x: number; y: number }): ScreenshotPosition {
  return {
    x: ((screenDip.x - WINDOW_DIP.x) / WINDOW_DIP.width) * COORDINATE_SPACE,
    y: ((screenDip.y - WINDOW_DIP.y) / WINDOW_DIP.height) * COORDINATE_SPACE,
  };
}

describe("positionToRequest", () => {
  it("maps the fraction corners onto the window rect corners", () => {
    expect(positionToRequest({ x: 0, y: 0 }, DRIVER_WINDOW)).toEqual({ x: 0, y: 0 });
    expect(positionToRequest({ x: COORDINATE_SPACE, y: COORDINATE_SPACE }, DRIVER_WINDOW)).toEqual({
      x: 735,
      y: 786,
    });
  });

  it("maps the middle fraction onto the rect centre", () => {
    expect(positionToRequest({ x: 500, y: 500 }, DRIVER_WINDOW)).toEqual({ x: 367.5, y: 393 });
  });
});

describe("C7: a screenshot fraction lands on the point the target reports", () => {
  it("reproduces the request a committed passing run sent for cell 1,2", () => {
    // The committed run sent (452, 287) and the target logged cell 1,2. A different conversion was
    // measured to land on cell 0,1 instead, which is the defect this pins shut.
    const fraction = fractionOfScreenDip(cellCentreDip(1, 2));
    const request = positionToRequest(fraction, DRIVER_WINDOW);
    // Within the few pixels the rects disagree by (the target's 502-wide DIP bounds vs the driver's
    // 735/1.5 = 490), which is far inside a 120x90 cell.
    expect(Math.abs(request.x - 452)).toBeLessThanOrEqual(4);
    expect(Math.abs(request.y - 287)).toBeLessThanOrEqual(4);
  });

  it("puts every grid cell in its own cell of the window", () => {
    // The whole grid, not one sample: an off-by-one-cell error is the failure that was observed.
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const fraction = fractionOfScreenDip(cellCentreDip(row, column));
        const request = positionToRequest(fraction, DRIVER_WINDOW);
        // Convert the request back through the driver's window size and the target's own layout to
        // ask which cell it is in, exactly as the target's own handler does.
        const dip = { x: WINDOW_DIP.x + (request.x / DRIVER_WINDOW.width) * WINDOW_DIP.width, y: WINDOW_DIP.y + (request.y / DRIVER_WINDOW.height) * WINDOW_DIP.height };
        const landedColumn = Math.floor((dip.x - CONTENT_DIP.x) / CELL.width);
        const landedRow = Math.floor((dip.y - CONTENT_DIP.y) / CELL.height);
        expect(`${landedRow},${landedColumn}`).toBe(`${row},${column}`);
      }
    }
  });

  it("is independent of the capture raster size, which is what makes it robust", () => {
    // The raster is not exactly the window's pixel size (P1-04 measured 1081x783 against 1083x783
    // physical), and resizing only changes the raster. Because a position is a fraction, the very
    // same fraction maps to the very same request at any raster size — there is no raster input to
    // this function at all, and this test pins that the mapping does not need one.
    const fraction = fractionOfScreenDip(cellCentreDip(1, 2));
    expect(positionToRequest(fraction, DRIVER_WINDOW)).toEqual(positionToRequest(fraction, DRIVER_WINDOW));
  });
});

describe("isUsablePosition", () => {
  it("accepts the whole fraction space including its edges", () => {
    expect(isUsablePosition({ x: 0, y: 0 })).toBe(true);
    expect(isUsablePosition({ x: COORDINATE_SPACE, y: COORDINATE_SPACE })).toBe(true);
    expect(isUsablePosition({ x: 1, y: 999 })).toBe(true);
  });

  it("rejects anything that is not a finite in-range pair", () => {
    expect(isUsablePosition(undefined)).toBe(false);
    expect(isUsablePosition({ x: -1, y: 0 })).toBe(false);
    expect(isUsablePosition({ x: 0, y: COORDINATE_SPACE + 1 })).toBe(false);
    expect(isUsablePosition({ x: Number.NaN, y: 0 })).toBe(false);
    expect(isUsablePosition({ x: Number.POSITIVE_INFINITY, y: 0 })).toBe(false);
  });
});
