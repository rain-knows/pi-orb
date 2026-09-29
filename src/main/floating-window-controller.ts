import { screen, type BrowserWindow } from "electron";
import {
  FLOATING_BALL_WINDOW_SIZE,
  FLOATING_CHROME_INSET,
  ballOriginFromWindow,
  clampedBallOrigin,
  collapsedWindowBounds,
  defaultFloatingBallOrigin,
  dockSideForBallOrigin,
  dockedTabBounds,
  expandDirection,
  expandedOverlayBounds,
  insideBallOrigin,
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

function rect(value: Electron.Rectangle): FloatingRect {
  return { x: value.x, y: value.y, width: value.width, height: value.height };
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

export function clampFloatingWindow(window: BrowserWindow): FloatingWindowState {
  const display = displayFor(window);
  const origin = currentBallOrigin(window, display.workArea);
  const side = dockSideForBallOrigin(origin, display.bounds);
  if (side) return setDocked(window, side, origin.y);
  clearDock(window);
  const next = clampedBallOrigin(origin, display.workArea);
  window.setBounds(collapsedWindowBounds(next));
  const direction = directions.get(window) ?? expandDirection(next, display.workArea);
  directions.set(window, direction);
  return { expanded: false, ...direction, docked: undefined };
}

export function unsnapDockedBall(window: BrowserWindow): FloatingWindowState {
  const docked = docks.get(window);
  if (!docked) return clampFloatingWindow(window);
  const display = displayFor(window);
  clearDock(window);
  const origin = insideBallOrigin(docked.side, docked.y, display);
  window.setBounds(collapsedWindowBounds(origin));
  const direction = directions.get(window) ?? expandDirection(origin, display.workArea);
  directions.set(window, direction);
  return { expanded: false, ...direction, docked: undefined };
}
