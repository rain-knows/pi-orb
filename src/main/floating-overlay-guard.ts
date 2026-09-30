/**
 * Source: rain-knows/deepseek-harness-orb, MIT, Copyright (c) 2026 DeepSeek.
 * Commit: 72f1d738458a223696685a909e806b683eff5885.
 * apps/desktop/src/floating-window.ts:848-868,906-961, extracted without algorithm changes.
 * Pi adaptation: the main process pairs intervals directly instead of DSH host IPC.
 */
import type { BrowserWindow } from 'electron'
/** Overlay chrome mode for one Computer Use capture or HID burst. */
export type FloatingOverlayGuardMode = 'capture' | 'input'

/** Begin or end one overlay-guard interval. */
export type FloatingOverlayGuardAction = 'begin' | 'end'

interface OverlayGuardCounts {
  capture: number
  input: number
}

const overlayGuardCounts = new WeakMap<BrowserWindow, OverlayGuardCounts>()
const overlayClickThrough = new WeakMap<BrowserWindow, boolean>()

function countsOf(window: BrowserWindow): OverlayGuardCounts {
  const existing = overlayGuardCounts.get(window)
  if (existing !== undefined) return existing
  const created: OverlayGuardCounts = { capture: 0, input: 0 }
  overlayGuardCounts.set(window, created)
  return created
}

/** Milliseconds Electron waits after click-through before acking input begin, so WindowServer hit-testing has committed. */
export const OVERLAY_GUARD_INPUT_APPLY_MS = 80

function syncOverlayGuard(window: BrowserWindow, counts: OverlayGuardCounts): void {
  if (window.isDestroyed()) return
  // Windows GDI honors WDA_EXCLUDEFROMCAPTURE. Hold it for capture and for HID,
  // because the post-action screenshot runs inside the input cloak and does not send a second capture begin.
  // macOS exclusion stays on ScreenCaptureKit ids.
  window.setContentProtection(process.platform === 'win32' && (counts.capture > 0 || counts.input > 0))
  const clickThrough = counts.input > 0
  if (overlayClickThrough.get(window) === clickThrough) return
  overlayClickThrough.set(window, clickThrough)
  if (clickThrough) {
    window.setIgnoreMouseEvents(true, { forward: false })
    window.blur()
    return
  }
  window.setIgnoreMouseEvents(false)
}

/**
 * Apply or restore overlay click-through for one Computer Use HID interval.
 * Capture begin still refcounts so overlapping sessions stay paired with their ends.
 * macOS omits the overlay with {@link overlayWindowExcludeIds}. Windows sets
 * `contentProtection` for capture and for the HID interval that wraps recapture.
 * HID click-through does not forward mouse events into the overlay renderer.
 * Overlapping begins are refcounted. Click-through and blur apply only when the
 * input count crosses zero, so nested capture IPC during a HID turn does not flash the overlay.
 * @param window - floating overlay.
 * @param mode - capture exclusion or HID click-through.
 * @param action - increment or decrement that mode's count.
 */
export function applyFloatingOverlayGuard(
  window: BrowserWindow,
  mode: FloatingOverlayGuardMode,
  action: FloatingOverlayGuardAction,
): void {
  if (window.isDestroyed()) return
  const counts = countsOf(window)
  if (action === 'begin') counts[mode] += 1
  else counts[mode] = Math.max(0, counts[mode] - 1)
  syncOverlayGuard(window, counts)
}

/**
 * Drop every overlay-guard interval and restore hittable chrome.
 * Host exit uses this so a lost `end` cannot leave the ball click-through.
 * @param window - floating overlay.
 */
export function resetFloatingOverlayGuard(window: BrowserWindow): void {
  overlayGuardCounts.delete(window)
  overlayClickThrough.delete(window)
  if (window.isDestroyed()) return
  window.setContentProtection(false)
  window.setIgnoreMouseEvents(false)
}
