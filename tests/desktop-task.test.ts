import { describe, expect, it } from "vitest";
import { DesktopTaskController, accessAllows } from "../src/main/desktop-task";
import type { DesktopAction, DesktopObservation } from "@shared/orb-tools";

function observation(id = "obs-1"): DesktopObservation {
  return {
    observationId: id,
    at: 1_000,
    window: { id: "1", pid: 2, title: "t", appName: "a", bounds: { x: 0, y: 0, width: 10, height: 10 } },
    coordinateSpace: { action: "screenshot-fraction", space: 1000, windowRect: { x: 0, y: 0, width: 10, height: 10 } },
    elements: [],
    elementsUnavailable: true,
    degraded: false,
  };
}

const click = (observationId: string): DesktopAction => ({ kind: "click", observationId, position: { x: 500, y: 500 } });
const grant = (controller: DesktopTaskController, level: "read-only" | "workspace-write" | "full-access" = "workspace-write") =>
  controller.authorize({ sessionId: "sess-1", generation: 1, level });

describe("session-level desktop access", () => {
  it("starts without authority and grants access to one session generation", () => {
    const controller = new DesktopTaskController();
    expect(controller.authorized).toBe(false);
    expect(controller.check(click("obs-1"), observation(), { sessionId: "sess-1", generation: 1 })).toBe("no-task-authorization");
    expect(grant(controller)).toMatchObject({ sessionId: "sess-1", generation: 1, level: "workspace-write" });
    expect(controller.state.authorization).toMatchObject({ sessionId: "sess-1", generation: 1 });
  });

  it("enforces the reference access tiers", () => {
    expect(accessAllows("read-only", "wait")).toBe(true);
    expect(accessAllows("read-only", "click")).toBe(false);
    expect(accessAllows("workspace-write", "click")).toBe(true);
    expect(accessAllows("workspace-write", "openApp")).toBe(false);
    expect(accessAllows("full-access", "openApp")).toBe(true);
  });

  it("allows an action only from the current observation", () => {
    const controller = new DesktopTaskController();
    grant(controller);
    controller.observe("obs-1");
    expect(controller.check(click("old"), observation(), { sessionId: "sess-1", generation: 1 })).toBe("stale-observation");
    expect(controller.check(click("obs-1"), observation(), { sessionId: "sess-1", generation: 1 })).toBeNull();
    expect(controller.check(click("obs-1"), observation(), { sessionId: "other", generation: 1 })).toBe("no-task-authorization");
    expect(controller.check(click("obs-1"), observation(), { sessionId: "sess-1", generation: 2 })).toBe("stale-generation");
  });

  it("requires an observation made under the current grant", () => {
    const controller = new DesktopTaskController();
    grant(controller);
    expect(controller.check(click("obs-1"), observation(), { sessionId: "sess-1", generation: 1 })).toBe("observation-unknown");
    controller.observe("obs-1");
    grant(controller, "full-access");
    expect(controller.check(click("obs-1"), observation(), { sessionId: "sess-1", generation: 1 })).toBe("observation-unknown");
  });

  it("stops after a failed action until the user changes access", () => {
    const controller = new DesktopTaskController();
    grant(controller);
    controller.recordOutcome(false, "driver failure");
    controller.observe("obs-2");
    expect(controller.check(click("obs-2"), observation("obs-2"), { sessionId: "sess-1", generation: 1 })).toBe("batch-stopped");
    grant(controller, "workspace-write");
    controller.observe("obs-2");
    expect(controller.check(click("obs-2"), observation("obs-2"), { sessionId: "sess-1", generation: 1 })).toBeNull();
  });

  it("revokes idempotently and does not persist authority", () => {
    const controller = new DesktopTaskController();
    grant(controller);
    controller.observe("obs-9");
    controller.revoke();
    controller.revoke();
    expect(controller.state.authorization).toBeNull();
    expect(controller.state.lastObservationId).toBeNull();
    expect(new DesktopTaskController().authorized).toBe(false);
  });
});
