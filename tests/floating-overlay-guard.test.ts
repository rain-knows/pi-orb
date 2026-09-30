// Ported from deepseek-harness-orb/apps/desktop/tests/floating-window.spec.ts
// at 72f1d738458a223696685a909e806b683eff5885 (MIT, Copyright (c) 2026 DeepSeek).
import { describe, expect, it, vi } from 'vitest'
import { applyFloatingOverlayGuard, resetFloatingOverlayGuard } from '../src/main/floating-overlay-guard'
describe('floating overlay guard', () => {
  function overlayWindow() {
    return {
      destroyed: false,
      contentProtection: false,
      ignoreMouseEvents: false,
      ignoreMouseEventsForward: undefined as boolean | undefined,
      isDestroyed() { return this.destroyed },
      setContentProtection(value: boolean) { this.contentProtection = value },
      setIgnoreMouseEvents(value: boolean, options?: { forward?: boolean }) {
        this.ignoreMouseEvents = value
        this.ignoreMouseEventsForward = options?.forward
      },
      blur: vi.fn(),
    }
  }

  it('sets contentProtection on Windows during capture; HID stays click-through', () => {
    const window = overlayWindow()
    applyFloatingOverlayGuard(window as never, 'capture', 'begin')
    expect(window.contentProtection).toBe(process.platform === 'win32')
    expect(window.ignoreMouseEvents).toBe(false)
    applyFloatingOverlayGuard(window as never, 'capture', 'end')
    expect(window.contentProtection).toBe(false)
  })

  it('makes the overlay click-through only while input is held', () => {
    const window = overlayWindow()
    applyFloatingOverlayGuard(window as never, 'input', 'begin')
    expect(window.ignoreMouseEvents).toBe(true)
    expect(window.ignoreMouseEventsForward).toBe(false)
    expect(window.blur).toHaveBeenCalled()
    expect(window.contentProtection).toBe(process.platform === 'win32')
    applyFloatingOverlayGuard(window as never, 'input', 'end')
    expect(window.ignoreMouseEvents).toBe(false)
  })

  it('keeps click-through while a nested input begin is still open', () => {
    const window = overlayWindow()
    applyFloatingOverlayGuard(window as never, 'input', 'begin')
    applyFloatingOverlayGuard(window as never, 'input', 'begin')
    applyFloatingOverlayGuard(window as never, 'input', 'end')
    expect(window.ignoreMouseEvents).toBe(true)
    applyFloatingOverlayGuard(window as never, 'input', 'end')
    expect(window.ignoreMouseEvents).toBe(false)
  })

  it('does not blur again for nested capture while input is held', () => {
    const window = overlayWindow()
    applyFloatingOverlayGuard(window as never, 'input', 'begin')
    expect(window.blur).toHaveBeenCalledTimes(1)
    applyFloatingOverlayGuard(window as never, 'capture', 'begin')
    applyFloatingOverlayGuard(window as never, 'input', 'begin')
    applyFloatingOverlayGuard(window as never, 'capture', 'end')
    applyFloatingOverlayGuard(window as never, 'input', 'end')
    expect(window.blur).toHaveBeenCalledTimes(1)
    expect(window.ignoreMouseEvents).toBe(true)
    applyFloatingOverlayGuard(window as never, 'input', 'end')
    expect(window.ignoreMouseEvents).toBe(false)
  })

  it('resets both modes so Host exit cannot leave the overlay cloaked', () => {
    const window = overlayWindow()
    applyFloatingOverlayGuard(window as never, 'capture', 'begin')
    applyFloatingOverlayGuard(window as never, 'input', 'begin')
    resetFloatingOverlayGuard(window as never)
    expect(window.contentProtection).toBe(false)
    expect(window.ignoreMouseEvents).toBe(false)
  })

})
