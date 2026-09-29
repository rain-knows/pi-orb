/**
 * The desktop broker: the single point where a desktop action is authorized, executed and
 * accounted for.
 *
 * It implements the bridge executor, so the Pi extension's tool calls reach it through the
 * named-pipe seam and nowhere else. Its job is to keep three things true:
 *
 *  1. **Nothing runs without a live authorization.** The controller holds the task grant; the
 *     broker refuses before touching the driver, so desktop authority cannot be bypassed by a
 *     malformed request.
 *  2. **One action, one observation.** An action must name the observation it was decided
 *     from, and the adapter re-observes afterwards as part of the caller's next turn.
 *  3. **A failure stops the batch.** The controller records the outcome, and a failed action
 *     makes the next one refuse until the run is re-authorized or the user continues.
 *
 * It is deliberately narrow: it holds no session engine, no model, and no policy of its own
 * beyond what `desktop-task.ts` and `orb-tools.ts` define.
 */

import {
  ORB_TOOLS,
  boundElements,
  describeRefusal,
  type ActionRefusal,
  type DesktopAction,
  type DesktopElement,
  type DesktopObservation,
} from "@shared/orb-tools";
import { DesktopTaskController, type ActResult, type DesktopDriver } from "./desktop-task";

export interface DesktopBrokerOptions {
  readonly driver: DesktopDriver;
  readonly controller?: DesktopTaskController;
  /** The live session/generation pair, so a request from a dead run is refused. */
  readonly isLive: (sessionId: string, generation: number) => boolean;
  readonly log?: (entry: Record<string, unknown>) => void;
}

export interface BrokerStatus {
  readonly authorized: boolean;
  readonly taskId: string | null;
  readonly scope: string | null;
  readonly actionsUsed: number;
  readonly actionLimit: number;
  readonly expiresAt: number | null;
  readonly stopped: boolean;
  readonly stoppedReason: string | null;
  readonly lastObservationId: string | null;
}

export class DesktopBroker {
  readonly #options: DesktopBrokerOptions;
  readonly #controller: DesktopTaskController;
  /** Task id that owned the current driver observation; null means it was read-only pre-authorization. */
  #observationTaskId: string | null = null;
  #activeAction: AbortController | null = null;

  constructor(options: DesktopBrokerOptions) {
    this.#options = options;
    this.#controller = options.controller ?? new DesktopTaskController();
  }

  get controller(): DesktopTaskController {
    return this.#controller;
  }

  /**
   * Grant a desktop task. Called only from an explicit user decision in the shell UI.
   *
   * The scope text is recorded so the user can be shown what they approved, and the grant is
   * bound to the session and generation so it cannot survive a run change.
   */
  authorize(input: { sessionId: string; generation: number; scope: string }): BrokerStatus {
    this.#abortActiveAction("desktop task was replaced");
    // A new task must never inherit a picture captured under the previous grant. An observation
    // made before any grant is intentionally retained so the user can inspect it before approving.
    if (this.#observationTaskId !== null) {
      this.#consumeObservation();
      this.#options.driver.resetActionContext?.();
      this.#controller.clearObservation();
    }
    this.#controller.authorize(input);
    this.#log({ event: "authorize", ...input });
    return this.status();
  }

  revoke(): void {
    this.#abortActiveAction("desktop task was revoked");
    this.#controller.revoke();
    // Drop the backend's copy as well as the controller's observation id. The driver is the
    // source used by action validation, so leaving it populated would allow reuse after regrant.
    this.#consumeObservation();
    this.#options.driver.resetActionContext?.();
    this.#log({ event: "revoke" });
  }

  status(): BrokerStatus {
    const state = this.#controller.state;
    return {
      authorized: this.#controller.authorized,
      taskId: state.authorization?.taskId ?? null,
      scope: state.authorization?.scope ?? null,
      actionsUsed: state.actionsUsed,
      actionLimit: 12,
      expiresAt: state.authorization?.expiresAt ?? null,
      stopped: state.stopped,
      stoppedReason: state.stoppedReason,
      lastObservationId: state.lastObservationId,
    };
  }

