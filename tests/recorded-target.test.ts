import { describe, expect, it, vi } from "vitest";
import { RecordedTargetStore } from "../src/main/recorded-target";
import type { CaptureTarget } from "@shared/screenshot";

function target(overrides: Partial<CaptureTarget> = {}): CaptureTarget {
  return {
    handle: "329270",
    processId: 4242,
    title: "Editor — notes.txt",
    bounds: { x: 0, y: 0, width: 1200, height: 800 },
    dpi: 144,
    ...overrides,
  };
}

function makeStore(options: {
  foreground?: CaptureTarget | null;
  stillValid?: boolean;
  currentTitle?: string;
} = {}) {
  const reads: number[] = [];
  const validityChecks: { handle: string; title: string }[] = [];
  const logs: string[] = [];
  const instance = new RecordedTargetStore({
    readForeground: async () => {
      reads.push(1);
      return options.foreground === undefined ? target() : options.foreground;
    },
    isStillValid: async (handle, title) => {
      validityChecks.push({ handle, title });
      return {
        valid: options.stillValid ?? true,
        currentTitle: options.currentTitle ?? (options.stillValid === false ? "" : title),
      };
    },
    now: () => 7_000,
    log: (message) => logs.push(message),
  });
  return { store: instance, reads, validityChecks, logs };
}

describe("RecordedTargetStore.record", () => {
  it("stores the foreground window with the time and records a useful log line", async () => {
    const { store, logs } = makeStore();
    const outcome = await store.record();
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.snapshot.target.handle).toBe("329270");
      expect(outcome.snapshot.recordedAt).toBe(7_000);
    }
    expect(store.recordCount).toBe(1);
    expect(logs[0]).toContain("Editor — notes.txt");
  });

  it("refuses rather than storing nothing silently when there is no foreground window", async () => {
    // This is the case where the orb already took focus: the record must fail loudly, because a
    // silent empty record would later look like \"nothing to capture\" with no explanation.
    const { store } = makeStore({ foreground: null });
    const outcome = await store.record();
    expect(outcome).toEqual({ ok: false, reason: "no-foreground-window" });
    expect(store.snapshot).toBeNull();
    expect(store.recordCount).toBe(0);
  });

  it("treats a reader failure as no window rather than throwing into the wake path", async () => {
    const failing = new RecordedTargetStore({
      readForeground: async () => {
        throw new Error("helper exploded");
      },
      isStillValid: async () => ({ valid: true, currentTitle: "" }),
    });
    expect(await failing.record()).toEqual({ ok: false, reason: "no-foreground-window" });
  });

  it("replaces a previous record, so waking again re-reads the current window", async () => {
    let current = target({ title: "First" });
    const store = new RecordedTargetStore({
      readForeground: async () => current,
      isStillValid: async () => ({ valid: true, currentTitle: "" }),
    });
    await store.record();
    expect(store.snapshot?.target.title).toBe("First");
    current = target({ title: "Second" });
    await store.record();
    expect(store.snapshot?.target.title).toBe("Second");
    expect(store.recordCount).toBe(2);
  });

  it("drops the previous record when a new record cannot be taken", async () => {
    // Real defect found by running the product: with the native helper missing from the build, the
    // wake could not read a foreground window, the store kept the target recorded at startup, and a
    // capture would have silently used a window the user had long since moved away from. A record
    // that cannot be taken must leave no record, not a stale one.
    let current: ReturnType<typeof target> | null = target({ title: "Chrome — someone else's window" });
    const store = new RecordedTargetStore({
      readForeground: async () => current,
      isStillValid: async () => ({ valid: true, currentTitle: "" }),
    });
    await store.record();
    expect(store.snapshot?.target.title).toBe("Chrome — someone else's window");

    current = null;
    const outcome = await store.record();
    expect(outcome.ok).toBe(false);
    expect(store.snapshot).toBeNull();
    expect((await store.validate()).reason).toBe("no-record");
  });
});

