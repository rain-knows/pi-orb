import { describe, expect, it } from "vitest";
import { DesktopBroker, parseAction } from "../src/main/desktop-broker";
import type { ActResult, DesktopDriver, ObserveResult } from "../src/main/desktop-task";
import type { DesktopAction, DesktopObservation } from "@shared/orb-tools";

function observation(id = "obs-1", withImage = false): DesktopObservation {
  return {
    observationId: id,
    at: Date.now(),
    window: {
      id: "329270",
      pid: 4242,
      title: "Editor",
      appName: "editor.exe",
      bounds: { x: 0, y: 0, width: 1200, height: 800 },
    },
    coordinateSpace: {
      action: "screenshot-fraction",
      space: 1000,
      windowRect: { x: 0, y: 0, width: 1200, height: 800 },
    },
    elements: [{ token: "s1:0", role: "Button", label: "OK", actions: ["invoke"] }],
    ...(withImage ? { image: { data: "AQID", mimeType: "image/png", width: 1, height: 1 } } : {}),
    elementsUnavailable: false,
    degraded: false,
  };
}

/** A driver double that records what it was asked to do and can be made to fail. */
interface DriverDouble extends DesktopDriver {
  readonly observed: number;
  readonly acted: DesktopAction[];
  readonly observeInputs: { readonly windowId?: string; readonly includeImage?: boolean }[];
  readonly consumed: number;
  readonly lastObservation: DesktopObservation | null;
}

/** A driver double that records what it was asked to do and can be made to fail. */
function fakeDriver(
  options: {
    readonly observeFails?: string;
    readonly actFails?: ActResult;
    readonly actWait?: (signal: AbortSignal) => Promise<ActResult>;
    readonly actObservation?: boolean;
  } = {},
): DriverDouble {
  const acted: DesktopAction[] = [];
  const observeInputs: { readonly windowId?: string; readonly includeImage?: boolean }[] = [];
  let observed = 0;
  let consumed = 0;
  let current: DesktopObservation | null = null;

  // Getters are defined, not copied: `Object.assign` would snapshot the value at assign
  // time and the broker would always see `undefined` as the current observation.
  return {
    get observed() {
      return observed;
    },
    get acted() {
      return acted;
    },
    get observeInputs() {
      return observeInputs;
    },
    get consumed() {
      return consumed;
    },
    get lastObservation() {
      return current;
    },
    async observe(input): Promise<ObserveResult> {
      observeInputs.push(input);
      observed += 1;
      if (options.observeFails) return { ok: false, observation: null, error: options.observeFails };
      current = observation(`obs-${observed}`, input.includeImage === true);
      return { ok: true, observation: current, error: null };
    },
    async act(action, _observation, signal): Promise<ActResult> {
      acted.push(action);
      if (options.actWait && signal) return options.actWait(signal);
      if (options.actFails) return options.actFails;
      if (options.actObservation) {
        current = observation(`obs-after-${acted.length}`, true);
        return { ok: true, refused: false, error: null, observation: current };
      }
      return { ok: true, refused: false, error: null };
    },
    consumeObservation(): void {
      consumed += 1;
      current = null;
    },
  };
}

function broker(options: Parameters<typeof fakeDriver>[0] = {}, live = true) {
  const driver = fakeDriver(options);
  const logs: Record<string, unknown>[] = [];
  const instance = new DesktopBroker({
    driver,
    isLive: () => live,
    log: (entry) => logs.push(entry),
  });
  return { broker: instance, driver, logs };
}

const click = (observationId: string): DesktopAction => ({
  kind: "click",
  observationId,
  position: { x: 500, y: 500 },
});

