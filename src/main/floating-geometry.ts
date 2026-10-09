/** Ported from mini-yifan/dsh-orb-cordis@aa79308e47265b7d4a774edb688de2bbd7dce66e, packages/helper/src/geometry.ts. MIT; Copyright (c) 2026 mini-yifan. Adaptations: Pi export names, exported pure helpers, existing OS reduced-motion gate. See THIRD_PARTY_NOTICES.md. */
/**
 * Floating-ball window geometry.
 * Sizes match the fork overlay exactly: a 72px ball, 12px of transparent chrome, and a 320×420 panel.
 */

export const FLOATING_BALL_SIZE = 72
export const FLOATING_PANEL_SIZE = { width: 320, height: 420 } as const
export const FLOATING_CHROME_INSET = 12
export const FLOATING_BALL_WINDOW_SIZE = FLOATING_BALL_SIZE + 2 * FLOATING_CHROME_INSET
export const FLOATING_PANEL_WINDOW_SIZE = {
  width: FLOATING_PANEL_SIZE.width + 2 * FLOATING_CHROME_INSET,
  height: FLOATING_PANEL_SIZE.height + 2 * FLOATING_CHROME_INSET,
} as const
/**
 * Transparent reserve on the panel's far edge for the bookmark strip.
 * Sized for the fully hover-expanded chip row; collapsed chips sit at the
 * panel-side edge inside it.
 */
export const AGENT_STRIP_WIDTH = 208
export const FLOATING_BALL_DEFAULT_BELOW_CENTER = 0.08
/**
 * Any contact with the display edge docks on release, plus a hair of tolerance.
 * Windows quantizes window bounds to whole device pixels, so a ball placed flush
 * against the edge can read back a pixel or two short when
 * `physicalWidth / scaleFactor` is not an integer (1920/1.5, 2560/1.25, 3840/1.75).
 * The drag itself no longer depends on that read-back; this only absorbs the
 * rounding of the final placement. A ball stopped clearly short of the edge
 * still stays free.
 */
export const FLOATING_DOCK_OVERLAP = 3
export const FLOATING_DOCK_DRAG_OFF = Math.round(FLOATING_BALL_SIZE / 3)
export const FLOATING_DOCK_TAB_WIDTH = 6
export const FLOATING_DOCK_GLOW = 8
export const FLOATING_DOCK_HOVER_MARGIN = 20
export const FLOATING_DOCK_HIT_WIDTH = FLOATING_DOCK_TAB_WIDTH + FLOATING_DOCK_GLOW + FLOATING_DOCK_HOVER_MARGIN
export const FLOATING_DOCK_HIT_HEIGHT = FLOATING_BALL_SIZE + 2 * FLOATING_DOCK_GLOW
export const FLOATING_DOCK_OFF_GAP = 2
export const FLOATING_DOCK_IN_PAD = 5
export const FLOATING_DOCK_SLIDE_OFF_MS = 250
export const FLOATING_DOCK_SLIDE_IN_MS = 300

export interface FloatingRect {
  x: number
  y: number
  width: number
  height: number
}

export type FloatingHorizontalExpand = 'left' | 'right'
export type FloatingVerticalExpand = 'up' | 'down'
export type FloatingDockSide = 'left' | 'right'

export interface FloatingExpandState {
  readonly expanded: boolean
  readonly horizontal: FloatingHorizontalExpand
  readonly vertical: FloatingVerticalExpand
  readonly docked: FloatingDockSide | undefined
  /** Reserved bookmark-strip width on the far edge; 0 when there is nothing to show. */
  readonly strip: number
}

export interface FloatingDockState {
  readonly docked: FloatingDockSide | undefined
}

export interface FloatingDisplay {
  readonly bounds: FloatingRect
  readonly workArea: FloatingRect
}

/** A point in the same DIP space as window bounds (screen coordinates). */
export interface Point {
  readonly x: number
  readonly y: number
}

