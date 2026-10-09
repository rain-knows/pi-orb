/** Electron adapter for mini-yifan/dsh-orb-cordis@aa79308e47265b7d4a774edb688de2bbd7dce66e,
 * packages/helper/src/geometry.ts and main.ts (MIT). Placement and gestures are directly ported;
 * this module supplies the Electron cursor/display/window boundaries. */
import { screen, systemPreferences, type BrowserWindow } from "electron";
import { FloatingPlacement, initialFloatingWindowBounds, type FloatingExpandState } from "./floating-geometry";
export type FloatingWindowState = FloatingExpandState;
const placements = new WeakMap<BrowserWindow, FloatingPlacement>();
function placement(window: BrowserWindow): FloatingPlacement {
  let value = placements.get(window);
  if (!value) {
    value = new FloatingPlacement({
      getBounds: () => window.getBounds(),
      setBounds: bounds => { if (!window.isDestroyed()) window.setBounds(bounds); },
    }, point => screen.getDisplayNearestPoint({ x: Math.round(point.x), y: Math.round(point.y) }),
    () => screen.getAllDisplays().map(display => display.bounds),
    () => systemPreferences.getAnimationSettings?.().prefersReducedMotion === true);
    placements.set(window, value);
  }
  return value;
}
export function initialFloatingBounds(): Electron.Rectangle { return initialFloatingWindowBounds(screen.getPrimaryDisplay().workArea); }
export function setFloatingExpanded(window: BrowserWindow, expanded: boolean): FloatingWindowState { return placement(window).setExpanded(expanded); }
export function setFloatingAgentStrip(window: BrowserWindow, width: number): FloatingWindowState { return placement(window).setStrip(width); }
export function pressFloatingBall(window: BrowserWindow): void { placement(window).press(screen.getCursorScreenPoint()); }
export function beginFloatingDrag(window: BrowserWindow): void { placement(window).beginDrag(); }
export function moveFloatingDrag(window: BrowserWindow, canDock: boolean): void { placement(window).dragTo(screen.getCursorScreenPoint(), canDock); }
export function endFloatingDrag(window: BrowserWindow, canDock: boolean): Promise<FloatingWindowState> { return placement(window).endDrag(screen.getCursorScreenPoint(), canDock); }
export function clampFloatingWindow(window: BrowserWindow): Promise<FloatingWindowState> { return placement(window).clamp(); }
export async function unsnapDockedBall(window: BrowserWindow): Promise<FloatingWindowState> {
  await placement(window).unsnap();
  return placement(window).setExpanded(false);
}