describe("DesktopBroker authorization", () => {
  it("does not report authorized before a grant", () => {
    const { broker: instance } = broker();
    expect(instance.status().authorized).toBe(false);
  });

  it("refuses an action before any grant, and never reaches the driver", async () => {
    const { broker: instance, driver } = broker();
    const result = (await instance.act(click("obs-1"), "sess", 1)) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: false, refused: true, reason: "no-task-authorization" });
    // The decisive assertion: a refused action has no side effect.
    expect(driver.acted).toHaveLength(0);
  });

  it("runs an action after an explicit grant", async () => {
    const { broker: instance, driver } = broker();
    await instance.observe("sess", 1);
    instance.authorize({ sessionId: "sess", generation: 1, scope: "click the button" });
    const result = (await instance.act(click("obs-1"), "sess", 1)) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(driver.acted).toHaveLength(1);
  });

  it("refuses a request from a run that is no longer live", async () => {
    const { broker: instance, driver } = broker({}, false);
    instance.authorize({ sessionId: "sess", generation: 1, scope: "x" });
    const result = (await instance.act(click("obs-1"), "sess", 1)) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: false, reason: "stale-generation" });
    expect(driver.acted).toHaveLength(0);
  });

  it("stops everything after a revoke", async () => {
    const { broker: instance, driver } = broker();
    await instance.observe("sess", 1);
    instance.authorize({ sessionId: "sess", generation: 1, scope: "x" });
    instance.revoke();
    const result = (await instance.act(click("obs-1"), "sess", 1)) as Record<string, unknown>;
    expect(result).toMatchObject({ reason: "no-task-authorization" });
    expect(driver.acted).toHaveLength(0);
    expect(driver.consumed).toBe(1);
  });

  it("does not let a new grant reuse an observation from the revoked task", async () => {
    const { broker: instance, driver } = broker();
    instance.authorize({ sessionId: "sess", generation: 1, scope: "first task" });
    await instance.observe("sess", 1);
    instance.revoke();
    instance.authorize({ sessionId: "sess", generation: 1, scope: "second task" });

    const result = (await instance.act(click("obs-1"), "sess", 1)) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: false, reason: "observation-unknown" });
    expect(driver.acted).toHaveLength(0);
    expect(driver.consumed).toBe(1);
    expect(instance.status().lastObservationId).toBe(null);
  });

  it("aborts an in-flight action on revoke without accounting it to a replacement task", async () => {
    let actionSignal: AbortSignal | undefined;
    let finishAction: ((result: ActResult) => void) | undefined;
    const actionDone = new Promise<ActResult>((resolve) => {
      finishAction = resolve;
    });
    const { broker: instance } = broker({
      actWait: (signal) => {
        actionSignal = signal;
        return actionDone;
      },
    });

    instance.authorize({ sessionId: "sess", generation: 1, scope: "first task" });
    const observed = (await instance.observe("sess", 1)) as Record<string, unknown>;
    const action = instance.act(click(String(observed.observationId)), "sess", 1);
    await Promise.resolve();
    expect(actionSignal).toBeDefined();

    instance.revoke();
    expect(actionSignal?.aborted).toBe(true);
    finishAction?.({ ok: false, refused: false, error: "desktop task was revoked" });

    await expect(action).resolves.toMatchObject({ ok: false, reason: "no-task-authorization" });
    instance.authorize({ sessionId: "sess", generation: 1, scope: "replacement task" });
    expect(instance.status()).toMatchObject({ authorized: true, actionsUsed: 0, lastObservationId: null });
  });

  it("reports the approved scope and the remaining action budget", async () => {
    const { broker: instance } = broker();
    instance.authorize({ sessionId: "sess", generation: 1, scope: "fill the form" });
    const status = instance.status();
    expect(status.scope).toBe("fill the form");
    expect(status.authorized).toBe(true);
    expect(status.actionsUsed).toBe(0);
  });
});

describe("DesktopBroker observation", () => {
  it("shares an observation image only for the exact authorized task", async () => {
    const { broker: instance, driver } = broker();
    const beforeGrant = await instance.observe("sess", 1) as Record<string, unknown>;
    expect(beforeGrant.image).toBeUndefined();
    expect(driver.observeInputs[0]).toEqual({});

    instance.authorize({ sessionId: "sess", generation: 1, scope: "inspect and operate the selected test window" });
    const authorized = await instance.observe("sess", 1) as Record<string, unknown>;
    expect(authorized.image).toMatchObject({ mimeType: "image/png" });
    expect(driver.observeInputs[1]).toEqual({ includeImage: true });
  });

  it("returns the observation and records it", async () => {
    const { broker: instance } = broker();
    const result = (await instance.observe("sess", 1)) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(typeof result.observationId).toBe("string");
    expect(instance.status().lastObservationId).toBe(result.observationId);
  });

  it("reports a failed observation as a refusal instead of acting blind", async () => {
    const { broker: instance, driver } = broker({ observeFails: "no suitable target window" });
    const result = (await instance.observe("sess", 1)) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: false, refused: true });
    expect(String(result.message)).toContain("no suitable target window");
    expect(driver.acted).toHaveLength(0);
  });

  it("does not require authorization merely to observe", async () => {
    // Observing is read-only, so it must be usable to decide whether to ask for a task.
    const { broker: instance } = broker();
    const result = (await instance.observe("sess", 1)) as Record<string, unknown>;
    expect(result.ok).toBe(true);
  });
});

