/**
 * Run-generation tracking.
 *
 * A "generation" identifies one live Orb run (one app/renderer instance bound to
 * one configuration). Every request from a client carries the generation it was
 * produced under, and requests from an older generation are refused.
 *
 * Why this exists (see evidence/p0-05/DECISION.md §2 and §5):
 * `lib/session-revision.ts`'s `snapshotRevision` in pi-web is a *client cache
 * validity token*, not an authorization or generation check. Nothing in pi-web
 * can bind a request to a run instance, so the execution layer must do it.
 *
 * This module is deliberately free of Electron, filesystem and network access so
 * its rules can be tested directly.
 */

export type GenerationCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "no-run" | "stale-generation" | "malformed" };

export class RunGenerations {
  #current = 0;
  #busy = false;

  /** The generation of the run currently accepting work. `0` means "no run". */
  get current(): number {
    return this.#current;
  }

  /**
   * Begin a new run: invalidates every request from the previous generation and
   * clears the single-task lock, because a lock held by a dead run must never
   * block the new one.
   */
  begin(): number {
    this.#current += 1;
    this.#busy = false;
    return this.#current;
  }

  /** Invalidate all outstanding work without starting a new run. */
  end(): void {
    this.#current += 1;
    this.#busy = false;
  }

  check(generation: unknown): GenerationCheck {
    if (typeof generation !== "number" || !Number.isInteger(generation)) {
      return { ok: false, reason: "malformed" };
    }
    if (this.#current === 0) return { ok: false, reason: "no-run" };
    if (generation !== this.#current) return { ok: false, reason: "stale-generation" };
    return { ok: true };
  }

  /**
   * Claim the single-task lock for a generation.
   *
   * Only one desktop-adjacent task may run at a time across all sessions
   * (doc §6.2 `executionMode:'sequential'` plus a broker lock). Returns `false`
   * when the run is busy, so a new GUI task is refused instead of queued.
   */
  tryAcquire(generation: unknown): boolean {
    if (!this.check(generation).ok) return false;
    if (this.#busy) return false;
    this.#busy = true;
    return true;
  }

  release(generation: unknown): void {
    if (!this.check(generation).ok) return;
    this.#busy = false;
  }

  get busy(): boolean {
    return this.#busy;
  }
}
