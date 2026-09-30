import type {
  DesktopAction,
  DesktopObservation,
  ScreenshotPosition,
} from "@shared/orb-tools";
import { validateCapture, type ScreenshotImage } from "@shared/screenshot";
import { POST_ACTION_WAIT_MS, WAIT_SECONDS } from "@shared/orb-tools";
import { delay } from "./reference-windows/wait";
import type { ActResult, DesktopDriver, ObserveResult } from "./desktop-task";
import type { CapturedScreen, DesktopBackend, DesktopForeground, ScreenInfo } from "./reference-windows/backend";
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

export interface ReferenceWindowsDriverOptions {
  readonly backend: DesktopBackend;
  readonly ops: WindowsDesktopOps;
  readonly ownProcessId: number;
  /** Hide or cloak the Orb while the target is captured or receives HID input. */
  readonly withGuiTurn?: <T>(run: () => Promise<T>) => Promise<T>;
  /**
   * Called after `orb_open_app` moved the task to another application's window.
   *
   * The driver reports the adopted application so the observation frame and shell diagnostics
   * follow the fresh observation returned to the model.
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

function positionOf(position: ScreenshotPosition): [number, number] {
  return [position.x, position.y];
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
 * Each observation records the current foreground window; actions stay bound to that observation.
 */
export class ReferenceWindowsDriver implements DesktopDriver {
  readonly #options: ReferenceWindowsDriverOptions;
  #observation: DesktopObservation | null = null;
  #screen: ScreenInfo | null = null;
  #target: TargetWindow | null = null;

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
   * The screen rectangle from the latest observation, or undefined when no target is recorded.
   *
   * Exposed so the shell can draw the observation ribbon around the window in the latest screenshot.
   * The bounds are the driver's own `TargetWindow.bounds`, i.e. the same rectangle actions are mapped
   * on, so the ribbon cannot drift from where input actually goes.
   */
  targetBounds(): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined {
    return this.#target?.bounds;
  }

