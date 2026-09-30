/**
 * Observation-frame overlay geometry and window construction.
 *
 * Source: `deepseek-harness-orb` commit `72f1d738458a223696685a909e806b683eff5885`,
 * `apps/desktop/src/observation-frame-window.ts` (MIT — see `THIRD_PARTY_NOTICES.md` §3.5), with the
 * renderer surface from `apps/desktop/renderer/observation-frame.{html,css}`.
 *
 * Why this exists at all: once the Orb hides for a desktop task, nothing on screen says *which*
 * window the next action will land on. The panel shows the target by name and the user can revoke,
 * but a name is not a place. The ribbon draws the observation rectangle around the actual window, so
 * the grant is visible where it applies.
 *
 * The two properties the reference guarantees and P2-01's acceptance criterion names — the ribbon
 * must not block input, and it must not appear in the user's own screenshots — come from
 * `setIgnoreMouseEvents(true, { forward: true })` and `setContentProtection(true)` respectively.
 * Both are applied in `createObservationFrameWindow` and re-asserted in `showObservationFrame`,
 * because showing a window can restack it.
 */
import { BrowserWindow, screen } from "electron";

/** Stroke width painted on `#frame`; keep in sync with the renderer CSS `#frame` padding fallback. */
export const OBSERVATION_FRAME_STROKE_PX = 8;

/** Gutter around the stroke so `filter: drop-shadow` is not clipped by the window. Keep in sync with the `body` padding fallback. */
export const OBSERVATION_FRAME_GLOW_PX = 28;

/** Logical points the frame window extends past each edge of the observation rectangle. */
export const OBSERVATION_FRAME_OUTSET = OBSERVATION_FRAME_STROKE_PX + OBSERVATION_FRAME_GLOW_PX;

/** Always-on-top level shared with the floating overlay. */
export const OVERLAY_ALWAYS_ON_TOP_LEVEL = "floating" as const;

/** Keep the ribbon below the floating overlay. */
export const OBSERVATION_FRAME_ALWAYS_ON_TOP_RELATIVE = 0;

