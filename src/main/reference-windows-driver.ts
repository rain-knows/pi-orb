import { timeToolPhase, timeToolSync, logToolMetric } from "@shared/tool-timing";
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
import { selectWindowsObservation } from "./reference-windows/windows-foreground";
import { runWithCaptureExcludeWindowIds } from "./reference-windows/capture-exclude";
import type { CaptureTarget } from "@shared/screenshot";
import { homedir } from "node:os";
import { pairScreenshotFiles, writeDesktopScreenshots } from "./reference-windows/screenshot";
import { requireBrowserUrl, resolveFinderOpen } from "./reference-windows/open";
import { stat } from "node:fs/promises";

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
  /** Evidence runner injection only; production omits this and uses the reference default. */
  readonly postActionWaitMs?: number;
  /** Hide or cloak the Orb while the target is captured or receives HID input. */
  readonly withGuiTurn?: <T>(run: () => Promise<T>, signal?: AbortSignal) => Promise<T>;
  /**
   * Called whenever a fresh observation adopts a window, including after navigation.
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
    const snapshot = timeToolSync("window-enumeration", () => this.#options.ops.listWindows());
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

  /** Current topmost non-Orb window for the explicit screenshot preview. */
  captureTarget(): CaptureTarget | null {
    const snapshot = timeToolSync("window-enumeration", () => this.#options.ops.listWindows());
    const ownIds = snapshot.windows.filter((window) => window.pid === this.#options.ownProcessId).map((window) => window.hwnd);
    const selected = selectWindowsObservation(snapshot, ownIds);
    const owner = snapshot.windows.find((window) => window.hwnd === selected?.windowId);
    if (!owner || owner.pid === this.#options.ownProcessId) return null;
    return {
      handle: String(owner.hwnd),
      processId: owner.pid,
      title: owner.title,
      bounds: owner.frame,
      dpi: owner.monitorDpi,
    };
  }

  async observe(input: { readonly includeImage?: boolean; readonly signal?: AbortSignal }): Promise<ObserveResult> {
    try {
      const result = await this.#withGuiTurn(async () => {
        input.signal?.throwIfAborted();
        const target = this.#findForegroundTarget();
        if (!target) throw new Error("No application window is available to observe.");
        const screens = await timeToolPhase("listScreens", () => this.#options.backend.listScreens(input.signal));
        const screen = screens.find((candidate) => candidate.windowId === target.windowId) ?? screens[0];
        if (!screen || screen.windowId !== target.windowId) {
          throw new Error("The reference backend did not select the recorded target window.");
        }
        const captured = await timeToolPhase("capture", () => this.#options.backend.capture(screen, input.signal));
        const observation = this.#makeObservation(target, screen, captured, input.includeImage === true,
          await timeToolPhase("inspectForeground", () => this.#options.backend.inspectForeground(input.signal)));
        this.#target = target;
        this.#screen = screen;
        this.#observation = observation;
        this.#publishTarget(target);
        return observation;
      }, input.signal);
      input.signal?.throwIfAborted();
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
    if (action.kind === "screenshot") return this.#screenshot(signal);
    if (action.kind === "openInBrowser") return this.#openInBrowser(action.url, signal);
    if (action.kind === "openInFinder") return this.#openInFinder(action.path, action.revealOnly ?? false, signal);
    try {
      const abort = signal ?? new AbortController().signal;
      if (action.kind === "wait" || action.kind === "longWait") {
        await delay((action.kind === "wait" ? WAIT_SECONDS : action.waitSeconds) * 1000, abort);
      }
      const apps = action.kind === "listApps" ? [...await this.#options.backend.listApps(abort)] : undefined;
      // Read-only refreshes never send input to the old surface. Navigation may legitimately
      // change the title during a wait; observe the resulting page instead of refusing it.
      if (action.kind === "wait" || action.kind === "longWait" || action.kind === "listApps") {
        const fresh = await this.observe({ includeImage: true, signal });
        if (!fresh.ok || !fresh.observation) throw new Error(fresh.error ?? "Observation unavailable.");
        return { ok: true, refused: false, error: null, observation: fresh.observation, ...(apps ? { apps } : {}) };
      }
      const observationAfterAction = await this.#withGuiTurn(async () => {
        if (!this.#isCurrentForeground(target)) {
          // No input has run. Return the new surface so the caller can reassess the current
          // screenshot, including when the window changed between completed steps.
          const fresh = await this.observe({ includeImage: true, signal });
          const error = new Error("The foreground window changed after the observation. Observe again before acting.");
          if (fresh.ok && fresh.observation) return { surfaceChanged: fresh.observation, error };
          throw error;
        }
        if (action.kind === "click") {
          await timeToolPhase("native-input", () => this.#options.backend.click({ screen, position: positionOf(action.position), button: action.button ?? "left", count: action.count ?? 1,
            ...(action.modifiers ? { modifiers: action.modifiers } : {}) }, signal));
        } else if (action.kind === "type") {
          await timeToolPhase("native-input", () => this.#options.backend.typeText({ screen, position: positionOf(action.position), text: action.text, replace: action.replace ?? false, submit: action.submit ?? false }, signal));
        } else if (action.kind === "hotkey") {
          await timeToolPhase("native-input", () => this.#options.backend.hotkey({ keys: action.keys }, signal));
        } else if (action.kind === "longPress") {
          await timeToolPhase("native-input", () => this.#options.backend.longPress({
            screen,
            position: positionOf(action.position),
            durationSeconds: action.durationSeconds,
          }, signal));
        } else if (action.kind === "drag") {
          await timeToolPhase("native-input", () => this.#options.backend.drag({
            startScreen: screen,
            startPosition: positionOf(action.startPosition),
            endScreen: screen,
            endPosition: positionOf(action.endPosition),
          }, signal));
        } else if (action.kind === "scroll") {
          await timeToolPhase("native-input", () => this.#options.backend.scroll({
            screen,
            position: positionOf(action.position),
            direction: action.direction,
            scrollLevel: action.amount,
          }, signal));
        }
        await timeToolPhase("post-action-wait", () => delay(this.#options.postActionWaitMs ?? POST_ACTION_WAIT_MS, abort));
        const nextTarget = this.#findForegroundTarget();
        if (!nextTarget) throw new Error("No application window is available after the action.");
        const nextScreens = await timeToolPhase("listScreens", () => this.#options.backend.listScreens(signal));
        const nextScreen = nextScreens.find((candidate) => candidate.windowId === nextTarget.windowId);
        if (!nextScreen) throw new Error("The new application window could not be observed.");
        const captured = await timeToolPhase("capture", () => this.#options.backend.capture(nextScreen, signal));
        const nextObservation = this.#makeObservation(nextTarget, nextScreen, captured, true,
          await timeToolPhase("inspectForeground", () => this.#options.backend.inspectForeground(signal)));
        this.#target = nextTarget;
        this.#screen = nextScreen;
        this.#observation = nextObservation;
        this.#publishTarget(nextTarget);
        return nextObservation;
      }, signal);
      abort.throwIfAborted();
      if ("surfaceChanged" in observationAfterAction) return { ok: false, refused: true,
        reason: "surface-changed", error: observationAfterAction.error.message, observation: observationAfterAction.surfaceChanged };
      return { ok: true, refused: false, error: null, observation: observationAfterAction, ...(apps ? { apps } : {}) };
    } catch (error) {
      return { ok: false, refused: false, error: message(error) };
    }
  }

  async #screenshot(signal?: AbortSignal): Promise<ActResult> {
    const screens = await this.#options.backend.listScreens(signal);
    const screen = screens[0];
    if (!screen) return { ok: false, refused: false, error: "No application window is available." };
    const captured = await this.#options.backend.capture(screen, signal);
    const files = pairScreenshotFiles([captured], [{ screenIndex: screen.index }]);
    const paths = await writeDesktopScreenshots(files, { home: homedir() });
    const first = files[0];
    const firstPath = paths[0];
    if (!first || !firstPath) return { ok: false, refused: false, error: "Screenshot produced no file." };
    await this.#options.backend.copyImageToClipboard({ path: firstPath, mediaType: first.mediaType }, signal);
    const fresh = await this.observe({ includeImage: true, signal });
    if (!fresh.ok || !fresh.observation) return { ok: false, refused: false, error: fresh.error ?? "Observation unavailable." };
    return { ok: true, refused: false, error: null, observation: fresh.observation, paths };
  }

  async #openInBrowser(url: string | undefined, signal?: AbortSignal): Promise<ActResult> {
    const normalized = url === undefined || url.trim() === "" ? undefined : requireBrowserUrl(url);
    await this.#options.backend.openInBrowser(normalized === undefined ? {} : { url: normalized }, signal);
    const fresh = await this.observe({ includeImage: true, signal });
    if (!fresh.ok || !fresh.observation) return { ok: false, refused: false, error: fresh.error ?? "Observation unavailable." };
    return { ok: true, refused: false, error: null, observation: fresh.observation };
  }

  async #openInFinder(path: string | undefined, revealOnly: boolean, signal?: AbortSignal): Promise<ActResult> {
    const target = await resolveFinderOpen(path, revealOnly);
    const info = await stat(target.path);
    await this.#options.backend.openInFinder({ path: target.path, revealOnly: target.revealOnly && info.isFile() }, signal);
    const fresh = await this.observe({ includeImage: true, signal });
    if (!fresh.ok || !fresh.observation) return { ok: false, refused: false, error: fresh.error ?? "Observation unavailable." };
    return { ok: true, refused: false, error: null, observation: fresh.observation };
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
        data: timeToolSync("base64", () => Buffer.from(captured.data).toString("base64")),
        mimeType: captured.mediaType,
        width: Math.round(screen.bounds.width),
        height: Math.round(screen.bounds.height),
      };
      logToolMetric("image", { bytes: captured.data.byteLength, width: image.width, height: image.height });
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

  /** Port of plugin.ts open_app @9cdc503: backend operation, settle, actual foreground frame. */
  async #openApp(action: { readonly name: string }, signal?: AbortSignal): Promise<ActResult> {
    try {
      const abort = signal ?? new AbortController().signal;
      abort.throwIfAborted();
      let app: { kind: "activated" | "launched"; name: string } | undefined;
      let openError: string | null = null;
      try {
        app = await this.#withGuiTurn(() => this.#options.backend.openApp({ name: action.name.trim() }, abort), abort);
        await timeToolPhase("post-action-wait", () => delay(this.#options.postActionWaitMs ?? POST_ACTION_WAIT_MS, abort));
      } catch (error) {
        abort.throwIfAborted();
        openError = message(error);
      }
      const fresh = await this.observe({ includeImage: true, signal: abort });
      if (!fresh.ok || !fresh.observation) throw new Error(fresh.error ?? "Observation unavailable.");
      if (openError !== null) return { ok: false, refused: false, error: openError, observation: fresh.observation };
      return { ok: true, refused: false, error: null, observation: fresh.observation, app: app! };
    } catch (error) {
      return { ok: false, refused: false, error: message(error) };
    }
  }

  /** Select the reference backend's frontmost operable window, excluding Orb chrome. */
  #publishTarget(target: TargetWindow): void {
    this.#options.onTargetChanged?.({ ...target, isOnScreen: true, zIndex: BigInt(0) });
  }

  #findForegroundTarget(): TargetWindow | null {
    const snapshot = timeToolSync("window-enumeration", () => this.#options.ops.listWindows());
    const ownIds = snapshot.windows.filter((window) => window.pid === this.#options.ownProcessId).map((window) => window.hwnd);
    const selected = selectWindowsObservation(snapshot, ownIds);
    if (!selected) return null;
    const owner = snapshot.windows.find((window) => window.hwnd === selected.windowId);
    if (!owner || owner.pid === this.#options.ownProcessId) return null;
    return {
      windowId: owner.hwnd,
      pid: owner.pid,
      appName: owner.appName,
      title: owner.title,
      bounds: selected.bounds,
    };
  }

  #isCurrentForeground(expected: TargetWindow): boolean {
    const foreground = this.#findForegroundTarget();
    const matches = foreground !== null &&
      foreground.windowId === expected.windowId &&
      foreground.pid === expected.pid &&
      foreground.title === expected.title &&
      foreground.bounds.x === expected.bounds.x &&
      foreground.bounds.y === expected.bounds.y &&
      foreground.bounds.width === expected.bounds.width &&
      foreground.bounds.height === expected.bounds.height;
    if (!matches) logToolMetric("window-validation", { matched: 0, expectedWindow: expected.windowId,
      currentWindow: foreground?.windowId ?? 0, expectedPid: expected.pid, currentPid: foreground?.pid ?? 0,
      expectedX: expected.bounds.x, currentX: foreground?.bounds.x ?? 0,
      expectedY: expected.bounds.y, currentY: foreground?.bounds.y ?? 0,
      expectedWidth: expected.bounds.width, currentWidth: foreground?.bounds.width ?? 0,
      expectedHeight: expected.bounds.height, currentHeight: foreground?.bounds.height ?? 0 });
    return matches;
  }

  #withGuiTurn<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const withExcludedOrb = () => {
      const ownIds = timeToolSync("window-enumeration", () => this.#options.ops.listWindows()).windows
        .filter((window) => window.pid === this.#options.ownProcessId)
        .map((window) => window.hwnd);
      return runWithCaptureExcludeWindowIds(ownIds, run);
    };
    return this.#options.withGuiTurn ? this.#options.withGuiTurn(withExcludedOrb, signal) : withExcludedOrb();
  }
}
