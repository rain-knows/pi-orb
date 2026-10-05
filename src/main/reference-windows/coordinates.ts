/**
 * Screenshot-fraction mapping for the observation surface.
 *
 * Source: `deepseek-harness-orb` commit `72f1d738458a223696685a909e806b683eff5885`,
 * `packages/experimental/tool-computer-use/src/coordinates.ts` (MIT).
 *
 * Trimmed on purpose, not adapted: the reference file also validates model positions, click
 * modifiers and screenshot hotkeys, but pi-orb enforces all of that once, in the shared tool
 * contract (`src/shared/orb-tools.ts`, `validateAction`). Keeping a second validator here would
 * leave two implementations of the same rule with no caller for one of them, which the project's
 * own rules forbid (N8, and `doc/reference-playbook.md` §6.2). What remains is the one function the
 * production path uses: `mapNormalizedToGlobal`, called from `windows.ts`. Model-facing 0–1000
 * positions are validated by the shared Orb contract; this native seam receives millifractions.
 *
 * @module @deepseek-ai/dsh-experimental-tool-computer-use/src/coordinates
 */

import type { ScreenInfo } from './backend.ts'

/** Inclusive upper bound of the millifraction position space on each axis. */
const COORDINATE_SPACE = 1000

/**
 * Map a 0–1 screenshot fraction onto one observation surface's logical global coordinates.
 * @param fraction - `[x, y]` each in `[0, 1]`, already divided by 1000 or attached size.
 * @param screen - observation whose logical bounds receive the mapping.
 * @returns global logical coordinates in the same space as `screen.bounds`.
 */
function mapFractionToGlobal(
  fraction: readonly [number, number],
  screen: ScreenInfo,
): { x: number; y: number } {
  const [fx, fy] = fraction
  return {
    x: screen.bounds.x + fx * screen.bounds.width,
    y: screen.bounds.y + fy * screen.bounds.height,
  }
}

/**
 * Map a 0–1000 position onto one observation surface's logical global coordinates.
 * @param position - `[x, y]` in the 0–1000 space of `screen`.
 * @param screen - observation whose logical bounds receive the mapping.
 * @returns global logical coordinates in the same space as `screen.bounds`.
 */
export function mapNormalizedToGlobal(
  position: readonly [number, number],
  screen: ScreenInfo,
): { x: number; y: number } {
  const [nx, ny] = position
  return mapFractionToGlobal([nx / COORDINATE_SPACE, ny / COORDINATE_SPACE], screen)
}
