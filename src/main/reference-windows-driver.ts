import type {
  DesktopAction,
  DesktopObservation,
  ScreenshotPosition,
} from "@shared/orb-tools";
import { validateCapture, type ScreenshotImage } from "@shared/screenshot";
import { SCREENSHOT_CENTRE } from "@shared/orb-tools";
import type { ActResult, DesktopDriver, ObserveResult } from "./desktop-task";
import type { CapturedScreen, DesktopBackend, ScreenInfo } from "./reference-windows/backend";
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
  /**
   * Called after `orb_open_app` moved the task to another application's window.
   *
   * The Orb owns target identity, so a driver-side retarget has to be reported rather than kept
   * private: the panel shows the window every subsequent action will land on.
   */
  readonly onTargetChanged?: (target: ReferenceWindowInfo) => void;
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
 * Compare an application label with a process base name.
 *
 * The model may write `Notepad` or `notepad.exe` for the same application, so the comparison is
 * case-insensitive and ignores a single trailing `.exe`. It is deliberately an equality test and
 * not a substring test: a substring match would let `notepad` select an unrelated process or a
 * window whose *title* merely contains the word, which is the class of wrong-target failure this
 * product must not have.
 */
function sameApp(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const lowered = value.trim().toLowerCase();
    return lowered.endsWith(".exe") ? lowered.slice(0, -4) : lowered;
  };
  const a = normalize(left);
  return a.length > 0 && a === normalize(right);
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

  /**
   * The screen rectangle of the window the next action would land on, or undefined when no target is
   * recorded.
   *
   * Exposed so the shell can draw the observation ribbon around the window the grant covers. The
   * bounds are the driver's own `TargetWindow.bounds`, i.e. the same rectangle actions are mapped on,
   * so the ribbon cannot drift from where input actually goes.
   */
  targetBounds(): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined {
    return this.#target?.bounds;
  }

  async observe(input: { readonly windowId?: string; readonly includeImage?: boolean }): Promise<ObserveResult> {
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
        const captured = await this.#options.backend.capture(screen);
        const observation = this.#makeObservation(target, screen, captured, input.includeImage === true);
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
    if (action.kind === "openApp") return this.#openApp(action, signal);
    try {
      const observationAfterAction = await this.#withGuiTurn(async () => {
        if (!this.#options.ops.focusWindow(target.windowId)) {
          throw new Error("The target window could not be brought to the foreground.");
        }
        if (action.kind === "click") {
          if (action.elementToken) throw new Error("Element-addressed clicks are unavailable in the Windows backend; use a screenshot position.");
          if (!action.position) throw new Error("A click needs a screenshot position.");
          this.#lastInputPosition = positionOf(action.position);
          await this.#options.backend.click({ screen, position: this.#lastInputPosition, button: "left", count: 1 }, signal);
        } else if (action.kind === "type") {
          if (action.elementToken) throw new Error("Element-addressed typing is unavailable in the Windows backend; click the field first.");
          await this.#options.backend.typeText({ screen, position: this.#lastInputPosition, text: action.text, replace: false, submit: false }, signal);
        } else if (action.kind === "hotkey") {
          await this.#options.backend.hotkey({ keys: action.keys }, signal);
        } else if (action.kind === "longPress") {
          await this.#options.backend.longPress({
            screen,
            position: positionOf(action.position),
            durationSeconds: action.durationSeconds,
          }, signal);
        } else if (action.kind === "drag") {
          await this.#options.backend.drag({
            startScreen: screen,
            startPosition: positionOf(action.startPosition),
            endScreen: screen,
            endPosition: positionOf(action.endPosition),
          }, signal);
        } else {
          if (action.direction === "left" || action.direction === "right") {
            throw new Error("The Windows backend supports vertical scrolling only.");
          }
          await this.#options.backend.scroll({
            screen,
            position: positionOf(action.position),
            direction: action.direction,
            scrollLevel: action.amount,
          }, signal);
        }
        const captured = await this.#options.backend.capture(screen, signal);
        const nextObservation = this.#makeObservation(target, screen, captured, true);
        this.#observation = nextObservation;
        return nextObservation;
      });
      return { ok: true, refused: false, error: null, observation: observationAfterAction };
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

  #makeObservation(
    target: TargetWindow,
    screen: ScreenInfo,
    captured: CapturedScreen,
    includeImage: boolean,
  ): DesktopObservation {
    let image: ScreenshotImage | undefined;
    if (includeImage) {
      image = {
        data: Buffer.from(captured.data).toString("base64"),
        mimeType: captured.mediaType,
        width: Math.round(screen.bounds.width),
        height: Math.round(screen.bounds.height),
      };
      const validation = validateCapture(image);
      if (!validation.ok) throw new Error(validation.message);
    }
    return {
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
      ...(image ? { image } : {}),
      elementsUnavailable: true,
      degraded: false,
    };
  }

  /**
   * Bring an already running application forward and continue against its window.
   *
   * The reference backend's `openApp` activates a running application *or launches it*. pi-orb
   * keeps only the first half: starting a process is native authority the user did not grant when
   * they recorded one window, so this path never reaches `launch`. It therefore uses
   * {@link WindowsDesktopOps.activateApp}, which returns `false` instead of starting anything,
   * and it fails closed at three separate points:
   *
   *   1. the requested application must appear in the running-application list, compared as a base
   *      name (`Notepad` == `notepad.exe`) and never as a substring;
   *   2. the activation itself must succeed;
   *   3. the resulting foreground window must belong to that application — otherwise the previous
   *      target is kept and the action fails, because adopting whatever happens to be in front is
   *      exactly the "driver picked a target" behaviour this project forbids.
   *
   * On success the adopted window is reported through `onTargetChanged` so the panel shows where
   * the next action will land, and the user can revoke at any time.
   */
  async #openApp(action: { readonly name: string }, signal?: AbortSignal): Promise<ActResult> {
    try {
      signal?.throwIfAborted();
      const requested = action.name.trim();
      const running = this.#options.ops.listWindowApps();
      const match = running.find((name) => sameApp(name, requested));
      if (match === undefined) {
        return {
          ok: false,
          refused: false,
          error: `"${requested}" is not running. pi-orb only brings an already running application forward and does not launch new ones.`,
        };
      }

      const adopted = await this.#withGuiTurn(async () => {
        signal?.throwIfAborted();
        if (!this.#options.ops.activateApp(match)) {
          throw new Error(`"${requested}" could not be brought to the foreground.`);
        }
        const foreground = this.#findForegroundTarget();
        if (!foreground || !sameApp(foreground.appName, match)) {
          throw new Error(
            `"${requested}" did not become the foreground window, so the target was left unchanged.`,
          );
        }
        const screens = await this.#options.backend.listScreens(signal);
        const screen = screens.find((candidate) => candidate.windowId === foreground.windowId);
        if (!screen) throw new Error(`No observation surface is available for "${requested}".`);
        const captured = await this.#options.backend.capture(screen, signal);
        signal?.throwIfAborted();
        const next = this.#makeObservation(foreground, screen, captured, true);
        this.#target = foreground;
        this.#screen = screen;
        this.#observation = next;
        this.#options.onTargetChanged?.({
          windowId: foreground.windowId,
          pid: foreground.pid,
          appName: foreground.appName,
          title: foreground.title,
          bounds: foreground.bounds,
          isOnScreen: true,
          zIndex: BigInt(0),
        });
        return next;
      });
      return { ok: true, refused: false, error: null, observation: adopted };
    } catch (error) {
      return { ok: false, refused: false, error: message(error) };
    }
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

  /**
   * The window the OS currently reports as foreground, if it is one this process may act on.
   *
   * Only the open-app path uses this, and only to *verify* what an activation produced — the
   * ordinary action path never asks the OS which window is in front, because accepting that answer
   * would let the desktop decide the target instead of the user. The Orb's own window is excluded,
   * and so is a window that cannot own an observation.
   */
  #findForegroundTarget(): TargetWindow | null {
    const snapshot = this.#options.ops.listWindows();
    const foreground = snapshot.windows.find((window) => window.hwnd === snapshot.foregroundHwnd);
    if (!foreground || foreground.pid === this.#options.ownProcessId) return null;
    if (!foreground.visible || foreground.iconic || foreground.cloaked) return null;
    if (foreground.frame.width <= 0 || foreground.frame.height <= 0) return null;
    return {
      windowId: foreground.hwnd,
      pid: foreground.pid,
      appName: foreground.appName,
      title: foreground.title,
      bounds: foreground.frame,
    };
  }

  #withGuiTurn<T>(run: () => Promise<T>): Promise<T> {
    return this.#options.withGuiTurn ? this.#options.withGuiTurn(run) : run();
  }
}
