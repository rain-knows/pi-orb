import { describe, expect, it } from "vitest";
import { RunGenerations } from "../src/main/generations";

describe("RunGenerations", () => {
  it("refuses any request before a run has begun", () => {
    const generations = new RunGenerations();
    expect(generations.check(1)).toEqual({ ok: false, reason: "no-run" });
    expect(generations.tryAcquire(1)).toBe(false);
  });

  it("accepts only the current generation", () => {
    const generations = new RunGenerations();
    const first = generations.begin();
    expect(generations.check(first)).toEqual({ ok: true });

    const second = generations.begin();
    expect(second).toBe(first + 1);
    expect(generations.check(first)).toEqual({ ok: false, reason: "stale-generation" });
    expect(generations.check(second)).toEqual({ ok: true });
  });

  it("rejects malformed generation values instead of coercing them", () => {
    const generations = new RunGenerations();
    generations.begin();
    for (const value of ["1", 1.5, null, undefined, {}, Number.NaN]) {
      expect(generations.check(value)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("holds a single-task lock and refuses a second concurrent claim", () => {
    const generations = new RunGenerations();
    const generation = generations.begin();
    expect(generations.tryAcquire(generation)).toBe(true);
    expect(generations.busy).toBe(true);
    expect(generations.tryAcquire(generation)).toBe(false);
    generations.release(generation);
    expect(generations.tryAcquire(generation)).toBe(true);
  });

  it("refuses the lock to a stale generation, so old work cannot act on a new run", () => {
    const generations = new RunGenerations();
    const first = generations.begin();
    generations.tryAcquire(first);
    const second = generations.begin();
    expect(generations.check(first)).toEqual({ ok: false, reason: "stale-generation" });
    expect(generations.tryAcquire(first)).toBe(false);
    // A new run must not inherit the previous run's lock.
    expect(generations.busy).toBe(false);
    expect(generations.tryAcquire(second)).toBe(true);
  });

  it("ignores a release from a stale generation", () => {
    const generations = new RunGenerations();
    const first = generations.begin();
    const second = generations.begin();
    generations.tryAcquire(second);
    generations.release(first);
    expect(generations.busy).toBe(true);
  });

  it("clears the lock when a run ends", () => {
    const generations = new RunGenerations();
    const generation = generations.begin();
    generations.tryAcquire(generation);
    generations.end();
    expect(generations.busy).toBe(false);
    expect(generations.check(generation)).toEqual({
      ok: false,
      reason: "stale-generation",
    });
  });
});