describe("DesktopBroker one-action-one-observation", () => {
  it("returns a fresh image observation after each successful authorized action", async () => {
    const { broker: instance, driver } = broker({ actObservation: true });
    instance.authorize({ sessionId: "sess", generation: 1, scope: "operate the selected test window" });
    const first = await instance.observe("sess", 1) as Record<string, unknown>;
    const result = await instance.act(click(String(first.observationId)), "sess", 1) as Record<string, unknown>;

    expect(result.observation).toMatchObject({ observationId: "obs-after-1", image: { data: "AQID" } });
    expect(instance.status().lastObservationId).toBe("obs-after-1");
    expect(driver.consumed).toBe(0);

    const second = await instance.act(click("obs-after-1"), "sess", 1) as Record<string, unknown>;
    expect(second.ok).toBe(true);
    expect(driver.acted).toHaveLength(2);
  });

  it("refuses an action whose observation is stale", async () => {
    const { broker: instance, driver } = broker();
    instance.authorize({ sessionId: "sess", generation: 1, scope: "x" });
    await instance.observe("sess", 1); // creates obs-1
    const stale = click("obs-from-an-earlier-turn");
    const result = (await instance.act(stale, "sess", 1)) as Record<string, unknown>;
    expect(result).toMatchObject({ reason: "stale-observation" });
    expect(driver.acted).toHaveLength(0);
  });

  it("accepts an action against the current observation", async () => {
    const { broker: instance } = broker();
    instance.authorize({ sessionId: "sess", generation: 1, scope: "x" });
    const observed = (await instance.observe("sess", 1)) as Record<string, unknown>;
    const result = (await instance.act(click(String(observed.observationId)), "sess", 1)) as Record<string, unknown>;
    expect(result.ok).toBe(true);
  });

  it("tells the model to observe again after a successful action", async () => {
    const { broker: instance } = broker();
    instance.authorize({ sessionId: "sess", generation: 1, scope: "x" });
    const observed = (await instance.observe("sess", 1)) as Record<string, unknown>;
    const result = (await instance.act(click(String(observed.observationId)), "sess", 1)) as Record<string, unknown>;
    expect(String(result.next)).toMatch(/observe/i);
  });

  it("uses a fresh observation for each action in a sequence", async () => {
    const { broker: instance, driver } = broker();
    instance.authorize({ sessionId: "sess", generation: 1, scope: "x" });

    const first = (await instance.observe("sess", 1)) as Record<string, unknown>;
    expect(((await instance.act(click(String(first.observationId)), "sess", 1)) as Record<string, unknown>).ok).toBe(true);

    const second = (await instance.observe("sess", 1)) as Record<string, unknown>;
    expect(((await instance.act(click(String(second.observationId)), "sess", 1)) as Record<string, unknown>).ok).toBe(true);

    // Acting twice from the first observation must be refused.
    const replay = (await instance.act(click(String(first.observationId)), "sess", 1)) as Record<string, unknown>;
    expect(replay).toMatchObject({ reason: "observation-unknown" });
    expect(driver.acted).toHaveLength(2);
  });
});

describe("DesktopBroker failure handling", () => {
  it("refuses each new desktop action before reaching the driver without authorization", async () => {
    const { broker: instance, driver } = broker();
    const actions = [
      { kind: "hotkey", observationId: "obs-1", keys: ["ctrl", "c"] },
      { kind: "longPress", observationId: "obs-1", position: { x: 10, y: 20 }, durationSeconds: 2 },
      { kind: "drag", observationId: "obs-1", startPosition: { x: 10, y: 20 }, endPosition: { x: 30, y: 40 } },
    ];
    for (const action of actions) {
      await expect(instance.act(action, "sess", 1)).resolves.toMatchObject({
        ok: false,
        refused: true,
        reason: "no-task-authorization",
      });
    }
    expect(driver.acted).toHaveLength(0);
  });

  it("stops the batch after a driver failure and says so", async () => {
    const { broker: instance } = broker({
      actFails: { ok: false, refused: true, error: "foreground_unavailable" },
    });
    instance.authorize({ sessionId: "sess", generation: 1, scope: "x" });
    const observed = (await instance.observe("sess", 1)) as Record<string, unknown>;

    const failed = (await instance.act(click(String(observed.observationId)), "sess", 1)) as Record<string, unknown>;
    expect(failed.ok).toBe(false);
    expect(String(failed.message)).toContain("foreground_unavailable");
    expect(String(failed.message)).toMatch(/stopped/i);

    // The next action must be refused, not retried blindly.
    const next = (await instance.observe("sess", 1)) as Record<string, unknown>;
    const after = (await instance.act(click(String(next.observationId)), "sess", 1)) as Record<string, unknown>;
    expect(after).toMatchObject({ reason: "batch-stopped" });
  });

  it("marks a policy refusal separately from a driver failure", async () => {
    const { broker: instance } = broker();
    const refused = (await instance.act(click("obs-1"), "sess", 1)) as Record<string, unknown>;
    expect(refused.refused).toBe(true);
    expect(refused.reason).toBe("no-task-authorization");
  });

  it("refuses a malformed action payload without touching the driver", async () => {
    const { broker: instance, driver } = broker();
    instance.authorize({ sessionId: "sess", generation: 1, scope: "x" });
    for (const payload of [null, "click", { kind: "click" }, { kind: "unknown", observationId: "obs-1" }]) {
      const result = (await instance.act(payload, "sess", 1)) as Record<string, unknown>;
      expect(result).toMatchObject({ ok: false, refused: true, reason: "malformed" });
    }
    expect(driver.acted).toHaveLength(0);
  });

  it("rejects an action that names no observation", async () => {
    const { broker: instance, driver } = broker();
    instance.authorize({ sessionId: "sess", generation: 1, scope: "x" });
    const result = (await instance.act({ kind: "click", position: { x: 500, y: 500 } }, "sess", 1)) as Record<string, unknown>;
    expect(result).toMatchObject({ reason: "malformed" });
    expect(driver.acted).toHaveLength(0);
  });
});

