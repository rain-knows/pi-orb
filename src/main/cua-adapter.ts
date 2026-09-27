/**
 * Cua driver adapter: the only place that talks to the locked driver SDK.
 *
 * Everything measured about this driver is applied here and nowhere else, so the rest of
 * the product is not coupled to its conventions
 * (see doc/cua-driver-integration.md and evidence/p1-05/README.md):
 *
 *  - `listWindows` reports window bounds in **physical pixels**, while actions are expressed
 *    in **screen DIP**. A click request is the target's screen DIP point minus the driver's
 *    reported window origin. That mapping is empirically fitted (four cells on one window
 *    position), so `coordinateMappingConfidence` records that it is not a proven formula.
 *  - window ids are `bigint` and must not be converted to `number`.
 *  - background click works on Chromium/Electron content; background type/scroll does not,
 *    and foreground delivery requires a window the OS will activate.
 *  - the driver's own summary is not proof an action landed; callers must re-observe.
 */

import { desktopCapturer } from "electron";
import type {
  DesktopAction,
  DesktopElement,
  DesktopObservation,
} from "@shared/orb-tools";
import { ORB_LIMITS, boundElements } from "@shared/orb-tools";
import type { ActResult, DesktopDriver, ObserveResult } from "./desktop-task";

/** A window record exactly as the driver reports it; bounds are physical pixels. */
export interface CuaWindowInfo {
  readonly windowId: bigint;
  readonly pid?: number;
  readonly appName: string;
  readonly title: string;
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly isOnScreen: boolean;
  readonly zIndex?: bigint;
  readonly minimized?: boolean;
}

interface CuaWindowStateElement {
  readonly elementToken?: string;
  readonly role?: string;
  readonly label?: string;
  readonly actions?: readonly string[];
}

export interface CuaDriverLike {
  listWindows(input: unknown): Promise<{ windows?: CuaWindowInfo[] }>;
  getWindowState(input: unknown): Promise<{ structuredJson?: string; degraded?: boolean }>;
  click(input: unknown): Promise<unknown>;
  typeText(input: unknown): Promise<unknown>;
  scroll(input: unknown): Promise<unknown>;
  shutdown(): Promise<void>;
}

export interface CuaSdkLike {
  readonly CuaDriver: {
    create(options: unknown): CuaDriverLike;
  };
  readonly ListWindowsInput: { create(input: Record<string, unknown>): unknown };
  readonly GetWindowStateInput: { create(input: Record<string, unknown>): unknown };
  readonly ClickInput: { create(input: Record<string, unknown>): unknown };
  readonly TypeTextInput: { create(input: Record<string, unknown>): unknown };
  readonly ScrollInput: { create(input: Record<string, unknown>): unknown };
  readonly ActionTarget: { Window: new (inner: { pid: number; windowId: bigint }) => unknown };
  readonly ClickPosition: {
    Coordinates: new (inner: { x: number; y: number }) => unknown;
    Element: new (inner: { token: string }) => unknown;
  };
  readonly InputDeliveryMode: { Background: number; Foreground: number };
  readonly ClickButton: { Left: number };
  readonly ScrollDirection: { Up: number; Down: number; Left: number; Right: number };
}

export interface CuaDriverAdapterOptions {
  readonly sdk: CuaSdkLike;
  /** The process id of the Orb shell itself, so it never targets its own window. */
  readonly ownProcessId: number;
  /** Called for the coordinate mapping used, so it is recorded rather than assumed. */
  readonly onMappingUsed?: (mapping: Record<string, unknown>) => void;
  /**
   * The window the user recorded before the orb took focus, if any.
   *
   * Supplied by the shell so the same "record the target before waking" rule that governs
   * screenshots also governs desktop actions. When it returns nothing, observation is refused
   * rather than guessing a window.
   */
  readonly resolveRecordedTarget?: () => RecordedTarget | undefined;
}

let observationCounter = 0;

export class CuaDriverAdapter implements DesktopDriver {
  readonly #options: CuaDriverAdapterOptions;
  #driver: CuaDriverLike | null = null;
  #lastMapping: Record<string, unknown> | null = null;
  #observation: DesktopObservation | null = null;

  constructor(options: CuaDriverAdapterOptions) {
    this.#options = options;
  }

  get driver(): CuaDriverLike | null {
    return this.#driver;
  }

  get lastCoordinateMapping(): Record<string, unknown> | null {
    return this.#lastMapping;
  }

