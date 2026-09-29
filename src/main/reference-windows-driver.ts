import type {
  DesktopAction,
  DesktopObservation,
  ScreenshotPosition,
} from "@shared/orb-tools";
import { SCREENSHOT_CENTRE } from "@shared/orb-tools";
import type { ActResult, DesktopDriver, ObserveResult } from "./desktop-task";
import type { DesktopBackend, ScreenInfo } from "./reference-windows/backend";
import type { WindowsDesktopOps } from "./reference-windows/windows";

export interface ReferenceWindowInfo {
  readonly windowId: number;
  readonly pid: number;
  readonly appName: string;
  readonly title: string;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly isOnScreen: boolean;
  readonly zIndex: bigint;
}

export interface ReferenceRecordedTarget {
  readonly handle: string;
  readonly pid: number;
  readonly title: string;
}

export interface ReferenceWindowsDriverOptions {
  readonly backend: DesktopBackend;
  readonly ops: WindowsDesktopOps;
  readonly ownProcessId: number;
  readonly resolveRecordedTarget?: () => ReferenceRecordedTarget | undefined;
  /** Hide or cloak the Orb while the target is captured or receives HID input. */
  readonly withGuiTurn?: <T>(run: () => Promise<T>) => Promise<T>;
}

interface TargetWindow {
  readonly windowId: number;
  readonly pid: number;
  readonly appName: string;
  readonly title: string;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

let observationCounter = 0;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hwndFromString(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function positionOf(position: ScreenshotPosition | undefined): [number, number] {
  const point = position ?? SCREENSHOT_CENTRE;
  return [point.x, point.y];
}

/**
 * pi-orb's narrow driver seam over the reference project's Windows backend.
 * Window identity is still owned by the Orb: the backend is never asked to guess a target.
 */
export class ReferenceWindowsDriver implements DesktopDriver {
  readonly #options: ReferenceWindowsDriverOptions;
  #observation: DesktopObservation | null = null;
  #screen: ScreenInfo | null = null;
  #target: TargetWindow | null = null;
  #lastInputPosition: [number, number] = positionOf(undefined);

  constructor(options: ReferenceWindowsDriverOptions) {
    this.#options = options;
  }

  listWindows(): ReferenceWindowInfo[] {
    const snapshot = this.#options.ops.listWindows();
    return snapshot.windows
      .map((window, index) => ({
        windowId: window.hwnd,
        pid: window.pid,
        appName: window.appName,
        title: window.title,
        bounds: window.frame,
        isOnScreen: window.visible && !window.iconic && !window.cloaked && window.frame.width > 0 && window.frame.height > 0,
        zIndex: BigInt(snapshot.windows.length - index),
      }))
      .filter((window) => window.pid !== this.#options.ownProcessId && window.isOnScreen);
  }

  async observe(input: { readonly windowId?: string }): Promise<ObserveResult> {
    const target = this.#findTarget(input.windowId);
    if (!target) {
      return {
        ok: false,
        observation: null,
        error: "The identified target window is not available. Select or record it again before observing.",
      };
    }
    try {
      const result = await this.#withGuiTurn(async () => {
        if (!this.#options.ops.focusWindow(target.windowId)) {
          throw new Error("The target window could not be brought to the foreground.");
        }
        const screens = await this.#options.backend.listScreens();
        const screen = screens.find((candidate) => candidate.windowId === target.windowId) ?? screens[0];
        if (!screen || screen.windowId !== target.windowId) {
          throw new Error("The reference backend did not select the recorded target window.");
        }
        // Force the same capture path used by the reference tool. The image is intentionally not
        // forwarded here because pi-orb's screenshot consent flow owns model attachments.
        await this.#options.backend.capture(screen);
        const observation: DesktopObservation = {
          observationId: `obs-${Date.now().toString(36)}-${++observationCounter}`,
          at: Date.now(),
          window: {
            id: String(target.windowId),
            pid: target.pid,
            title: target.title,
            appName: target.appName,
            bounds: target.bounds,
          },
          coordinateSpace: {
            action: "screenshot-fraction",
            space: 1000,
            windowRect: { x: 0, y: 0, width: screen.bounds.width, height: screen.bounds.height },
          },
          elements: [],
          elementsUnavailable: true,
          degraded: false,
        };
        this.#target = target;
        this.#screen = screen;
        this.#observation = observation;
        return observation;
      });
      return { ok: true, observation: result, error: null };
    } catch (error) {
      this.consumeObservation();
      return { ok: false, observation: null, error: message(error) };
    }
  }

  async act(action: DesktopAction, observation: DesktopObservation, signal?: AbortSignal): Promise<ActResult> {
    const screen = this.#screen;
    const target = this.#target;
    if (!screen || !target || observation.window.id !== String(target.windowId)) {
      return { ok: false, refused: true, error: "The observation target is no longer available." };
    }
    try {
      await this.#withGuiTurn(async () => {
        if (!this.#options.ops.focusWindow(target.windowId)) {
          throw new Error("The target window could not be brought to the foreground.");
        }
        if (action.kind === "click") {
          if (action.elementToken) throw new Error("Element-addressed clicks are unavailable in the Windows backend; use a screenshot position.");
          if (!action.position) throw new Error("A click needs a screenshot position.");
          this.#lastInputPosition = positionOf(action.position);
          await this.#options.backend.click({ screen, position: this.#lastInputPosition, button: "left", count: 1 }, signal);
          return;
        }
        if (action.kind === "type") {
          if (action.elementToken) throw new Error("Element-addressed typing is unavailable in the Windows backend; click the field first.");
          await this.#options.backend.typeText({ screen, position: this.#lastInputPosition, text: action.text, replace: false, submit: false }, signal);
          return;
        }
        if (action.direction === "left" || action.direction === "right") {
          throw new Error("The Windows backend supports vertical scrolling only.");
        }
        await this.#options.backend.scroll({
          screen,
          position: positionOf(action.position),
          direction: action.direction,
          scrollLevel: action.amount,
        }, signal);
      });
      return { ok: true, refused: false, error: null };
    } catch (error) {
      return { ok: false, refused: false, error: message(error) };
    }
  }

  consumeObservation(): void {
    this.#observation = null;
    this.#screen = null;
    this.#target = null;
  }

  resetActionContext(): void {
    this.#lastInputPosition = positionOf(undefined);
  }

  get lastObservation(): DesktopObservation | null {
    return this.#observation;
  }

  #findTarget(windowId?: string): TargetWindow | null {
    const recorded = this.#options.resolveRecordedTarget?.();
    const selected = recorded ? hwndFromString(recorded.handle) : undefined;
    const requested = windowId ? hwndFromString(windowId) : selected;
    if (requested === undefined) return null;
    // The model may name the observation it wants to read, but it cannot expand the
    // user's approved target. The explicit id must still be the target selected by Orb.
    if (selected !== undefined && requested !== selected) return null;
    const windows = this.#options.ops.listWindows().windows;
    const fact = windows.find((window) => {
      if (window.hwnd !== requested || window.pid === this.#options.ownProcessId) return false;
      if (recorded) return window.pid === recorded.pid && window.title === recorded.title;
      return true;
    });
    if (!fact || !fact.visible || fact.iconic || fact.cloaked || fact.frame.width <= 0 || fact.frame.height <= 0) return null;
    return { windowId: fact.hwnd, pid: fact.pid, appName: fact.appName, title: fact.title, bounds: fact.frame };
  }

  #withGuiTurn<T>(run: () => Promise<T>): Promise<T> {
    return this.#options.withGuiTurn ? this.#options.withGuiTurn(run) : run();
  }
}