describe("parseAction", () => {
  it("rejects element tokens unsupported by the Windows backend", () => {
    const parsed = parseAction({ kind: "click", observationId: "obs-1", elementToken: "s1:0" });
    expect(parsed.ok).toBe(false);
  });

  it("accepts a click with a screenshot fraction", () => {
    const parsed = parseAction({ kind: "click", observationId: "obs-1", position: { x: 1, y: 2 } });
    expect(parsed.ok).toBe(true);
  });

  it("refuses an element token even when a position is present", () => {
    const parsed = parseAction({
      kind: "click",
      observationId: "obs-1",
      elementToken: "s1:0",
      position: { x: 1, y: 2 },
    });
    expect(parsed).toMatchObject({ ok: false });
  });

  it("refuses a click without a position", () => {
    expect(parseAction({ kind: "click", observationId: "obs-1" })).toMatchObject({ ok: false });
  });

  it("refuses a position with a non-numeric coordinate", () => {
    expect(parseAction({ kind: "click", observationId: "obs-1", position: { x: "1", y: 2 } })).toMatchObject({ ok: false });
  });

  it("accepts a type action and refuses a non-string text", () => {
    expect(parseAction({ kind: "type", observationId: "obs-1", text: "hello", position: { x: 100, y: 200 }, replace: true, submit: true }).ok).toBe(true);
    expect(parseAction({ kind: "type", observationId: "obs-1", text: "hello" }).ok).toBe(false);
    expect(parseAction({ kind: "type", observationId: "obs-1", text: 5 })).toMatchObject({ ok: false });
  });

  it("accepts vertical scroll and refuses unsupported directions", () => {
    for (const direction of ["up", "down"]) {
      expect(parseAction({ kind: "scroll", observationId: "obs-1", direction, amount: 2, position: { x: 200, y: 300 } }).ok).toBe(true);
    }
    expect(parseAction({ kind: "scroll", observationId: "obs-1", direction: "left", amount: 2, position: { x: 200, y: 300 } }).ok).toBe(false);
    expect(parseAction({ kind: "scroll", observationId: "obs-1", direction: "sideways", amount: 2 })).toMatchObject({
      ok: false,
    });
  });

  it("refuses a scroll with a non-numeric amount", () => {
    expect(parseAction({ kind: "scroll", observationId: "obs-1", direction: "down", amount: "3" })).toMatchObject({
      ok: false,
    });
  });

  it("parses the bounded P2 desktop actions", () => {
    expect(parseAction({ kind: "hotkey", observationId: "obs-1", keys: ["ctrl", "c"] })).toMatchObject({ ok: true });
    expect(parseAction({ kind: "longPress", observationId: "obs-1", position: { x: 20, y: 30 }, durationSeconds: 2 })).toMatchObject({ ok: true });
    expect(parseAction({ kind: "drag", observationId: "obs-1", startPosition: { x: 20, y: 30 }, endPosition: { x: 70, y: 80 } })).toMatchObject({ ok: true });
    expect(parseAction({ kind: "drag", observationId: "obs-1", startPosition: { x: "20", y: 30 }, endPosition: { x: 70, y: 80 } })).toMatchObject({ ok: false });
    expect(parseAction({ kind: "wait", observationId: "obs-1" })).toMatchObject({ ok: true });
    expect(parseAction({ kind: "longWait", observationId: "obs-1", waitSeconds: 30 })).toMatchObject({ ok: true });
    expect(parseAction({ kind: "listApps", observationId: "obs-1" })).toMatchObject({ ok: true });
  });
});
