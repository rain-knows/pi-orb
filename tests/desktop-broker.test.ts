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
  it("returns a new surface captured before a later step without treating that step as completed", async () => {
    let current = observation();
    let calls = 0;
    const driver: DesktopDriver = {
      get lastObservation() { return current; },
      async observe() { return { ok: true, observation: current, error: null }; },
      async act() {
        current = observation(`next-${++calls}`, true);
        if (calls === 2) return { ok: false, refused: true, reason: "surface-changed", error: "changed", observation: current };
        return { ok: true, refused: false, error: null, observation: current };
      },
    };
    const broker = new DesktopBroker({ driver, isLive: () => true });
    broker.authorize({ sessionId: "sess", generation: 1, level: "full-access" });
    await broker.observe("sess", 1);
    const step = { kind: "click", position: { x: 500, y: 500 } };
    expect(await broker.batch({ observationId: "obs-1", actions: [step, step, step] }, "sess", 1)).toMatchObject({
      ok: false, reason: "surface-changed", completed: 1, finalObservationId: "next-2", observationUsable: true,
      observation: { observationId: "next-2" }, steps: [{ observation: { observationId: "next-1" } }],
    });
    expect(calls).toBe(2);
  });
  it("preserves completed screenshots after a later failure, without replaying or executing remaining steps", async () => {
    let current: DesktopObservation | null = observation();
    let calls = 0;
    const driver: DesktopDriver = {
      get lastObservation() { return current; },
      async observe() { return { ok: true, observation: current, error: null }; },
      async act() {
        if (++calls === 2) return { ok: false, refused: false, error: "native failure" };
        current = observation("completed-1", true);
        return { ok: true, refused: false, error: null, observation: current };
      },
      consumeObservation() { current = null; },
    };
    const broker = new DesktopBroker({ driver, isLive: () => true });
    broker.authorize({ sessionId: "sess", generation: 1, level: "full-access" });
    await broker.observe("sess", 1);
    const step = { kind: "click", position: { x: 500, y: 500 } };
    expect(await broker.batch({ observationId: "obs-1", actions: [step, step, step] }, "sess", 1)).toMatchObject({
      ok: false, completed: 1, finalObservationId: "completed-1", observationUsable: false,
      steps: [{ observation: { image: { data: "AQID" } } }],
    });
    expect(calls).toBe(2);
    expect(await broker.act(click("completed-1"), "sess", 1)).toMatchObject({ ok: false });
  });
  it("prevalidates every batch step, advances internal observations and refuses stale single actions", async () => {
    const { broker, actions } = createBroker();
    broker.authorize({sessionId:"sess",generation:1,level:"full-access"});const observed = await broker.observe("sess",1) as { observationId: string };
    const step={kind:"click",position:{x:500,y:500}};
    expect(await broker.batch({observationId:observed.observationId,actions:[step,{kind:"type",position:{x:-1,y:500},text:"bad"}]},"sess",1)).toMatchObject({ok:false,completed:0});
    expect(actions).toHaveLength(0);
    expect(await broker.batch({observationId:observed.observationId,actions:[step,step]},"sess",1)).toMatchObject({ok:true,completed:2});
    expect(actions.map(a=>a.observationId)).toEqual([observed.observationId,"fresh-after-action"]);
    expect(await broker.act(click(observed.observationId),"sess",1)).toMatchObject({reason:"stale-observation"});
  });

  it("rejects unsupported batches, invalid counts and read-only input", async () => {
    const {broker,actions}=createBroker();broker.authorize({sessionId:"sess",generation:1,level:"read-only"});let observed = await broker.observe("sess",1) as { observationId: string };
    const step={kind:"click",position:{x:500,y:500}};
    expect(await broker.batch({observationId:observed.observationId,actions:[step,step]},"sess",1)).toMatchObject({reason:"access-level"});
    broker.authorize({sessionId:"sess",generation:1,level:"full-access"});observed = await broker.observe("sess",1) as { observationId: string };
    for(const steps of [[step],Array(9).fill(step),[step,{kind:"openApp",name:"app"}],[step,{...step,observationId:"old"}]])expect(await broker.batch({observationId:observed.observationId,actions:steps},"sess",1)).toMatchObject({reason:"malformed"});
    expect(actions).toHaveLength(0);
  });

  it("returns the last completed readback and stops after window or area changes", async () => {
    for(const change of ["title","region"]){
      let current=observation();let calls=0;
      const driver:DesktopDriver={get lastObservation(){return current;},async observe(){return {ok:true,observation:current,error:null};},async act(){calls++;current=observation("next",true);if(change==="title")current={...current,window:{...current.window,title:"dialog"}};else current={...current,coordinateSpace:{...current.coordinateSpace,windowRect:{x:0,y:0,width:99,height:99}}};return {ok:true,refused:false,error:null,observation:current};}};
      const broker=new DesktopBroker({driver,isLive:()=>true});broker.authorize({sessionId:"sess",generation:1,level:"full-access"});await broker.observe("sess",1);
      const step={kind:"click",position:{x:500,y:500}};
      expect(await broker.batch({observationId:"obs-1",actions:[step,step]},"sess",1)).toMatchObject({reason:"surface-changed",completed:1,observation:{observationId:"next"}});expect(calls).toBe(1);
    }
  });

  it("locks the entire batch until abort unwinds and never executes the next input", async () => {
    let current=observation();let calls=0;let entered!:()=>void;const started=new Promise<void>(r=>entered=r);
    const driver:DesktopDriver={get lastObservation(){return current;},async observe(){return {ok:true,observation:current,error:null};},async act(_action,_obs,signal){calls++;entered();await new Promise<void>(r=>signal?.addEventListener("abort",()=>r(),{once:true}));current=observation("next",true);return {ok:true,refused:false,error:null,observation:current};}};
    const broker=new DesktopBroker({driver,isLive:()=>true});broker.authorize({sessionId:"sess",generation:1,level:"full-access"});await broker.observe("sess",1);
    const controller=new AbortController();const step={kind:"click",position:{x:500,y:500}};
    const pending=broker.batch({observationId:"obs-1",actions:[step,step]},"sess",1,controller.signal);await started;
    expect(await broker.observe("sess",1)).toMatchObject({reason:"busy"});controller.abort();expect(await pending).toMatchObject({ok:false,completed:0});expect(calls).toBe(1);
  });
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
    expect(await broker.act(click(String(seen.observationId)), "sess", 1)).toMatchObject({ ok: false, reason: "batch-stopped" });
    expect(actions).toHaveLength(1);
    broker.revoke();
    expect(broker.status()).toMatchObject({ authorized: false, level: null });
    expect(consumed.length).toBeGreaterThan(0);
  });
});