describe("RecordedTargetStore.validate", () => {
  it("accepts the recorded window while it still exists, even though it is not in front", async () => {
    // The recorded window is deliberately not in front any more: the user switched to the orb. A
    // foreground test would refuse here, which is what made every capture fail.
    const { store, validityChecks } = makeStore();
    await store.record();
    const validity = await store.validate();
    expect(validity.valid).toBe(true);
    expect(validity.reason).toBe("ok");
    expect(validityChecks[0]).toEqual({ handle: "329270", title: "Editor — notes.txt" });
  });

  it("refuses when nothing was recorded", async () => {
    const { store } = makeStore();
    const validity = await store.validate();
    expect(validity.valid).toBe(false);
    expect(validity.reason).toBe("no-record");
    expect(validity.snapshot).toBeNull();
  });

  it("reports a destroyed window as gone, not as changed", async () => {
    const { store } = makeStore({ stillValid: false });
    await store.record();
    const validity = await store.validate();
    expect(validity.valid).toBe(false);
    expect(validity.reason).toBe("window-gone");
  });

  it("reports a recycled handle as changed and says what the window is now", async () => {
    const { store } = makeStore({ stillValid: false, currentTitle: "A different window" });
    await store.record();
    const validity = await store.validate();
    expect(validity.valid).toBe(false);
    expect(validity.reason).toBe("window-changed");
    expect(validity.currentTitle).toBe("A different window");
  });

  it("treats a failing validity probe as invalid rather than assuming validity", async () => {
    const failing = new RecordedTargetStore({
      readForeground: async () => target(),
      isStillValid: async () => {
        throw new Error("probe failed");
      },
    });
    await failing.record();
    const validity = await failing.validate();
    expect(validity.valid).toBe(false);
    expect(validity.reason).toBe("window-gone");
  });
});

describe("RecordedTargetStore.clear", () => {
  it("drops the record so a later capture cannot reuse a window the user moved on from", async () => {
    const { store } = makeStore();
    await store.record();
    store.clear();
    expect(store.snapshot).toBeNull();
    const validity = await store.validate();
    expect(validity.reason).toBe("no-record");
  });

  it("keeps the record count, since it counts recordings rather than the current record", async () => {
    const { store } = makeStore();
    await store.record();
    store.clear();
    expect(store.recordCount).toBe(1);
  });

  it("is idempotent", () => {
    const { store } = makeStore();
    store.clear();
    store.clear();
    expect(store.snapshot).toBeNull();
  });
});

describe("RecordedTargetStore ordering", () => {
  it("reads the foreground window once per recording and never during validation", async () => {
    // Select at screenshot request time, then keep the reviewed target stable during validation.
    const { store, reads, validityChecks } = makeStore();
    await store.record();
    expect(reads).toHaveLength(1);
    await store.validate();
    await store.validate();
    expect(reads).toHaveLength(1);
    expect(validityChecks).toHaveLength(2);
  });

  it("does not read the foreground window when asked to validate without a record", async () => {
    const { store, reads } = makeStore();
    await store.validate();
    expect(reads).toHaveLength(0);
  });

  it("exposes the snapshot synchronously so callers cannot mistake a pending read for a record", async () => {
    const { store } = makeStore();
    expect(store.snapshot).toBeNull();
    const pending = store.record();
    // Before the read resolves the field is still null: there is no half-recorded state.
    expect(store.snapshot).toBeNull();
    await pending;
    expect(store.snapshot).not.toBeNull();
  });
});

describe("RecordedTargetStore failure signalling", () => {
  it("reports that no application window is available when selection fails", async () => {
    const logs: string[] = [];
    const store = new RecordedTargetStore({
      readForeground: async () => null,
      isStillValid: async () => ({ valid: true, currentTitle: "" }),
      log: (message) => logs.push(message),
    });
    await store.record();
    expect(logs.join("\n")).toMatch(/no application window is available/i);
  });

  it("does not attempt a validity check when recording failed", async () => {
    const isStillValid = vi.fn(async () => ({ valid: true, currentTitle: "" }));
    const store = new RecordedTargetStore({
      readForeground: async () => null,
      isStillValid,
    });
    await store.record();
    await store.validate();
    expect(isStillValid).not.toHaveBeenCalled();
  });
});
