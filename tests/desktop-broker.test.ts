import { describe, expect, it } from "vitest";
import { DesktopBroker } from "../src/main/desktop-broker";
import type { ActResult, DesktopDriver, ObserveResult } from "../src/main/desktop-task";
import type { DesktopAction, DesktopObservation } from "@shared/orb-tools";

function observation(id = "obs-1", withImage = false): DesktopObservation {
  return {
    observationId: id,
    at: Date.now(),
    window: { id: "329270", pid: 4242, title: "Editor", appName: "editor.exe", bounds: { x: 0, y: 0, width: 1200, height: 800 } },
    coordinateSpace: { action: "screenshot-fraction", space: 1000, windowRect: { x: 0, y: 0, width: 1200, height: 800 } },
    elements: [],
    ...(withImage ? { image: { data: "AQID", mimeType: "image/png", width: 1, height: 1 } } : {}),
    elementsUnavailable: true,
    degraded: false,
  };
}

function fakeDriver(options: { readonly fail?: boolean } = {}) {
  let current: DesktopObservation | null = null;
  const actions: DesktopAction[] = [];
  const consumed: number[] = [];
  const driver: DesktopDriver = {
    get lastObservation() { return current; },
    async observe(input): Promise<ObserveResult> {
      current = observation(`obs-${Date.now()}`, input.includeImage === true);
      return { ok: true, observation: current, error: null };
    },
    async act(action): Promise<ActResult> {
      actions.push(action);
      if (options.fail) return { ok: false, refused: false, error: "driver failure" };
      current = observation("fresh-after-action", true);
      return { ok: true, refused: false, error: null, observation: current };
    },
    consumeObservation() { consumed.push(1); current = null; },
  };
  return { driver, actions, consumed };
}

function createBroker(options: Parameters<typeof fakeDriver>[0] = {}) {
  const fake = fakeDriver(options);
  const broker = new DesktopBroker({ driver: fake.driver, isLive: () => true });
  return { ...fake, broker };
}

const click = (observationId: string): DesktopAction => ({ kind: "click", observationId, position: { x: 500, y: 500 } });
const openApp = (observationId: string): DesktopAction => ({ kind: "openApp", observationId, name: "Notepad" });

