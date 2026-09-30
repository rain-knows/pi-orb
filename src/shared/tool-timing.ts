/** Request-scoped timings; only durations and numeric image metadata leave this module. */
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

type Log = (entry: Record<string, unknown>) => void;
const requests = new AsyncLocalStorage<{ requestId: string; log: Log }>();

/** Keep correlation across async backend calls without process-global request state. */
export function withToolTiming<T>(requestId: string, log: Log, run: () => Promise<T>): Promise<T> {
  return requests.run({ requestId, log }, run);
}

/** Measure an async phase, including failures, without logging its arguments or result. */
export async function timeToolPhase<T>(phase: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try { return await run(); }
  finally { logToolMetric(phase, { durationMs: performance.now() - start }); }
}

/** Measure synchronous native enumeration and encoding without retaining pixels. */
export function timeToolSync<T>(phase: string, run: () => T): T {
  const start = performance.now();
  try { return run(); }
  finally { logToolMetric(phase, { durationMs: performance.now() - start }); }
}

/** Emit a numeric-only record to the request's existing log sink. */
export function logToolMetric(phase: string, values: Record<string, number>): void {
  const request = requests.getStore();
  request?.log({ event: "tool-timing", requestId: request.requestId, phase, ...values });
}