export interface FloatingDirection {
  horizontal: FloatingHorizontalExpand
  vertical: FloatingVerticalExpand
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

export function collapsedWindowBounds(ball: { readonly x: number; readonly y: number }): FloatingRect {
  return {
    x: ball.x - FLOATING_CHROME_INSET,
    y: ball.y - FLOATING_CHROME_INSET,
    width: FLOATING_BALL_WINDOW_SIZE,
    height: FLOATING_BALL_WINDOW_SIZE,
  }
}

/**
 * Chromium turns a DIP window size into device pixels with an enclosing rect, then
 * converts back the same way. Whenever `size * scaleFactor` is not an integer
 * (120% is 115.2), a 96px ball window reads back 97. The panel is hundreds of
 * pixels larger, so a few DIP still cannot be the panel. 150% keeps 96 exactly
 * (`96 * 1.5 = 144`) but still pulls a window that would hang past the screen
 * back inside, which the dock decision handles separately.
 */
const BALL_WINDOW_SLOP = 4

function isCollapsed(bounds: FloatingRect): boolean {
  return bounds.width <= FLOATING_BALL_WINDOW_SIZE + BALL_WINDOW_SLOP && bounds.height <= FLOATING_BALL_WINDOW_SIZE + BALL_WINDOW_SLOP
}

/** The full ball window, as drawn by a collapsed ball or a slide still in flight. */
function drawsBall(bounds: FloatingRect): boolean {
  return Math.abs(bounds.width - FLOATING_BALL_WINDOW_SIZE) <= BALL_WINDOW_SLOP
    && Math.abs(bounds.height - FLOATING_BALL_WINDOW_SIZE) <= BALL_WINDOW_SLOP
}

function clampWindowOrigin(value: number, workOrigin: number, workSize: number, windowSize: number): number {
  return clamp(value, workOrigin - FLOATING_CHROME_INSET, workOrigin + workSize - windowSize + FLOATING_CHROME_INSET)
}

/**
 * Which outer display edge the ball reaches on release; contact within
 * {@link FLOATING_DOCK_OVERLAP} docks. An edge that touches another display is a seam,
 * not a place to dock.
 */
export function dockSideForBallOrigin(
  ball: { readonly x: number; readonly y: number },
  bounds: FloatingRect,
  displays: readonly FloatingRect[] = [],
): FloatingDockSide | undefined {
  const leftGap = bounds.x - ball.x
  const rightGap = ball.x + FLOATING_BALL_SIZE - (bounds.x + bounds.width)
  // The nearer edge wins, so a display narrower than the ball cannot dock both ways.
  let side: FloatingDockSide | undefined
  if (leftGap >= rightGap && leftGap >= -FLOATING_DOCK_OVERLAP) side = 'left'
  else if (rightGap > leftGap && rightGap >= -FLOATING_DOCK_OVERLAP) side = 'right'
  if (side === undefined || edgeTouchesDisplay(side, bounds, displays)) return undefined
  return side
}

function edgeTouchesDisplay(side: FloatingDockSide, bounds: FloatingRect, displays: readonly FloatingRect[]): boolean {
  const edge = side === 'left' ? bounds.x : bounds.x + bounds.width
  for (const other of displays) {
    if (sameRect(other, bounds)) continue
    const otherEdge = side === 'left' ? other.x + other.width : other.x
    if (Math.abs(otherEdge - edge) > 8) continue
    const top = Math.max(bounds.y, other.y)
    const bottom = Math.min(bounds.y + bounds.height, other.y + other.height)
    if (bottom > top) return true
  }
  return false
}

function sameRect(left: FloatingRect, right: FloatingRect): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height
}

/** Hittable strip for a docked tab, flush with a display edge. */
export function dockedTabBounds(side: FloatingDockSide, ballY: number, bounds: FloatingRect): FloatingRect {
  const y = clamp(Math.round(ballY - FLOATING_DOCK_GLOW), bounds.y, bounds.y + bounds.height - FLOATING_DOCK_HIT_HEIGHT)
  return {
    x: side === 'left' ? bounds.x : bounds.x + bounds.width - FLOATING_DOCK_HIT_WIDTH,
    y,
    width: FLOATING_DOCK_HIT_WIDTH,
    height: FLOATING_DOCK_HIT_HEIGHT,
  }
}