  /** The bridge executor entry point for an observation. */
  async observe(sessionId: string, _generation: number, windowId?: string): Promise<unknown> {
    const result = await this.#options.driver.observe(windowId ? { windowId } : {});
    if (!result.ok || !result.observation) {
      this.#consumeObservation();
      this.#controller.clearObservation();
      this.#log({ event: "observe-failed", error: result.error });
      return {
        ok: false,
        refused: true,
        reason: "no-target",
        message: result.error ?? "The window could not be observed.",
      };
    }
    this.#controller.observe(result.observation.observationId);
    this.#observationTaskId = this.#controller.state.authorization?.taskId ?? null;
    this.#log({
      event: "observe",
      sessionId,
      observationId: result.observation.observationId,
      windowId: result.observation.window.id,
      elementCount: result.observation.elements.length,
      coordinateSpace: {
        action: result.observation.coordinateSpace?.action ?? null,
        space: result.observation.coordinateSpace?.space ?? null,
        hasWindowRect: result.observation.coordinateSpace?.windowRect != null,
      },
    });
    return { ok: true, ...result.observation };
  }

  /**
   * The bridge executor entry point for an action.
   *
   * The order matters: policy first (authorization, budget, observation freshness), then the
   * driver. A refusal must never reach the driver, so a refused action cannot have a side
   * effect even if the driver would have partially applied it.
   */
  async act(action: unknown, sessionId: string, generation: number): Promise<unknown> {
    const parsed = parseAction(action);
    if (!parsed.ok) {
      this.#log({ event: "act-refused", reason: "malformed", detail: parsed.message });
      return { ok: false, refused: true, reason: "malformed", message: parsed.message };
    }

    if (!this.#options.isLive(sessionId, generation)) {
      return refusal("stale-generation");
    }

    const observation = this.#currentObservation();
    const refusalReason = this.#controller.check(parsed.action, observation);
    if (refusalReason !== null) {
      this.#log({ event: "act-refused", reason: refusalReason, kind: parsed.action.kind });
      return refusal(refusalReason);
    }

    this.#log({
      event: "act-observation",
      kind: parsed.action.kind,
      observationId: observation!.observationId,
      coordinateSpace: {
        present: observation!.coordinateSpace != null,
        space: observation!.coordinateSpace?.space ?? null,
        hasWindowRect: observation!.coordinateSpace?.windowRect != null,
      },
    });

    const taskId = this.#controller.state.authorization?.taskId ?? null;
    const actionController = new AbortController();
    this.#activeAction = actionController;
    let result: ActResult;
    try {
      result = await this.#options.driver.act(parsed.action, observation!, actionController.signal);
    } catch (error) {
      result = {
        ok: false,
        refused: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (this.#activeAction === actionController) this.#activeAction = null;
    }

    // A revoke or replacement may have happened while the native action was unwinding. Do not
    // account that old result against a new grant or consume the new grant's observation.
    if (this.#controller.state.authorization?.taskId !== taskId) {
      return refusal("no-task-authorization");
    }
    this.#controller.recordOutcome(result.ok, result.error);
    // The observation is spent either way. A failed action must not be retried from the same
    // picture, and a successful one must be followed by a fresh look.
    this.#consumeObservation();

    if (!result.ok) {
      // A failure stops the batch; the message says so, because the model must not retry
      // blindly from the same observation.
      const suffix = result.refused ? " The driver refused the action." : "";
      this.#log({ event: "act-failed", kind: parsed.action.kind, error: result.error, refused: result.refused });
      return {
        ok: false,
        refused: result.refused,
        reason: "action-failed",
        message: `${result.error ?? "The action failed."}${suffix} The task was stopped; observe again and ask the user before continuing.`,
      };
    }

    this.#log({ event: "act", kind: parsed.action.kind, observationId: parsed.action.observationId });
    return {
      ok: true,
      action: parsed.action.kind,
      observationId: parsed.action.observationId,
      actionsUsed: this.#controller.state.actionsUsed,
      // The rule is stated in the result so the model is reminded to re-observe rather than
      // chaining actions on the picture it just acted on.
      next: "Observe the window again before the next action.",
    };
  }

  /**
   * The observation an action may reference.
   *
   * Returned as `null` when the driver has no current observation, which the controller turns
   * into `observation-unknown` rather than allowing an action against an unknown window.
   */
  #currentObservation(): DesktopObservation | null {
    const driver = this.#options.driver as { lastObservation?: DesktopObservation | null };
    return driver.lastObservation ?? null;
  }

  #consumeObservation(): void {
    this.#options.driver.consumeObservation?.();
    this.#observationTaskId = null;
  }

  #abortActiveAction(reason: string): void {
    const action = this.#activeAction;
    this.#activeAction = null;
    if (action && !action.signal.aborted) action.abort(new Error(reason));
  }

  #log(entry: Record<string, unknown>): void {
    this.#options.log?.({ at: new Date().toISOString(), ...entry });
  }
}

