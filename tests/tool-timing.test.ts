import { expect, it } from "vitest";
import { logToolMetric, timeToolPhase, withToolTiming } from "../src/shared/tool-timing";

it("isolates concurrent request timings and logs failure durations without payloads", async () => {
  const logs: Record<string, unknown>[] = [];
  await Promise.all(["one", "two"].map(requestId => withToolTiming(requestId, e => logs.push(e), async () => {
    await expect(timeToolPhase("capture", async () => { await Promise.resolve(); throw new Error("secret"); })).rejects.toThrow("secret");
    logToolMetric("image", { bytes: 123 });
  })));
  expect(logs.filter(e => e.requestId === "one")).toHaveLength(2);
  expect(logs.filter(e => e.requestId === "two")).toHaveLength(2);
  expect(JSON.stringify(logs)).not.toContain("secret");
  expect(logs.filter(e => e.phase === "capture").every(e => Number(e.durationMs) >= 0)).toBe(true);
});