/** Panel growth that keeps the expanded overlay on the open side of the ball. */
export function expandDirection(
  ball: { readonly x: number; readonly y: number },
  workArea: FloatingRect,
): FloatingDirection {
  const centerX = ball.x + FLOATING_BALL_SIZE / 2
  const horizontal: FloatingHorizontalExpand = centerX - workArea.x > workArea.width / 2 ? 'left' : 'right'
  const vertical: FloatingVerticalExpand = ball.y - workArea.y < FLOATING_PANEL_SIZE.height - FLOATING_BALL_SIZE ? 'down' : 'up'
  return { horizontal, vertical }
}

/** Ball top-left recovered from an expanded window and its growth direction. */
export function ballOriginFromWindow(bounds: FloatingRect, direction: FloatingDirection): { x: number; y: number } {
  return {
    x: direction.horizontal === 'left'
      ? bounds.x + bounds.width - FLOATING_CHROME_INSET - FLOATING_BALL_SIZE
      : bounds.x + FLOATING_CHROME_INSET,
    y: direction.vertical === 'up'
      ? bounds.y + bounds.height - FLOATING_CHROME_INSET - FLOATING_BALL_SIZE
      : bounds.y + FLOATING_CHROME_INSET,
  }
}

/** Keep a 72px ball fully inside a work area. */
export function clampedBallOrigin(
  ball: { readonly x: number; readonly y: number },
  workArea: FloatingRect,
): { x: number; y: number } {
  return {
    x: clamp(ball.x, workArea.x, workArea.x + workArea.width - FLOATING_BALL_SIZE),
    y: clamp(ball.y, workArea.y, workArea.y + workArea.height - FLOATING_BALL_SIZE),
  }
}

/** Collapsed origin on the work-area right edge, slightly below vertical center. */
export function defaultFloatingBallOrigin(workArea: FloatingRect): { x: number; y: number } {
  const x = workArea.x + workArea.width - FLOATING_BALL_SIZE
  const centerY = workArea.y + (workArea.height - FLOATING_BALL_SIZE) / 2
  const y = centerY + workArea.height * FLOATING_BALL_DEFAULT_BELOW_CENTER
  return clampedBallOrigin({ x: Math.round(x), y: Math.round(y) }, workArea)
}

function overlayBoundsFromBall(
  ball: { readonly x: number; readonly y: number },
  direction: FloatingDirection,
  stripWidth = 0,
): FloatingRect {
  return {
    // The strip widens the far edge only; the ball-anchored near edge is untouched,
    // so ballOriginFromWindow needs no strip awareness.
    x: direction.horizontal === 'left'
      ? ball.x - (FLOATING_PANEL_SIZE.width - FLOATING_BALL_SIZE) - FLOATING_CHROME_INSET - stripWidth
      : ball.x - FLOATING_CHROME_INSET,
    y: direction.vertical === 'up'
      ? ball.y - (FLOATING_PANEL_SIZE.height - FLOATING_BALL_SIZE) - FLOATING_CHROME_INSET
      : ball.y - FLOATING_CHROME_INSET,
    width: FLOATING_PANEL_WINDOW_SIZE.width + stripWidth,
    height: FLOATING_PANEL_WINDOW_SIZE.height,
  }
}

export function expandedOverlayBounds(
  ball: { readonly x: number; readonly y: number },
  workArea: FloatingRect,
  stripWidth = 0,
): FloatingRect & FloatingDirection {
  const direction = expandDirection(ball, workArea)
  const unclamped = overlayBoundsFromBall(ball, direction, stripWidth)
  return {
    x: clampWindowOrigin(unclamped.x, workArea.x, workArea.width, unclamped.width),
    y: clampWindowOrigin(unclamped.y, workArea.y, workArea.height, unclamped.height),
    width: unclamped.width,
    height: unclamped.height,
    ...direction,
  }
}

function clampBallY(ballY: number, bounds: FloatingRect): number {
  return clamp(Math.round(ballY), bounds.y, bounds.y + bounds.height - FLOATING_BALL_SIZE)
}

export function offScreenBallOrigin(side: FloatingDockSide, ballY: number, bounds: FloatingRect): { x: number; y: number } {
  const y = clampBallY(ballY, bounds)
  return {
    x: side === 'left'
      ? bounds.x - FLOATING_BALL_SIZE - FLOATING_DOCK_OFF_GAP
      : bounds.x + bounds.width + FLOATING_DOCK_OFF_GAP,
    y,
  }
}

