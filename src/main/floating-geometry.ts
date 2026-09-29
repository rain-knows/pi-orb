/**
 * Floating orb geometry adapted from
 * deepseek-harness-orb/apps/desktop/src/floating-window.ts at
 * 72f1d738458a223696685a909e806b683eff5885.
 *
 * The geometry is intentionally kept in a small module so Pi session and
 * authorization code never owns the overlay layout rules.
 */

export const FLOATING_BALL_SIZE = 72;
export const FLOATING_PANEL_SIZE = { width: 320, height: 420 } as const;
export const FLOATING_CHROME_INSET = 12;
export const FLOATING_BALL_WINDOW_SIZE = FLOATING_BALL_SIZE + 2 * FLOATING_CHROME_INSET;
export const FLOATING_PANEL_WINDOW_SIZE = {
  width: FLOATING_PANEL_SIZE.width + 2 * FLOATING_CHROME_INSET,
  height: FLOATING_PANEL_SIZE.height + 2 * FLOATING_CHROME_INSET,
} as const;
export const FLOATING_BALL_DEFAULT_BELOW_CENTER = 0.08;
export const FLOATING_DOCK_OVERLAP = Math.round(FLOATING_BALL_SIZE / 5);
export const FLOATING_DOCK_DRAG_OFF = Math.round(FLOATING_BALL_SIZE / 3);
export const FLOATING_DOCK_TAB_WIDTH = 6;
export const FLOATING_DOCK_TAB_HEIGHT = FLOATING_BALL_SIZE;
export const FLOATING_DOCK_GLOW = 8;
export const FLOATING_DOCK_HOVER_MARGIN = 20;
export const FLOATING_DOCK_HIT_WIDTH = FLOATING_DOCK_TAB_WIDTH + FLOATING_DOCK_GLOW + FLOATING_DOCK_HOVER_MARGIN;
export const FLOATING_DOCK_HIT_HEIGHT = FLOATING_DOCK_TAB_HEIGHT + 2 * FLOATING_DOCK_GLOW;
export const FLOATING_DOCK_OFF_GAP = 2;
export const FLOATING_DOCK_IN_PAD = 5;

export type FloatingHorizontalExpand = "left" | "right";
export type FloatingVerticalExpand = "up" | "down";
export type FloatingDockSide = "left" | "right";

export interface FloatingRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface FloatingDisplay { readonly bounds: FloatingRect; readonly workArea: FloatingRect }
export interface FloatingDirection { readonly horizontal: FloatingHorizontalExpand; readonly vertical: FloatingVerticalExpand }

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function dockSideForBallOrigin(ball: { readonly x: number; readonly y: number }, bounds: FloatingRect): FloatingDockSide | undefined {
  const leftOverlap = bounds.x - ball.x;
  const rightOverlap = ball.x + FLOATING_BALL_SIZE - (bounds.x + bounds.width);
  if (leftOverlap >= FLOATING_DOCK_OVERLAP && leftOverlap >= rightOverlap) return "left";
  if (rightOverlap >= FLOATING_DOCK_OVERLAP) return "right";
  return undefined;
}

export function dockedTabBounds(side: FloatingDockSide, ballY: number, bounds: FloatingRect): FloatingRect {
  const y = clamp(Math.round(ballY - FLOATING_DOCK_GLOW), bounds.y, bounds.y + bounds.height - FLOATING_DOCK_HIT_HEIGHT);
  return {
    x: side === "left" ? bounds.x : bounds.x + bounds.width - FLOATING_DOCK_HIT_WIDTH,
    y,
    width: FLOATING_DOCK_HIT_WIDTH,
    height: FLOATING_DOCK_HIT_HEIGHT,
  };
}

export function expandDirection(ball: { readonly x: number; readonly y: number }, workArea: FloatingRect): FloatingDirection {
  const centerX = ball.x + FLOATING_BALL_SIZE / 2;
  return {
    horizontal: centerX - workArea.x > workArea.width / 2 ? "left" : "right",
    vertical: ball.y - workArea.y < FLOATING_PANEL_SIZE.height - FLOATING_BALL_SIZE ? "down" : "up",
  };
}