  async observe(input: { readonly includeImage?: boolean }): Promise<ObserveResult> {
    try {
      const result = await this.#withGuiTurn(async () => {
        const target = this.#findForegroundTarget();
        if (!target) throw new Error("No foreground application window is available to observe.");
        if (!this.#options.ops.focusWindow(target.windowId)) {
          throw new Error("The target window could not be brought to the foreground.");
        }
        const screens = await this.#options.backend.listScreens();
        const screen = screens.find((candidate) => candidate.windowId === target.windowId) ?? screens[0];
        if (!screen || screen.windowId !== target.windowId) {
          throw new Error("The reference backend did not select the recorded target window.");
        }
        const captured = await this.#options.backend.capture(screen);
        const observation = this.#makeObservation(target, screen, captured, input.includeImage === true,
          await this.#options.backend.inspectForeground());
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
    if (action.kind === "openApp") return this.#openApp(action, target, signal);
    try {
      const abort = signal ?? new AbortController().signal;
      if (action.kind === "wait" || action.kind === "longWait") {
        await delay((action.kind === "wait" ? WAIT_SECONDS : action.waitSeconds) * 1000, abort);
      }
      const apps = action.kind === "listApps" ? [...await this.#options.backend.listApps(abort)] : undefined;
      const observationAfterAction = await this.#withGuiTurn(async () => {
        if (!this.#isCurrentForeground(target)) {
          throw new Error("The foreground window changed after the observation. Observe again before acting.");
        }
        if (!this.#options.ops.focusWindow(target.windowId)) {
          throw new Error("The target window could not be brought to the foreground.");
        }
        if (action.kind === "click") {
          await this.#options.backend.click({ screen, position: positionOf(action.position), button: action.button ?? "left", count: action.count ?? 1,
            ...(action.modifiers ? { modifiers: action.modifiers } : {}) }, signal);
        } else if (action.kind === "type") {
          await this.#options.backend.typeText({ screen, position: positionOf(action.position), text: action.text, replace: action.replace ?? false, submit: action.submit ?? false }, signal);
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
        } else if (action.kind === "scroll") {
          await this.#options.backend.scroll({
            screen,
            position: positionOf(action.position),
            direction: action.direction,
            scrollLevel: action.amount,
          }, signal);
        }
        if (action.kind !== "wait" && action.kind !== "longWait" && action.kind !== "listApps") await delay(POST_ACTION_WAIT_MS, abort);
        if (!this.#isCurrentForeground(target)) {
          throw new Error("The foreground window changed during the action. Observe again before acting.");
        }
        const captured = await this.#options.backend.capture(screen, signal);
        const nextObservation = this.#makeObservation(target, screen, captured, true,
          await this.#options.backend.inspectForeground(signal));
        this.#observation = nextObservation;
        return nextObservation;
      });
      return { ok: true, refused: false, error: null, observation: observationAfterAction, ...(apps ? { apps } : {}) };
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
    // No position survives between actions: input_text always names its own target.
  }

  get lastObservation(): DesktopObservation | null {
    return this.#observation;
  }

  #makeObservation(
    target: TargetWindow,
    screen: ScreenInfo,
    captured: CapturedScreen,
    includeImage: boolean,
    foreground: DesktopForeground,
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
      foreground,
      elementsUnavailable: true,
      degraded: false,
    };
  }

  /**
   * Bring an already running application forward and continue against its window.
   *
   * The reference backend's `openApp` activates a running application *or launches it*. pi-orb
   * keeps only the first half: starting a process is separate authority, so this path never reaches
   * `launch`. It therefore uses
   * {@link WindowsDesktopOps.activateApp}, which returns `false` instead of starting anything,
   * and it fails closed at three separate points:
   *
   *   1. the requested application must appear in the running-application list, compared as a base
   *      name (`Notepad` == `notepad.exe`) and never as a substring;
   *   2. the activation itself must succeed;
   *   3. the resulting foreground window must belong to that application — otherwise the current
   *      observation stays authoritative and the action fails.
   *
   * On success the adopted window is reported through `onTargetChanged`; the grant remains bound to
   * the Orb session and generation while later observations follow the foreground application.
   */
  async #openApp(action: { readonly name: string }, currentTarget: TargetWindow, signal?: AbortSignal): Promise<ActResult> {
    try {
      const abort = signal ?? new AbortController().signal;
      abort.throwIfAborted();
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
        abort.throwIfAborted();
        if (!this.#isCurrentForeground(currentTarget)) {
          throw new Error("The foreground window changed after the observation. Observe again before switching apps.");
        }
        if (!this.#options.ops.activateApp(match)) {
          throw new Error(`"${requested}" could not be brought to the foreground.`);
        }
        // Match the reference tool's post-action settle before inspecting and recapturing the
        // newly activated application. Without this delay a slow window manager can return the
        // previous foreground surface as the "fresh" observation.
        await delay(POST_ACTION_WAIT_MS, abort);
        const foreground = this.#findForegroundTarget();
        if (!foreground || !sameApp(foreground.appName, match)) {
          throw new Error(
            `"${requested}" did not become the foreground window, so the target was left unchanged.`,
          );
        }
        const screens = await this.#options.backend.listScreens(abort);
        const screen = screens.find((candidate) => candidate.windowId === foreground.windowId);
        if (!screen) throw new Error(`No observation surface is available for "${requested}".`);
        const captured = await this.#options.backend.capture(screen, abort);
        abort.throwIfAborted();
        const next = this.#makeObservation(foreground, screen, captured, true,
          await this.#options.backend.inspectForeground(abort));
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

  /**
   * The window the OS currently reports as foreground, if it is one this process may observe.
   *
   * Observation adopts the current foreground application and excludes the Orb itself. Later actions
   * remain bound to that observation and refuse if foreground identity changes before input is sent.
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

  #isCurrentForeground(expected: TargetWindow): boolean {
    const foreground = this.#findForegroundTarget();
    return foreground !== null &&
      foreground.windowId === expected.windowId &&
      foreground.pid === expected.pid &&
      foreground.title === expected.title;
  }

  #withGuiTurn<T>(run: () => Promise<T>): Promise<T> {
    return this.#options.withGuiTurn ? this.#options.withGuiTurn(run) : run();
  }
}