export interface OverlayRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Per-edge CSS padding in logical pixels (top, right, bottom, left). */
export interface ObservationFrameEdgePadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Electron content rectangle plus the body glow and `#frame` stroke that keep the inner hole on the observation rectangle. */
export interface ObservationFramePlacement {
  readonly bounds: OverlayRect;
  readonly glow: ObservationFrameEdgePadding;
  readonly stroke: ObservationFrameEdgePadding;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function workAreaOf(point: { readonly x: number; readonly y: number }): OverlayRect {
  return screen.getDisplayNearestPoint({ x: Math.round(point.x), y: Math.round(point.y) }).workArea;
}

function intersectRects(area: OverlayRect, clip: OverlayRect): OverlayRect {
  const x = Math.max(area.x, clip.x);
  const y = Math.max(area.y, clip.y);
  const right = Math.min(area.x + area.width, clip.x + clip.width);
  const bottom = Math.min(area.y + area.height, clip.y + clip.height);
  const width = right - x;
  const height = bottom - y;
  if (width >= 1 && height >= 1) return { x, y, width, height };
  return {
    x: clamp(area.x, clip.x, clip.x + clip.width - 1),
    y: clamp(area.y, clip.y, clip.y + clip.height - 1),
    width: 1,
    height: 1,
  };
}

function edgePadding(inset: number): { readonly glow: number; readonly stroke: number } {
  const leftover = Math.max(0, Math.round(inset));
  return { glow: Math.max(0, leftover - OBSERVATION_FRAME_STROKE_PX), stroke: OBSERVATION_FRAME_STROKE_PX };
}

/**
 * Body glow and `#frame` stroke padding so the inner hole stays on `region`.
 *
 * A flush edge (no leftover outset) uses the stroke just inside that edge, which is why the padding
 * is computed from the region *and* the actual bounds rather than from the outset alone: clipping at
 * a work-area edge moves the bounds without moving the region.
 */
export function observationFramePadding(
  region: OverlayRect,
  bounds: OverlayRect,
): { readonly glow: ObservationFrameEdgePadding; readonly stroke: ObservationFrameEdgePadding } {
  const left = edgePadding(region.x - bounds.x);
  const top = edgePadding(region.y - bounds.y);
  const right = edgePadding(bounds.x + bounds.width - (region.x + region.width));
  const bottom = edgePadding(bounds.y + bounds.height - (region.y + region.height));
  return {
    glow: { top: top.glow, right: right.glow, bottom: bottom.glow, left: left.glow },
    stroke: { top: top.stroke, right: right.stroke, bottom: bottom.stroke, left: left.stroke },
  };
}

/**
 * Convert a Windows observation rectangle from physical pixels to Electron DIP.
 *
 * The Windows backend reports physical pixels; Electron positions windows in DIP, so on a scaled
 * display the two differ and the ribbon would sit offset from the window it describes. macOS already
 * reports logical points, so the reference leaves it alone.
 */
export function observationFrameRegion(region: OverlayRect): OverlayRect {
  if (process.platform !== "win32") return region;
  return screen.screenToDipRect(null, {
    x: Math.round(region.x),
    y: Math.round(region.y),
    width: Math.round(region.width),
    height: Math.round(region.height),
  });
}

/**
 * Inflate the observation union so the stroke and glow sit just outside it, then intersect the work
 * area. Intersection clips an edge that would leave the work area; it does not translate the overlay
 * and keep its size, because a translated ribbon would point at the wrong pixels.
 */
export function observationFramePlacement(
  region: OverlayRect,
  workArea: OverlayRect = workAreaOf({ x: region.x + region.width / 2, y: region.y + region.height / 2 }),
): ObservationFramePlacement {
  const inflated = {
    x: Math.round(region.x - OBSERVATION_FRAME_OUTSET),
    y: Math.round(region.y - OBSERVATION_FRAME_OUTSET),
    width: Math.max(1, Math.round(region.width + OBSERVATION_FRAME_OUTSET * 2)),
    height: Math.max(1, Math.round(region.height + OBSERVATION_FRAME_OUTSET * 2)),
  };
  const bounds = intersectRects(inflated, workArea);
  const padding = observationFramePadding(region, bounds);
  return { bounds, glow: padding.glow, stroke: padding.stroke };
}

/**
 * Build the CSS custom-property assignments the ribbon renderer reads.
 *
 * The padding is delivered by script rather than baked into the page because it depends on the
 * *actual* content bounds after clipping, which only exist once the window has been placed.
 */
export function observationFrameCssScript(
  glow: ObservationFrameEdgePadding,
  stroke: ObservationFrameEdgePadding,
): string {
  const vars: ReadonlyArray<readonly [string, number]> = [
    ["--glow-top", glow.top],
    ["--glow-right", glow.right],
    ["--glow-bottom", glow.bottom],
    ["--glow-left", glow.left],
    ["--stroke-top", stroke.top],
    ["--stroke-right", stroke.right],
    ["--stroke-bottom", stroke.bottom],
    ["--stroke-left", stroke.left],
  ];
  const assignments = vars
    .map(([name, value]) => `root.setProperty(${JSON.stringify(name)}, ${JSON.stringify(`${String(value)}px`)});`)
    .join("");
  return `(() => { const root = document.documentElement.style; ${assignments} })()`;
}

const pendingFrameCss = new WeakMap<
  BrowserWindow,
  { readonly glow: ObservationFrameEdgePadding; readonly stroke: ObservationFrameEdgePadding }
>();
const waitingForFrameLoad = new WeakSet<BrowserWindow>();

function applyObservationFrameCss(
  window: BrowserWindow,
  glow: ObservationFrameEdgePadding,
  stroke: ObservationFrameEdgePadding,
): void {
  pendingFrameCss.set(window, { glow, stroke });
  const applyLatest = (): void => {
    waitingForFrameLoad.delete(window);
    if (window.isDestroyed()) return;
    const latest = pendingFrameCss.get(window);
    if (latest === undefined) return;
    void window.webContents
      .executeJavaScript(observationFrameCssScript(latest.glow, latest.stroke))
      .catch(() => {
        // `executeJavaScript` rejects while the document is not yet the frame page; retry once after
        // load rather than dropping the padding, which would leave the ribbon with stale edges.
        if (window.isDestroyed() || waitingForFrameLoad.has(window)) return;
        waitingForFrameLoad.add(window);
        window.webContents.once("did-finish-load", applyLatest);
      });
  };
  if (window.webContents.isLoading()) {
    if (!waitingForFrameLoad.has(window)) {
      waitingForFrameLoad.add(window);
      window.webContents.once("did-finish-load", applyLatest);
    }
    return;
  }
  applyLatest();
}

/**
 * Construct the hollow observation-frame panel. The caller loads the frame page into it.
 *
 * Always click-through and non-focusable: the whole point is that the desktop action reaches the
 * target app rather than this chrome, and that showing the ribbon never steals focus from the window
 * the user is working in. `roundedCorners: false` keeps a work-area-flush stroke from being
 * round-clipped at the screen corners.
 */
export function createObservationFrameWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1,
    height: 1,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    ...(process.platform === "win32" ? {} : { type: "panel" as const }),
    show: false,
    hasShadow: false,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    roundedCorners: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  if (process.platform === "darwin") {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  }
  window.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL, OBSERVATION_FRAME_ALWAYS_ON_TOP_RELATIVE);
  // The ribbon must not appear in the user's own screenshots; the reference protects it on Windows.
  if (process.platform === "win32") window.setContentProtection(true);
  window.setIgnoreMouseEvents(true, { forward: true });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  return window;
}

/**
 * Place the ribbon around the observation rectangle without activating the window.
 *
 * `showInactive` is what keeps this from stealing focus; the padding is then computed from the
 * *actual* content rectangle, since a work-area clip can shift the edges after placement.
 */
export function showObservationFrame(window: BrowserWindow, region: OverlayRect): void {
  if (window.isDestroyed()) return;
  const logical = observationFrameRegion(region);
  const placement = observationFramePlacement(logical);
  window.setContentBounds(placement.bounds);
  window.setIgnoreMouseEvents(true, { forward: true });
  window.showInactive();
  window.setAlwaysOnTop(true, OVERLAY_ALWAYS_ON_TOP_LEVEL, OBSERVATION_FRAME_ALWAYS_ON_TOP_RELATIVE);
  const padding = observationFramePadding(logical, window.getContentBounds());
  applyObservationFrameCss(window, padding.glow, padding.stroke);
}

/**
 * Keep the floating overlay above the ribbon.
 *
 * `showInactive` on the ribbon can restack same-level panels, so the overlay's higher relative level
 * is re-asserted after every show rather than only at creation.
 */
export function raiseOverlayAboveObservationFrame(overlay: BrowserWindow | undefined): void {
  const level = process.platform === "win32" ? ("screen-saver" as const) : OVERLAY_ALWAYS_ON_TOP_LEVEL;
  const relative = process.platform === "win32" ? undefined : OBSERVATION_FRAME_ALWAYS_ON_TOP_RELATIVE + 1;
  if (overlay !== undefined && !overlay.isDestroyed()) {
    overlay.setAlwaysOnTop(true, level, relative);
    overlay.moveTop();
  }
}

/** Hide the ribbon when it is still alive. */
export function hideObservationFrame(window: BrowserWindow | undefined): void {
  if (window === undefined || window.isDestroyed()) return;
  window.hide();
}