function refusal(reason: ActionRefusal): unknown {
  return { ok: false, refused: true, reason, message: describeRefusal(reason) };
}

type ParseResult = { readonly ok: true; readonly action: DesktopAction } | { readonly ok: false; readonly message: string };

/**
 * Validate an action arriving over the bridge.
 *
 * The extension is not a trusted boundary: it is a separate process, and its payload is
 * untrusted input here. Every field is type-checked, and the element/point rule is enforced
 * again on this side so a malformed action cannot reach the driver.
 */
export function parseAction(value: unknown): ParseResult {
  if (typeof value !== "object" || value === null) return { ok: false, message: "Action must be an object." };
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  const observationId = record.observationId;
  if (typeof observationId !== "string" || observationId.length === 0) {
    return { ok: false, message: "Action must name the observation it was decided from." };
  }

  const readPosition = (): { x: number; y: number } | undefined => {
    const value = record.position;
    if (typeof value !== "object" || value === null) return undefined;
    const position = value as { x?: unknown; y?: unknown };
    if (typeof position.x !== "number" || typeof position.y !== "number") return undefined;
    return { x: position.x, y: position.y };
  };
  const elementToken = typeof record.elementToken === "string" && record.elementToken.length > 0 ? record.elementToken : undefined;
  const readPositionField = (field: string): { x: number; y: number } | undefined => {
    const value = record[field];
    if (typeof value !== "object" || value === null) return undefined;
    const position = value as { x?: unknown; y?: unknown };
    if (typeof position.x !== "number" || typeof position.y !== "number") return undefined;
    return { x: position.x, y: position.y };
  };

  if (kind === "click") {
    const position = readPosition();
    if (!elementToken && !position) return { ok: false, message: "A click needs an element token or a position." };
    if (elementToken && position) return { ok: false, message: "A click needs an element token or a position, not both." };
    return {
      ok: true,
      action: { kind: "click", observationId, ...(elementToken ? { elementToken } : {}), ...(position ? { position } : {}) },
    };
  }

  if (kind === "type") {
    const text = record.text;
    if (typeof text !== "string") return { ok: false, message: "A type action needs text." };
    return { ok: true, action: { kind: "type", observationId, text, ...(elementToken ? { elementToken } : {}) } };
  }

  if (kind === "scroll") {
    const direction = record.direction;
    const amount = record.amount;
    if (direction !== "up" && direction !== "down" && direction !== "left" && direction !== "right") {
      return { ok: false, message: "A scroll action needs a direction." };
    }
    if (typeof amount !== "number") return { ok: false, message: "A scroll action needs a numeric amount." };
    const position = readPosition();
    return {
      ok: true,
      action: {
        kind: "scroll",
        observationId,
        direction,
        amount,
        ...(elementToken ? { elementToken } : {}),
        ...(position ? { position } : {}),
      },
    };
  }

  if (kind === "hotkey") {
    const keys = record.keys;
    if (!Array.isArray(keys) || !keys.every((key) => typeof key === "string")) {
      return { ok: false, message: "A hotkey action needs an array of key names." };
    }
    return { ok: true, action: { kind: "hotkey", observationId, keys } };
  }

  if (kind === "longPress") {
    const position = readPositionField("position");
    const durationSeconds = record.durationSeconds;
    if (!position || typeof durationSeconds !== "number") {
      return { ok: false, message: "A long press needs a position and numeric duration." };
    }
    return { ok: true, action: { kind: "longPress", observationId, position, durationSeconds } };
  }

  if (kind === "drag") {
    const startPosition = readPositionField("startPosition");
    const endPosition = readPositionField("endPosition");
    if (!startPosition || !endPosition) {
      return { ok: false, message: "A drag needs start and end positions." };
    }
    return { ok: true, action: { kind: "drag", observationId, startPosition, endPosition } };
  }

  return { ok: false, message: `Unknown action kind: ${String(kind)}` };
}

/** Re-exported so the adapter and broker agree on the element bounding rule. */
export { boundElements, ORB_TOOLS };
export type { DesktopElement };
