/** Session-level desktop access and one-action/one-observation policy. */

import {
  describeRefusal,
  validateAction,
  type ActionRefusal,
  type DesktopAction,
  type DesktopObservation,
} from "@shared/orb-tools";
import type { OrbAccessLevel } from "@shared/ipc";

export interface OrbAccessGrant {
  readonly sessionId: string;
  readonly generation: number;
  readonly level: OrbAccessLevel;
}

export interface OrbAccessRequest {
  readonly sessionId: string;
  readonly generation: number;
  readonly level: OrbAccessLevel;
}

export interface DesktopTaskState {
  readonly authorization: OrbAccessGrant | null;
  readonly stopped: boolean;
  readonly stoppedReason: string | null;
  readonly lastObservationId: string | null;
}

const READ_ONLY_ACTIONS = new Set<DesktopAction["kind"]>(["wait", "longWait", "listApps", "screenshot"]);

export function accessAllows(level: OrbAccessLevel, kind: DesktopAction["kind"]): boolean {
  if (level === "full-access") return true;
  if (level === "workspace-write") return kind !== "openApp";
  return READ_ONLY_ACTIONS.has(kind);
}

export class DesktopTaskController {
  #authorization: OrbAccessGrant | null = null;
  #stopped = false;
  #stoppedReason: string | null = null;
  #lastObservationId: string | null = null;

  get state(): DesktopTaskState {
    return {
      authorization: this.#authorization,
      stopped: this.#stopped,
      stoppedReason: this.#stoppedReason,
      lastObservationId: this.#lastObservationId,
    };
  }

  get authorized(): boolean {
    return this.#authorization !== null;
  }

  authorize(request: OrbAccessRequest): OrbAccessGrant {
    this.#authorization = {
      sessionId: request.sessionId,
      generation: request.generation,
      level: request.level,
    };
    this.#stopped = false;
    this.#stoppedReason = null;
    this.#lastObservationId = null;
    return this.#authorization;
  }

  revoke(): void {
    this.#authorization = null;
    this.#stopped = false;
    this.#stoppedReason = null;
    this.#lastObservationId = null;
  }

  observe(observationId: string): void {
    this.#lastObservationId = observationId;
  }

  clearObservation(): void {
    this.#lastObservationId = null;
  }

  check(
    action: DesktopAction,
    observation: DesktopObservation | null,
    request: { readonly sessionId: string; readonly generation: number },
  ): ActionRefusal | null {
    const grant = this.#authorization;
    if (!grant) return "no-task-authorization";
    if (grant.sessionId !== request.sessionId) return "no-task-authorization";
    if (grant.generation !== request.generation) return "stale-generation";
    if (!accessAllows(grant.level, action.kind)) return "access-level";
    if (this.#stopped) return "task-stopped";
    if (this.#lastObservationId === null || observation === null) return "observation-unknown";
    if (this.#lastObservationId !== observation.observationId) return "stale-observation";
    return validateAction(action, observation, { stopped: false });
  }

  recordOutcome(ok: boolean, detail: string | null): void {
    if (ok) return;
    this.#stopped = true;
    this.#stoppedReason = detail ?? "The action failed.";
  }
}

export interface ObserveResult {
  readonly ok: boolean;
  readonly observation: DesktopObservation | null;
  readonly error: string | null;
}

export type ActResult =
  | {
      readonly ok: true;
      readonly error: null;
      readonly refused: false;
      readonly observation: DesktopObservation;
      readonly apps?: readonly string[];
      readonly paths?: readonly string[];
      readonly app?: { readonly name: string; readonly kind: "activated" | "launched" };
    }
  | {
      readonly ok: false;
      readonly error: string | null;
      readonly refused: boolean;
      readonly reason?: "surface-changed";
      readonly observation?: DesktopObservation;
    };

export interface DesktopDriver {
  observe(input: { readonly includeImage?: boolean; readonly signal?: AbortSignal }): Promise<ObserveResult>;
  act(action: DesktopAction, observation: DesktopObservation, signal?: AbortSignal): Promise<ActResult>;
  consumeObservation?(): void;
  resetActionContext?(): void;
  readonly lastObservation?: DesktopObservation | null;
}

export function accessRefusalMessage(level: OrbAccessLevel, kind: DesktopAction["kind"]): string {
  return `${describeRefusal("access-level")} Current access: ${level}; requested action: ${kind}.`;
}