  create(): void {
    if (this.#driver) return;
    this.#driver = this.#options.sdk.CuaDriver.create(undefined);
  }

  async shutdown(): Promise<void> {
    const driver = this.#driver;
    this.#driver = null;
    if (!driver) return;
    try {
      await driver.shutdown();
    } catch {
      // Shutdown is best effort; a failure here must not block the shell's exit.
    }
  }

  /**
   * List the windows the driver reports, so the user can choose a target.
   *
   * The orb's own windows are excluded: it must never offer to act on itself.
   */
  async listWindows(ownProcessId: number): Promise<CuaWindowInfo[]> {
    const driver = this.#driver;
    if (!driver) return [];
    try {
      const listed = await driver.listWindows(this.#options.sdk.ListWindowsInput.create({}));
      const windows = Array.isArray(listed?.windows) ? listed.windows : [];
      return windows.filter((window) => window.pid !== ownProcessId);
    } catch {
      return [];
    }
  }

  async observe(input: { readonly windowId?: string }): Promise<ObserveResult> {
    const driver = this.#driver;
    if (!driver) {
      return { ok: false, observation: null, error: "The desktop driver has not been created." };
    }

    let windows: CuaWindowInfo[];
    try {
      const listed = await driver.listWindows(this.#options.sdk.ListWindowsInput.create({}));
      windows = Array.isArray(listed?.windows) ? listed.windows : [];
    } catch (error) {
      return { ok: false, observation: null, error: `Window list failed: ${message(error)}` };
    }

    // The target must be identified, either by the caller or by the shell's recorded target.
    //
    // Picking "whatever is front-most" was measured to be wrong: an auxiliary surface (the touch
    // keyboard host, which reported a higher z-index than the window under test) was chosen, and
    // the click was delivered to it instead of the intended window. A wrong-window click is
    // exactly the failure the product must not have, so the rule is now: act only on a window
    // that was explicitly identified, and refuse otherwise.
    const requested: { windowId?: string; recorded?: RecordedTarget } = {};
    if (input.windowId) requested.windowId = input.windowId;
    if (!input.windowId) {
      const recorded = this.#options.resolveRecordedTarget?.();
      if (recorded) requested.recorded = recorded;
    }
    if (!requested.windowId && !requested.recorded) {
      return {
        ok: false,
        observation: null,
        error:
          "No target window was identified. Bring the window you want to work with to the front so the shell can record it, then observe again. The orb does not guess a target.",
      };
    }

    const target = chooseWindow(windows, requested, this.#options.ownProcessId);
    if (!target) {
      return {
        ok: false,
        observation: null,
        error:
          "The identified target window is not available to observe. It may have been closed, or it belongs to the orb itself.",
      };
    }

    // `listWindows` bounds are physical pixels while a coordinate action is expressed in
    // screen DIP. The measured relation is `request = screenDip - driverPhysicalOrigin`,
    // verified on four widely separated cells (evidence/p1-05/input-verification.json).
    // It is fitted, not derived, so it is recorded here rather than hidden.
    const actionOrigin = { x: target.bounds.x, y: target.bounds.y };
    this.#lastMapping = {
      driverBoundsPhysical: target.bounds,
      actionOrigin,
      actionSpace: "screen-dip",
      relation: "request = screenDip - driverPhysicalOrigin",
      // Recorded because this is fitted, not derived: the physical and DIP spaces are not
      // related by a uniform offset and scale on this platform.
      coordinateMappingConfidence: "empirically-fitted",
    };
    this.#options.onMappingUsed?.(this.#lastMapping);

    let elements: readonly DesktopElement[] = [];
    let elementsUnavailable = false;
    let degraded = false;
    try {
      const state = await driver.getWindowState(
        this.#options.sdk.GetWindowStateInput.create({
          pid: target.pid,
          windowId: target.windowId,
          includeAccessibilityTree: true,
          maxElements: ORB_LIMITS.maxElementsPerObservation,
        }),
      );
      const structured =
        typeof state?.structuredJson === "string"
          ? (JSON.parse(state.structuredJson) as { elements?: CuaWindowStateElement[]; degraded?: boolean })
          : null;
      const raw = Array.isArray(structured?.elements) ? structured.elements : [];
      elements = boundElements(
        raw.map((element, index) => ({
          token: element.elementToken ?? `index-${index}`,
          role: element.role ?? "unknown",
          label: element.label ?? "",
          actions: element.actions ?? [],
        })),
      );
      // Chromium/Electron content often exposes no useful elements, and that is not an error:
      // it means actions must be addressed by explicit coordinates.
      elementsUnavailable = elements.length === 0;
      degraded = structured?.degraded === true;
    } catch (error) {
      elementsUnavailable = true;
      degraded = true;
      void error;
    }

    observationCounter += 1;
    const observation: DesktopObservation = {
      observationId: `obs-${Date.now().toString(36)}-${observationCounter}`,
      at: Date.now(),
      window: {
        id: String(target.windowId),
        pid: target.pid ?? -1,
        title: target.title,
        appName: target.appName,
        bounds: target.bounds,
      },
      coordinateSpace: {
        action: "screen-dip",
        windowSize: `${Math.round(target.bounds.width / 1)}x${Math.round(target.bounds.height / 1)} physical px; actions use screen DIP (see coordinate mapping)`,
      },
      elements,
      elementsUnavailable,
      degraded,
    };
    this.#observation = observation;
    return { ok: true, observation, error: null };
  }

  /**
   * Consume the current observation.
   *
   * Called by the broker after an action runs, so the same observation cannot be replayed: the
   * rule is "act once, then observe again", and leaving the observation in place would let a
   * plan chain actions on one picture.
   */
  consumeObservation(): void {
    this.#observation = null;
  }

  get lastObservation(): DesktopObservation | null {
    return this.#observation;
  }

  /**
   * Deliver exactly one action.
   *
   * Every action is addressed either by element token or by coordinates. When coordinates are
   * used, the request is converted from screen DIP to the value the driver expects using the
   * measured window origin; the conversion is recorded on the observation path so it is never
   * an invisible assumption.
   */
  async act(action: DesktopAction, observation: DesktopObservation): Promise<ActResult> {
    const driver = this.#driver;
    if (!driver) return { ok: false, refused: false, error: "The desktop driver has not been created." };

    const windowId = BigInt(observation.window.id);
    const target = new this.#options.sdk.ActionTarget.Window({
      pid: observation.window.pid,
      windowId,
    });