export function ballOriginFromWindow(bounds: FloatingRect, direction: FloatingDirection): { x: number; y: number } {
  return {
    x: direction.horizontal === "left"
      ? bounds.x + bounds.width - FLOATING_CHROME_INSET - FLOATING_BALL_SIZE
      : bounds.x + FLOATING_CHROME_INSET,
    y: direction.vertical === "up"
      ? bounds.y + bounds.height - FLOATING_CHROME_INSET - FLOATING_BALL_SIZE
      : bounds.y + FLOATING_CHROME_INSET,
  };
}

export function clampedBallOrigin(ball: { readonly x: number; readonly y: number }, workArea: FloatingRect): { x: number; y: number } {
  return {
    x: clamp(ball.x, workArea.x, workArea.x + workArea.width - FLOATING_BALL_SIZE),
    y: clamp(ball.y, workArea.y, workArea.y + workArea.height - FLOATING_BALL_SIZE),
  };
}

export function defaultFloatingBallOrigin(workArea: FloatingRect): { x: number; y: number } {
  const x = workArea.x + workArea.width - FLOATING_BALL_SIZE;
  const centerY = workArea.y + (workArea.height - FLOATING_BALL_SIZE) / 2;
  return clampedBallOrigin({ x: Math.round(x), y: Math.round(centerY + workArea.height * FLOATING_BALL_DEFAULT_BELOW_CENTER) }, workArea);
}

function clampWindowOrigin(value: number, workOrigin: number, workSize: number, windowSize: number): number {
  return clamp(value, workOrigin - FLOATING_CHROME_INSET, workOrigin + workSize - windowSize + FLOATING_CHROME_INSET);
}

function overlayBoundsFromBall(ball: { readonly x: number; readonly y: number }, direction: FloatingDirection): FloatingRect {
  return {
    x: direction.horizontal === "left"
      ? ball.x - (FLOATING_PANEL_SIZE.width - FLOATING_BALL_SIZE) - FLOATING_CHROME_INSET
      : ball.x - FLOATING_CHROME_INSET,
    y: direction.vertical === "up"
      ? ball.y - (FLOATING_PANEL_SIZE.height - FLOATING_BALL_SIZE) - FLOATING_CHROME_INSET
      : ball.y - FLOATING_CHROME_INSET,
    width: FLOATING_PANEL_WINDOW_SIZE.width,
    height: FLOATING_PANEL_WINDOW_SIZE.height,
  };
}

export function expandedOverlayBounds(ball: { readonly x: number; readonly y: number }, workArea: FloatingRect): FloatingRect & FloatingDirection {
  const direction = expandDirection(ball, workArea);
  const unclamped = overlayBoundsFromBall(ball, direction);
  return {
    x: clampWindowOrigin(unclamped.x, workArea.x, workArea.width, unclamped.width),
    y: clampWindowOrigin(unclamped.y, workArea.y, workArea.height, unclamped.height),
    width: unclamped.width,
    height: unclamped.height,
    ...direction,
  };
}

export function collapsedWindowBounds(ball: { readonly x: number; readonly y: number }): FloatingRect {
  return { x: ball.x - FLOATING_CHROME_INSET, y: ball.y - FLOATING_CHROME_INSET, width: FLOATING_BALL_WINDOW_SIZE, height: FLOATING_BALL_WINDOW_SIZE };
}

export function insideBallOrigin(side: FloatingDockSide, ballY: number, display: FloatingDisplay): { x: number; y: number } {
  return {
    x: side === "left" ? display.bounds.x + FLOATING_DOCK_IN_PAD : display.bounds.x + display.bounds.width - FLOATING_BALL_SIZE - FLOATING_DOCK_IN_PAD,
    y: clamp(Math.round(ballY), display.workArea.y, display.workArea.y + display.workArea.height - FLOATING_BALL_SIZE),
  };
}

export function offScreenBallOrigin(side: FloatingDockSide, ballY: number, bounds: FloatingRect): { x: number; y: number } {
  const y = clamp(Math.round(ballY), bounds.y, bounds.y + bounds.height - FLOATING_BALL_SIZE);
  return { x: side === "left" ? bounds.x - FLOATING_BALL_SIZE - FLOATING_DOCK_OFF_GAP : bounds.x + bounds.width + FLOATING_DOCK_OFF_GAP, y };
}

export function staysDocked(side: FloatingDockSide, cursorX: number, bounds: FloatingRect): boolean {
  return side === "right" ? cursorX >= bounds.x + bounds.width - FLOATING_DOCK_DRAG_OFF : cursorX <= bounds.x + FLOATING_DOCK_DRAG_OFF;
}
