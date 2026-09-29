/**
 * Floating orb window lifecycle: geometry application, dock/expand transitions and display
 * changes.
 *
 * Source: the window state machine in `deepseek-harness-orb` commit
 * `72f1d738458a223696685a909e806b683eff5885`, `apps/desktop/src/floating-window.ts` (MIT — see
 * `THIRD_PARTY_NOTICES.md` §3.5). The behaviour is reused; the host calls it makes (dsh RPC,
 * overlay guard, observation frame) are not, because the Orb window here is a pi-orb shell over
 * the user's existing pi-web.
 *
 * The dock gesture is animated, not snapped: dragging the ball past a screen edge slides the window
 * off-screen over `FLOATING_DOCK_SLIDE_OFF_MS` with `easeInOutCubic`, and unsnapping slides it back
 * over `FLOATING_DOCK_SLIDE_IN_MS` with `easeOutCubic`, after which the dock tab takes the ball's
 * place. Both durations and both curves are the reference's; they are what makes the gesture read as
 * a movement rather than a jump. `prefersReducedMotion()` (Electron's view of the OS setting)
 * disables it, which the reference also does.
 */
import { screen, systemPreferences, type BrowserWindow } from "electron";
import {
  FLOATING_BALL_WINDOW_SIZE,
  FLOATING_CHROME_INSET,
  FLOATING_DOCK_SLIDE_IN_MS,
  FLOATING_DOCK_SLIDE_OFF_MS,
  ballOriginFromWindow,
  clampedBallOrigin,
  collapsedWindowBounds,
  defaultFloatingBallOrigin,
  dockSideForBallOrigin,
  dockedTabBounds,
  easeInOutCubic,
  easeOutCubic,
  expandDirection,
  expandedOverlayBounds,
  insideBallOrigin,
  lerpRect,
  offScreenBallOrigin,
  staysDocked,
  type FloatingDockSide,
  type FloatingDirection,
  type FloatingRect,
} from "./floating-geometry";

export interface FloatingWindowState {
  readonly expanded: boolean;
  readonly horizontal: "left" | "right";
  readonly vertical: "up" | "down";
  readonly docked: FloatingDockSide | undefined;
}

const directions = new WeakMap<BrowserWindow, FloatingDirection>();
const docks = new WeakMap<BrowserWindow, { side: FloatingDockSide; y: number }>();
const animations = new WeakMap<BrowserWindow, { cancelled: boolean; resolve: () => void }>();

function rect(value: Electron.Rectangle): FloatingRect {
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

/**
 * Whether the OS asks for reduced motion (reference `prefersReducedMotion`).
 *
 * `getAnimationSettings` is only present on some platforms, hence the optional call; when it is
 * absent the answer is "animate", matching the reference's optional access.
 */
function prefersReducedMotion(): boolean {
  return systemPreferences.getAnimationSettings?.().prefersReducedMotion === true;
}

/** Stop an in-flight slide and let its awaiter continue (reference `cancelOverlayAnim`). */
function cancelAnimation(window: BrowserWindow): void {
  const animation = animations.get(window);
  if (animation === undefined) return;
  animation.cancelled = true;
  animation.resolve();
  animations.delete(window);
}

/**
 * Move the window to `end`, sliding when the reference would.
 *
 * The reference skips the animation under test, when the window is gone, and when the OS asks for
 * reduced motion; in those cases it applies the target rect immediately. `durationMs <= 0` does the
 * same, so callers can pass the reference's constant directly.
 */
function animateBounds(
  window: BrowserWindow,
  end: FloatingRect,
  durationMs: number,
  ease: (t: number) => number,
): Promise<void> {
  cancelAnimation(window);
  const start = rect(window.getBounds());
  if (process.env.VITEST === "true" || window.isDestroyed() || prefersReducedMotion() || durationMs <= 0) {
    if (!window.isDestroyed()) window.setBounds(end);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const animation = { cancelled: false, resolve };
    animations.set(window, animation);
    const startedAt = Date.now();
    const tick = (): void => {
      if (animation.cancelled) return;
      if (window.isDestroyed()) {
        animations.delete(window);
        resolve();
        return;
      }
      const t = Math.min(1, (Date.now() - startedAt) / durationMs);
      window.setBounds(lerpRect(start, end, ease(t)));
      if (t < 1) {
        setTimeout(tick, 16);
        return;
      }
      animations.delete(window);
      resolve();
    };
    setTimeout(tick, 16);
  });
}

function displayFor(window: BrowserWindow): { bounds: FloatingRect; workArea: FloatingRect } {
  const bounds = rect(window.getBounds());
  const display = screen.getDisplayNearestPoint({ x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) });
  return { bounds: rect(display.bounds), workArea: rect(display.workArea) };
}