describe("DesktopBroker session access", () => {
  it("refuses actions until an access tier is selected", async () => {
    const { broker, actions } = createBroker();
    const result = await broker.act(click("obs-1"), "sess", 1) as Record<string, unknown>;
    expect(result).toMatchObject({ ok: false, reason: "no-task-authorization" });
    expect(actions).toHaveLength(0);
  });

  it("returns an image observation after selecting an access tier", async () => {
    const { broker, driver } = createBroker();
    broker.authorize({ sessionId: "sess", generation: 1, level: "workspace-write" });
    const result = await broker.observe("sess", 1) as Record<string, unknown>;
    expect(result.image).toMatchObject({ mimeType: "image/png" });
    expect(driver.lastObservation?.observationId).toBe(result.observationId);
    expect(broker.status()).toMatchObject({ authorized: true, level: "workspace-write", sessionId: "sess", generation: 1 });
  });

  it("refuses observations without the matching live session grant", async () => {
    const { broker, driver } = createBroker();
    expect(await broker.observe("sess", 1)).toMatchObject({ ok: false, reason: "no-task-authorization" });
    broker.authorize({ sessionId: "other-session", generation: 1, level: "read-only" });
    expect(await broker.observe("sess", 1)).toMatchObject({ ok: false, reason: "no-task-authorization" });
    broker.authorize({ sessionId: "sess", generation: 2, level: "read-only" });
    expect(await broker.observe("sess", 1)).toMatchObject({ ok: false, reason: "stale-generation" });
    expect(driver.lastObservation).toBeNull();
  });

  it("does not let an observation that finishes after regrant authorize an action", async () => {
    let releaseFirst!: (result: ObserveResult) => void;
    let startedFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => { startedFirst = resolve; });
    let current: DesktopObservation | null = null;
    let calls = 0;
    const driver: DesktopDriver = {
      get lastObservation() { return current; },
      async observe(input) {
        calls += 1;
        if (calls === 1) {
          startedFirst();
          return new Promise<ObserveResult>((resolve) => { releaseFirst = resolve; });
        }
        current = observation("new-grant-observation", input.includeImage === true);
        return { ok: true, observation: current, error: null };
      },
      async act() {
        return { ok: false, refused: true, error: "unexpected action" };
      },
      consumeObservation() { current = null; },
    };
    const broker = new DesktopBroker({ driver, isLive: () => true });
    broker.authorize({ sessionId: "sess", generation: 1, level: "workspace-write" });
    const staleObserve = broker.observe("sess", 1);
    await firstStarted;
    broker.revoke();
    broker.authorize({ sessionId: "sess", generation: 1, level: "workspace-write" });
    expect(await broker.observe("sess", 1)).toMatchObject({ reason: "busy" });
    releaseFirst({ ok: true, observation: observation("late-old-observation", true), error: null });
    expect(await staleObserve).toMatchObject({ ok: false, reason: "cancelled" });
    const currentResult = await broker.observe("sess", 1) as Record<string, unknown>;
    expect(currentResult).toMatchObject({ observationId: "new-grant-observation" });
    expect(broker.status().lastObservationId).toBe("new-grant-observation");
    expect(await broker.act(click("late-old-observation"), "sess", 1)).toMatchObject({ ok: false, reason: "stale-observation" });
  });

  it("blocks open_app at Workspace Write and permits it at Full Access", async () => {
    const { broker, actions } = createBroker();
    broker.authorize({ sessionId: "sess", generation: 1, level: "workspace-write" });
    const first = await broker.observe("sess", 1) as Record<string, unknown>;
    expect(await broker.act(openApp(String(first.observationId)), "sess", 1)).toMatchObject({ ok: false, reason: "access-level" });
    expect(actions).toHaveLength(0);

    broker.authorize({ sessionId: "sess", generation: 1, level: "full-access" });
    const second = await broker.observe("sess", 1) as Record<string, unknown>;
    await broker.act(openApp(String(second.observationId)), "sess", 1);
    expect(actions).toHaveLength(1);
  });

  it("returns the fresh post-action screenshot and accepts its observation id next", async () => {
    const { broker, actions } = createBroker();
    broker.authorize({ sessionId: "sess", generation: 1, level: "workspace-write" });
    const first = await broker.observe("sess", 1) as Record<string, unknown>;
    const result = await broker.act(click(String(first.observationId)), "sess", 1) as Record<string, unknown>;
    expect(result.observation).toMatchObject({ observationId: "fresh-after-action", image: { data: "AQID" } });
    expect(await broker.act(click("fresh-after-action"), "sess", 1)).toMatchObject({ ok: true });
    expect(actions).toHaveLength(2);
  });

  it("refuses stale observations before the driver runs", async () => {
    const { broker, actions } = createBroker();
    broker.authorize({ sessionId: "sess", generation: 1, level: "workspace-write" });
    await broker.observe("sess", 1);
    expect(await broker.act(click("old"), "sess", 1)).toMatchObject({ ok: false, reason: "stale-observation" });
    expect(actions).toHaveLength(0);
  });

  it("stops after a failed action and revocation clears the grant", async () => {
    const { broker, actions, consumed } = createBroker({ fail: true });
    broker.authorize({ sessionId: "sess", generation: 1, level: "workspace-write" });
    const seen = await broker.observe("sess", 1) as Record<string, unknown>;
    expect(await broker.act(click(String(seen.observationId)), "sess", 1)).toMatchObject({ ok: false, reason: "action-failed" });
    expect(await broker.act(click(String(seen.observationId)), "sess", 1)).toMatchObject({ ok: false, reason: "task-stopped" });
    expect(actions).toHaveLength(1);
    broker.revoke();
    expect(broker.status()).toMatchObject({ authorized: false, level: null });
    expect(consumed.length).toBeGreaterThan(0);
  });
});