    try {
      if (action.kind === "click") {
        const position = this.#positionFor(action.elementToken, action.point, observation);
        await driver.click(
          this.#options.sdk.ClickInput.create({
            target,
            position,
            deliveryMode: this.#options.sdk.InputDeliveryMode.Background,
            button: this.#options.sdk.ClickButton.Left,
            count: 1,
          }),
        );
        return { ok: true, refused: false, error: null };
      }

      if (action.kind === "type") {
        if (action.elementToken) {
          return {
            ok: false,
            refused: true,
            error:
              "Typing into a specific element is not supported by this driver path. Observe again and click the field first.",
          };
        }
        await driver.typeText(this.#options.sdk.TypeTextInput.create({ text: action.text, target }));
        return { ok: true, refused: false, error: null };
      }

      const direction = {
        up: this.#options.sdk.ScrollDirection.Up,
        down: this.#options.sdk.ScrollDirection.Down,
        left: this.#options.sdk.ScrollDirection.Left,
        right: this.#options.sdk.ScrollDirection.Right,
      }[action.direction];
      const point = action.point ?? { x: 0, y: 0 };
      await driver.scroll(
        this.#options.sdk.ScrollInput.create({
          x: point.x,
          y: point.y,
          direction,
          target,
          amount: BigInt(action.amount),
        }),
      );
      return { ok: true, refused: false, error: null };
    } catch (error) {
      return { ok: false, refused: isDriverRefusal(error), error: message(error) };
    }
  }

  #positionFor(
    elementToken: string | undefined,
    point: { x: number; y: number } | undefined,
    observation: DesktopObservation,
  ): unknown {
    if (elementToken) {
      return new this.#options.sdk.ClickPosition.Element({ token: elementToken });
    }
    if (!point) {
      // validateAction already refuses this case; this is a defensive fallback.
      throw new Error("No target was provided for the click.");
    }
    const mapping = this.#lastMapping;
    const origin = (mapping?.actionOrigin ?? { x: 0, y: 0 }) as { x: number; y: number };
    const request = { x: point.x - origin.x, y: point.y - origin.y };
    this.#lastMapping = {
      ...(mapping ?? {}),
      lastRequest: { screenDip: point, request, actionOrigin: origin },
    };
    void observation;
    return new this.#options.sdk.ClickPosition.Coordinates(request);
  }
}

/**
 * A window identity recorded before the orb took focus.
 *
 * The driver's `windowId` and the Win32 window handle are different id spaces
 * (doc/cua-driver-integration.md), so they cannot be converted into each other. Identity is
 * therefore matched on the pair (process id, title), which is stable for the duration of a task
 * and requires both to agree.
 */
export interface RecordedTarget {
  readonly pid: number;
  readonly title: string;
}

/**
 * Pick the observation target.
 *
 * The window must be identified: either by an explicit driver window id, or by a
 * (pid, title) pair recorded before the orb took focus. There is no "front-most" fallback, because
 * measurement showed that heuristic can select an auxiliary surface and deliver input to the
 * wrong window.
 */
export function chooseWindow(
  windows: readonly CuaWindowInfo[],
  requested: { readonly windowId?: string; readonly recorded?: RecordedTarget } | undefined,
  ownProcessId: number,
): CuaWindowInfo | null {
  if (!requested) return null;

  if (requested.windowId) {
    return (
      windows.find(
        (window) =>
          String(window.windowId) === requested.windowId &&
          window.pid !== undefined &&
          window.pid !== ownProcessId,
      ) ?? null
    );
  }

  const recorded = requested.recorded;
  if (!recorded) return null;
  return (
    windows.find(
      (window) =>
        window.pid === recorded.pid &&
        typeof window.title === "string" &&
        window.title === recorded.title,
    ) ?? null
  );
}

function isDriverRefusal(error: unknown): boolean {
  const tag = (error as { tag?: unknown })?.tag;
  return tag === "Tool" || tag === "InvalidArguments" || tag === "Configuration";
}

function message(error: unknown): string {
  const inner = (error as { inner?: unknown })?.inner;
  if (typeof inner === "string") return inner;
  if (inner && typeof inner === "object") {
    const detail = (inner as { message?: unknown }).message;
    if (typeof detail === "string") return detail;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** True when Electron reports at least one capturable window, used by the health path. */
export async function canEnumerateWindows(): Promise<boolean> {
  try {
    const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 1, height: 1 } });
    return sources.length > 0;
  } catch {
    return false;
  }
}