function currentBallOrigin(window: BrowserWindow, workArea: FloatingRect): { x: number; y: number } {
  const bounds = rect(window.getBounds());
  const docked = docks.get(window);
  if (docked) return insideBallOrigin(docked.side, docked.y, displayFor(window));
  if (bounds.width <= FLOATING_BALL_WINDOW_SIZE && bounds.height <= FLOATING_BALL_WINDOW_SIZE) {
    return { x: bounds.x + FLOATING_CHROME_INSET, y: bounds.y + FLOATING_CHROME_INSET };
  }
  const direction = directions.get(window) ?? expandDirection({ x: bounds.x, y: bounds.y }, workArea);
  return ballOriginFromWindow(bounds, direction);
}

function setDocked(window: BrowserWindow, side: FloatingDockSide, y: number): FloatingWindowState {
  const display = displayFor(window);
  const nextY = Math.max(display.bounds.y, Math.min(Math.round(y), display.bounds.y + display.bounds.height - 88));
  docks.set(window, { side, y: nextY });
  window.setBounds(dockedTabBounds(side, nextY, display.bounds));
  const direction = directions.get(window) ?? { horizontal: side === "left" ? "right" : "left", vertical: "down" };
  return { expanded: false, ...direction, docked: side };
}

function clearDock(window: BrowserWindow): void { docks.delete(window); }

export function initialFloatingBounds(): Electron.Rectangle {
  const workArea = rect(screen.getPrimaryDisplay().workArea);
  const origin = defaultFloatingBallOrigin(workArea);
  return collapsedWindowBounds(origin);
}

export function setFloatingExpanded(window: BrowserWindow, expanded: boolean): FloatingWindowState {
  const display = displayFor(window);
  const origin = currentBallOrigin(window, display.workArea);
  if (expanded) {
    clearDock(window);
    const next = expandedOverlayBounds(origin, display.workArea);
    directions.set(window, { horizontal: next.horizontal, vertical: next.vertical });
    window.setBounds(next);
    return { expanded: true, horizontal: next.horizontal, vertical: next.vertical, docked: undefined };
  }
  const direction = directions.get(window) ?? expandDirection(origin, display.workArea);
  const docked = docks.get(window);
  if (docked) return setDocked(window, docked.side, docked.y);
  const next = clampedBallOrigin(origin, display.workArea);
  window.setBounds(collapsedWindowBounds(next));
  return { expanded: false, ...direction, docked: undefined };
}

export function moveFloatingBall(window: BrowserWindow, x: number, y: number): FloatingWindowState {
  const display = displayFor(window);
  const docked = docks.get(window);
  if (docked && staysDocked(docked.side, x, display.bounds)) return setDocked(window, docked.side, y);
  clearDock(window);
  const origin = { x: Math.round(x), y: Math.round(y) };
  window.setBounds(collapsedWindowBounds(origin));
  const direction = directions.get(window) ?? expandDirection(origin, display.workArea);
  directions.set(window, direction);
  return { expanded: false, ...direction, docked: undefined };
}

export async function clampFloatingWindow(window: BrowserWindow): Promise<FloatingWindowState> {
  const display = displayFor(window);
  const origin = currentBallOrigin(window, display.workArea);
  const side = dockSideForBallOrigin(origin, display.bounds);
  if (side) {
    // Slide the ball off the edge first, then leave the tab in its place: the reference's
    // `FLOATING_DOCK_SLIDE_OFF_MS` with `easeInOutCubic`. Placing the tab first would make the ball
    // vanish at the pointer instead of travelling past the edge.
    await animateBounds(
      window,
      collapsedWindowBounds(offScreenBallOrigin(side, origin.y, display.bounds)),
      FLOATING_DOCK_SLIDE_OFF_MS,
      easeInOutCubic,
    );
    if (window.isDestroyed()) return { expanded: false, horizontal: "left", vertical: "down", docked: undefined };
    return setDocked(window, side, origin.y);
  }
  clearDock(window);
  const next = clampedBallOrigin(origin, display.workArea);
  window.setBounds(collapsedWindowBounds(next));
  const direction = directions.get(window) ?? expandDirection(next, display.workArea);
  directions.set(window, direction);
  return { expanded: false, ...direction, docked: undefined };
}

export async function unsnapDockedBall(window: BrowserWindow): Promise<FloatingWindowState> {
  const docked = docks.get(window);
  if (!docked) return clampFloatingWindow(window);
  const display = displayFor(window);
  // Snap the window to the off-screen position the tab occupies, then slide it back in over
  // `FLOATING_DOCK_SLIDE_IN_MS` with `easeOutCubic`, so the ball appears to be pulled out of the
  // edge rather than materialising at its resting place.
  clearDock(window);
  window.setBounds(collapsedWindowBounds(offScreenBallOrigin(docked.side, docked.y, display.bounds)));
  const origin = insideBallOrigin(docked.side, docked.y, display);
  await animateBounds(window, collapsedWindowBounds(origin), FLOATING_DOCK_SLIDE_IN_MS, easeOutCubic);
  if (window.isDestroyed()) return { expanded: false, horizontal: "left", vertical: "down", docked: undefined };
  const direction = directions.get(window) ?? expandDirection(origin, display.workArea);
  directions.set(window, direction);
  return { expanded: false, ...direction, docked: undefined };
}
