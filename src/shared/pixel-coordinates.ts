/**
 * Pixel branch ported from rain-knows/dsh-orb-cordis@9cdc50302d202f4497569731be488a8afa500da7,
 * packages/computer-use/src/coordinates.ts:166-215, MIT. Copyright (c) 2026 mini-yifan / DeepSeek.
 * Full permission notice: THIRD_PARTY_NOTICES.md. Pi has one model encoding; no Cordis mode switch.
 */
import type { ObservationRasterSize as ObservationRaster } from './observation-raster';
import { COORDINATE_SPACE } from './orb-tools';
/**
 * Require a two-number pixel position inside an attached raster, inclusive of the far edge.
 * @param position - tool argument array.
 * @param attached - width/height of the observation the model is looking at.
 * @returns the validated `[x, y]` pair.
 * @throws when the array is not two finite coordinates in that raster.
 */
export function requirePixelPosition(
  position: readonly number[],
  attached: ObservationRaster,
): [number, number] {
  if (position.length !== 2) {
    throw new Error(
      `position must be [x, y] with exactly two coordinates in the attached ${String(attached.width)}x${String(attached.height)} pixel space`,
    )
  }
  const x = position[0]
  const y = position[1]
  if (x === undefined || y === undefined
    || !Number.isFinite(x) || !Number.isFinite(y)
    || x < 0 || x > attached.width
    || y < 0 || y > attached.height) {
    throw new Error(
      `position coordinates must be finite numbers in the attached ${String(attached.width)}x${String(attached.height)} pixel space`,
    )
  }
  return [x, y]
}

/** Same reference pixel-to-HID formula; the native backend still consumes millifractions. */
export function modelPositionToHid(position: readonly number[], attached: ObservationRaster): [number, number] {
  const [x, y] = requirePixelPosition(position, attached);
  return [(x / attached.width) * COORDINATE_SPACE, (y / attached.height) * COORDINATE_SPACE];
}
