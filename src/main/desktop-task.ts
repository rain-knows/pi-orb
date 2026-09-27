/**
 * Desktop task authorization and the one-action-one-observation batch machine (P1-06).
 *
 * Everything the executor needs to decide "may this action run" lives here, free of
 * Electron and of the driver, so the rules are exercised directly by tests. Two
 * properties matter most:
 *
 *  1. **Authorization is explicit and perishable.** It is granted per task by the user,
 *     bound to a session and a run generation, bounded by an action count and a duration,
 *     and revoked by anything that ends the run (disconnect, stop, workspace change, a new
 *     generation, expiry). It is never written to disk, so it cannot be revived by
 *     reloading a session.
 *  2. **A failure stops the batch.** After a refused or failed action, further actions are
 *     refused until the model supplies a *new* observation and the user continues. This is
 *     what stops a plan from continuing to click after the window it was based on changed.
 */

import {
  ORB_LIMITS,
  describeRefusal,
  validateAction,
  type ActionRefusal,
  type DesktopAction,
  type DesktopObservation,
} from "@shared/orb-tools";

export interface TaskAuthorization {
  readonly taskId: string;
  readonly sessionId: string;
  readonly generation: number;
  readonly grantedAt: number;
  readonly expiresAt: number;
  /** Free-text scope the user approved, for reporting. */
  readonly scope: string;
}

export interface AuthorizationRequest {
  readonly sessionId: string;
  readonly generation: number;
  readonly scope: string;
  readonly now?: number;
}

export interface DesktopTaskState {
  readonly authorization: TaskAuthorization | null;
  readonly actionsUsed: number;
  readonly stopped: boolean;
  readonly stoppedReason: string | null;
  readonly lastObservationId: string | null;
}

export class DesktopTaskController {
  #authorization: TaskAuthorization | null = null;
  #actionsUsed = 0;
  #stopped = false;
  #stoppedReason: string | null = null;
  #lastObservationId: string | null = null;
  #taskCounter = 0;

  get state(): DesktopTaskState {
    return {
      authorization: this.#authorization,
      actionsUsed: this.#actionsUsed,
      stopped: this.#stopped,
      stoppedReason: this.#stoppedReason,
      lastObservationId: this.#lastObservationId,
    };
  }

  get authorized(): boolean {
    return this.#authorization !== null && !this.#expired(Date.now());
  }

  /** True when this controller currently holds a task grant that has not expired. */
  isAuthorizedAt(now: number): boolean {
    return this.#authorization !== null && !this.#expired(now);
  }

  /**
   * Grant a task authorization.
   *
   * A new grant replaces any previous one, so approving a fresh task cannot inherit the
   * previous task's remaining budget or its stopped state.
   */
  authorize(request: AuthorizationRequest): TaskAuthorization {
    const now = request.now ?? Date.now();
    this.#taskCounter += 1;
    this.#authorization = {
      taskId: `task-${this.#taskCounter}`,
      sessionId: request.sessionId,
      generation: request.generation,
      grantedAt: now,
      expiresAt: now + ORB_LIMITS.maxTaskDurationMs,
      scope: request.scope,
    };
    this.#actionsUsed = 0;
    this.#stopped = false;
    this.#stoppedReason = null;
    return this.#authorization;
  }

  /**
   * Revoke authorization. Idempotent.
   *
   * Called on stop, disconnect, workspace change, session change and shutdown. Every
   * caller goes through here so there is exactly one revocation path.
   */
  revoke(): void {
    this.#authorization = null;
    this.#actionsUsed = 0;
    this.#stopped = false;
    this.#stoppedReason = null;
    this.#lastObservationId = null;
  }

  /** True when the current authorization belongs to a different run. */
  isForGeneration(generation: number): boolean {
    return this.#authorization?.generation === generation;
  }

  isForSession(sessionId: string): boolean {
    return this.#authorization?.sessionId === sessionId;
  }

  /**
   * Record a successful observation.
   *
   * A new observation clears the stopped state only when it is accompanied by an explicit
   * continuation decision by the caller: an observation alone must not silently un-stop a
   * batch that failed.
   */
  observe(observationId: string): void {
    this.#lastObservationId = observationId;
  }

  /** Clear the stopped state after the user explicitly continues. */
  continueAfterStop(): void {
    this.#stopped = false;
    this.#stoppedReason = null;
  }

  /**
   * Decide whether an action may run, and account for it.
   *
   * `observation` must be the *current* observation; passing an older one yields
   * `stale-observation` from the shared validator.
   */
  check(
    action: DesktopAction,
    observation: DesktopObservation | null,
    now: number = Date.now(),
  ): ActionRefusal | null {
    if (!this.#authorization) return "no-task-authorization";
    if (this.#expired(now)) {
      // Expiry is enforced here, not merely reported at the end.
      this.#stopped = true;
      this.#stoppedReason = describeRefusal("task-expired");
      return "task-expired";
    }
    const refusal = validateAction(action, observation, {
      actionsUsed: this.#actionsUsed,
      expired: false,
      stopped: this.#stopped,
    });
    if (refusal !== null) return refusal;

    this.#actionsUsed += 1;
    return null;
  }

  /**
   * Record the outcome of an action that was allowed to run.
   *
   * A failure stops the batch. That is the mechanism behind "do not continue a batch after
   * a failed action": the next call returns `batch-stopped` until the user continues.
   */
  recordOutcome(ok: boolean, detail: string | null): void {
    if (ok) return;
    this.#stopped = true;
    this.#stoppedReason = detail ?? "The action failed.";
  }

  #expired(now: number): boolean {
    return this.#authorization !== null && now >= this.#authorization.expiresAt;
  }
}

/**
 * What an executor returns for one observation.
 *
 * `observation` is `null` when the window could not be identified; the caller must then
 * report the reason instead of acting, because acting blind on an unknown window is exactly
 * the failure this guards against.
 */
export interface ObserveResult {
  readonly ok: boolean;
  readonly observation: DesktopObservation | null;
  readonly error: string | null;
}

export interface ActResult {
  readonly ok: boolean;
  readonly error: string | null;
  /** True when the action was refused by policy rather than failing in the driver. */
  readonly refused: boolean;
}

/**
 * The driver seam.
 *
 * The broker talks to the Cua driver only through this interface, so the batch rules can
 * be tested without a real desktop and so P1-07 can swap or stub the driver.
 */
export interface DesktopDriver {
  /** Observe one window and return the current element list. */
  observe(input: { readonly windowId?: string }): Promise<ObserveResult>;
  /** Deliver exactly one action against an observed window. */
  act(action: DesktopAction, observation: DesktopObservation): Promise<ActResult>;
  /**
   * Drop the current observation after an action ran.
   *
   * This is what enforces "act once, then observe again": without it the same observation could
   * be replayed, and a plan could chain actions on a picture that is no longer true.
   */
  consumeObservation?(): void;
}