export function insideBallOrigin(
  side: FloatingDockSide,
  ballY: number,
  display: FloatingDisplay,
): { x: number; y: number } {
  return {
    x: side === 'left'
      ? display.bounds.x + FLOATING_DOCK_IN_PAD
      : display.bounds.x + display.bounds.width - FLOATING_BALL_SIZE - FLOATING_DOCK_IN_PAD,
    y: clamp(
      Math.round(ballY),
      display.workArea.y,
      display.workArea.y + display.workArea.height - FLOATING_BALL_SIZE,
    ),
  }
}

export function staysDocked(side: FloatingDockSide, cursorX: number, bounds: FloatingRect): boolean {
  if (side === 'right') return cursorX >= bounds.x + bounds.width - FLOATING_DOCK_DRAG_OFF
  return cursorX <= bounds.x + FLOATING_DOCK_DRAG_OFF
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

export function lerpRect(start: FloatingRect, end: FloatingRect, t: number): FloatingRect {
  return {
    x: Math.round(start.x + (end.x - start.x) * t),
    y: Math.round(start.y + (end.y - start.y) * t),
    width: Math.round(start.width + (end.width - start.width) * t),
    height: Math.round(start.height + (end.height - start.height) * t),
  }
}

/** Initial collapsed window, including the transparent chrome around the ball. */
export function initialFloatingWindowBounds(workArea: FloatingRect): FloatingRect {
  return collapsedWindowBounds(defaultFloatingBallOrigin(workArea))
}

/**
 * Owns expand direction and dock state for one overlay window.
 * Dock is committed on pointer-up, not while the ball is still moving.
 */
export class FloatingPlacement {
  private direction: FloatingDirection = { horizontal: 'left', vertical: 'up' }
  private docked: { side: FloatingDockSide; y: number } | undefined
  private stripWidth = 0
  private anim = 0
  /** Cursor offset inside the ball, recorded at press and kept for the whole gesture. */
  private grab: Point | undefined
  /** Set once the renderer reports that the gesture passed the drag threshold. */
  private dragging = false
  /**
   * Ball origin last requested. The OS read-back is not a safe dock input on
   * Windows once the scale is above 100%: the window is kept inside the monitor,
   * so the 12px transparent chrome leaves the ball a chrome-width short of the
   * edge it was aimed at.
   */
  private placedOrigin: Point | undefined

  constructor(private readonly window: {
    getBounds(): FloatingRect
    setBounds(bounds: FloatingRect): void
  }, private readonly displayAt: (point: { x: number; y: number }) => FloatingDisplay, private readonly displayBounds: () => readonly FloatingRect[] = () => [], private readonly reducedMotion: () => boolean = () => false) {}

  /** Ball origin of a collapsed window, from the window bounds the OS applied. */
  private collapsedBallOrigin(): Point {
    const bounds = this.window.getBounds()
    return { x: bounds.x + FLOATING_CHROME_INSET, y: bounds.y + FLOATING_CHROME_INSET }
  }

  /** Resize between the ball and the panel while keeping the ball origin fixed. */
  setExpanded(expanded: boolean): FloatingExpandState {
    // Any explicit placement stops a slide still in flight, or its frames would
    // overwrite the window this call just set.
    this.anim += 1
    const bounds = this.window.getBounds()
    const display = this.displayAt(center(bounds))
    if (expanded) {
      const origin = this.currentBallOrigin()
      this.docked = undefined
      const next = expandedOverlayBounds(origin, display.workArea, this.stripWidth)
      this.direction = { horizontal: next.horizontal, vertical: next.vertical }
      this.window.setBounds({ x: next.x, y: next.y, width: next.width, height: next.height })
      return { expanded: true, ...this.direction, docked: undefined, strip: this.stripWidth }
    }
    if (this.docked) {
      this.applyTab(this.docked.side, this.docked.y, display.bounds)
      return { expanded: false, ...this.direction, docked: this.docked.side, strip: this.stripWidth }
    }
    const origin = clampedBallOrigin(this.currentBallOrigin(), display.workArea)
    this.window.setBounds(collapsedWindowBounds(origin))
    return { expanded: false, ...this.direction, docked: undefined, strip: this.stripWidth }
  }

  /**
   * Reserve (or free) bookmark-strip width on the far edge. While expanded the
   * window re-bounds immediately around the fixed ball origin; while collapsed
   * the value is stored for the next expand.
   */
  setStrip(width: number): FloatingExpandState {
    const next = Math.max(0, Math.round(width))
    if (next === this.stripWidth) {
      return { expanded: !isCollapsed(this.window.getBounds()) && !this.docked, ...this.direction, docked: this.docked?.side, strip: this.stripWidth }
    }
    this.stripWidth = next
    const bounds = this.window.getBounds()
    if (!isCollapsed(bounds) && !this.docked) {
      const display = this.displayAt(center(bounds))
      const origin = this.currentBallOrigin()
      const nextBounds = expandedOverlayBounds(origin, display.workArea, this.stripWidth)
      this.direction = { horizontal: nextBounds.horizontal, vertical: nextBounds.vertical }
      this.window.setBounds({ x: nextBounds.x, y: nextBounds.y, width: nextBounds.width, height: nextBounds.height })
    }
    return { expanded: !isCollapsed(this.window.getBounds()) && !this.docked, ...this.direction, docked: this.docked?.side, strip: this.stripWidth }
  }

  /**
   * Move so the 72px ball origin follows `(x, y)`.
   * A collapsed ball may hang past a display edge. Dock is committed by {@link clamp}.
   */
  move(x: number, y: number, canDock = true): FloatingDockState {
    const origin = { x: Math.round(x), y: Math.round(y) }
    this.placedOrigin = origin
    const bounds = this.window.getBounds()
    if (!isCollapsed(bounds) && this.docked === undefined) {
      const direction = this.direction
      this.window.setBounds(overlayBoundsFromBall(origin, direction, this.stripWidth))
      return { docked: undefined }
    }
    if (!canDock) {
      this.docked = undefined
      this.anim += 1
      this.window.setBounds(collapsedWindowBounds(origin))
      return { docked: undefined }
    }
    const display = this.displayAt(origin)
    if (this.docked && staysDocked(this.docked.side, origin.x, display.bounds)) {
      this.applyTab(this.docked.side, this.docked.y, display.bounds)
      return { docked: this.docked.side }
    }
    this.docked = undefined
    this.anim += 1
    this.window.setBounds(collapsedWindowBounds(origin))
    return { docked: undefined }
  }

  /**
   * Pointer pressed on the ball. The grab offset comes from the OS cursor and the
   * ball origin the window really has, both in the DIP space `setBounds` uses, so
   * the drag never reads a renderer-side window position.
   */
  press(cursor: Point): void {
    // A slide-off still in flight is taken over: the ball stops where it is drawn and
    // is free, so the grab and the drag both read the place the ball is actually at.
    this.stopSlideOff()
    const origin = this.currentBallOrigin()
    this.grab = { x: cursor.x - origin.x, y: cursor.y - origin.y }
    this.dragging = false
  }

  /** The gesture passed the drag threshold; from here the ball follows the cursor. */
  beginDrag(): void {
    this.dragging = this.grab !== undefined
  }

  /**
   * Follow the cursor. Stateless on purpose: the target is always cursor minus grab,
   * so the window moving cannot feed back into the next target.
   */
  dragTo(cursor: Point, canDock = true): FloatingDockState {
    if (!this.dragging || this.grab === undefined) return { docked: this.docked?.side }
    return this.move(cursor.x - this.grab.x, cursor.y - this.grab.y, canDock)
  }

  /**
   * Release. The ball is placed under the cursor, then docked on a side edge or
   * pulled back into the work area. The result is the full layout the page must
   * show, including the panel direction when a running panel re-anchored.
   */
  async endDrag(cursor: Point, canDock = true): Promise<FloatingExpandState> {
    const grab = this.grab
    const dragging = this.dragging
    this.grab = undefined
    this.dragging = false
    if (grab === undefined || !dragging) return this.expandState()
    this.move(cursor.x - grab.x, cursor.y - grab.y, canDock)
    return this.clamp(canDock)
  }

  /**
   * Pull a free ball inside the work area, or dock it when it reaches a side edge.
   * The decision uses the origin the drag requested. The window the OS actually
   * applied can sit short of that on a scaled Windows display.
   */
  async clamp(canDock = true): Promise<FloatingExpandState> {
    const bounds = this.window.getBounds()
    const display = this.displayAt(center(bounds))
    if (this.docked) {
      this.applyTab(this.docked.side, this.docked.y, display.bounds)
      return this.expandState()
    }
    if (isCollapsed(bounds)) {
      const origin = this.placedOrigin ?? this.collapsedBallOrigin()
      if (canDock) {
        const side = dockSideForBallOrigin(origin, display.bounds, this.displayBounds())
        if (side) return this.snap(side, origin.y, display.bounds)
      }
      this.window.setBounds(collapsedWindowBounds(clampedBallOrigin(origin, display.workArea)))
      return this.expandState()
    }
    // An open panel (running or asking) re-anchors toward the side with room now.
    // The new direction goes back with the result; the page cannot infer it.
    return this.setExpanded(true)
  }

  /** Slide the ball back on screen from a docked tab. */
  async unsnap(): Promise<FloatingDockState> {
    if (!this.docked) return { docked: undefined }
    const display = this.displayAt(center(this.window.getBounds()))
    const start = offScreenBallOrigin(this.docked.side, this.docked.y, display.bounds)
    const end = insideBallOrigin(this.docked.side, this.docked.y, display)
    this.docked = undefined
    this.window.setBounds(collapsedWindowBounds(start))
    await this.animate(collapsedWindowBounds(end), FLOATING_DOCK_SLIDE_IN_MS, easeOutCubic)
    return { docked: undefined }
  }

  /** Stop a slide-off that still draws the ball window; the ball stays free where it is. */
  private stopSlideOff(): void {
    if (this.docked && drawsBall(this.window.getBounds())) {
      this.docked = undefined
      this.anim += 1
    }
  }

  private currentBallOrigin(): Point {
    const bounds = this.window.getBounds()
    // A docked window at rest is the thin tab. While the slide-off still draws the
    // full ball window, the ball is wherever that window is, not at its docked pose.
    if (this.docked && !drawsBall(bounds)) return insideBallOrigin(this.docked.side, this.docked.y, this.displayAt(center(bounds)))
    if (isCollapsed(bounds)) return this.collapsedBallOrigin()
    return ballOriginFromWindow(bounds, this.direction)
  }

  private applyTab(side: FloatingDockSide, ballY: number, bounds: FloatingRect): void {
    const y = clampBallY(ballY, bounds)
    this.docked = { side, y }
    this.anim += 1
    this.window.setBounds(dockedTabBounds(side, y, bounds))
  }

  private async snap(side: FloatingDockSide, ballY: number, bounds: FloatingRect): Promise<FloatingExpandState> {
    const y = clampBallY(ballY, bounds)
    this.docked = { side, y }
    await this.animate(
      collapsedWindowBounds(offScreenBallOrigin(side, y, bounds)),
      FLOATING_DOCK_SLIDE_OFF_MS,
      easeInOutCubic,
    )
    if (!this.docked || this.docked.side !== side) return this.expandState()
    this.window.setBounds(dockedTabBounds(side, y, bounds))
    return this.expandState()
  }

  /** The layout as the window stands now, in the shape the page applies. */
  private expandState(): FloatingExpandState {
    const expanded = !isCollapsed(this.window.getBounds()) && this.docked === undefined
    return { expanded, ...this.direction, docked: this.docked?.side, strip: this.stripWidth }
  }

  private animate(end: FloatingRect, durationMs: number, ease: (t: number) => number): Promise<void> {
    const generation = ++this.anim
    const start = this.window.getBounds()
    if (durationMs <= 0 || this.reducedMotion()) {
      this.window.setBounds(end)
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const t0 = Date.now()
      const tick = (): void => {
        if (generation !== this.anim) {
          resolve()
          return
        }
        const t = Math.min(1, (Date.now() - t0) / durationMs)
        this.window.setBounds(lerpRect(start, end, ease(t)))
        if (t < 1) {
          setTimeout(tick, 16)
          return
        }
        resolve()
      }
      setTimeout(tick, 16)
    })
  }
}

function center(bounds: FloatingRect): { x: number; y: number } {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
}

export const FLOATING_DOCK_TAB_HEIGHT = FLOATING_BALL_SIZE;
export const FLOATING_DOCK_TAB_FILL = "#75757F";
