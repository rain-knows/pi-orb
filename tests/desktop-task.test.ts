import { describe, expect, it } from "vitest";
import { DesktopTaskController } from "../src/main/desktop-task";
import { ORB_LIMITS, type DesktopAction, type DesktopObservation } from "@shared/orb-tools";

function observation(id = "obs-1"): DesktopObservation {
  return {
    observationId: id,
    at: 1_000,
    window: {
      id: "1",
      pid: 2,
      title: "t",
      appName: "a",
      bounds: { x: 0, y: 0, width: 10, height: 10 },
    },
    coordinateSpace: {
      action: "screenshot-fraction",
      space: 1000,
      windowRect: { x: 0, y: 0, width: 10, height: 10 },
    },
    elements: [],
    elementsUnavailable: true,
    degraded: false,
  };
}

const click = (observationId: string): DesktopAction => ({
  kind: "click",
  observationId,
  position: { x: 500, y: 500 },
});

function grant(controller: DesktopTaskController, now = Date.now()) {
  return controller.authorize({ sessionId: "sess-1", generation: 1, scope: "click the button", now });
}

/** A timestamp safely inside the task window, derived from the same clock the controller uses. */
function withinTask(offsetMs = 0) {
  return Date.now() + offsetMs;
}

describe("DesktopTaskController authorization", () => {
  it("refuses every action before any authorization exists", () => {
    const controller = new DesktopTaskController();
    expect(controller.authorized).toBe(false);
    expect(controller.check(click("obs-1"), observation())).toBe("no-task-authorization");
  });

  it("allows an action after an explicit grant", () => {
    const controller = new DesktopTaskController();
    const authorization = grant(controller);
    expect(authorization.taskId).toBe("task-1");
    expect(controller.authorized).toBe(true);
    expect(controller.check(click("obs-1"), observation())).toBeNull();
  });

  it("binds the grant to its session and generation", () => {
    const controller = new DesktopTaskController();
    grant(controller);
    expect(controller.isForSession("sess-1")).toBe(true);
    expect(controller.isForSession("sess-2")).toBe(false);
    expect(controller.isForGeneration(1)).toBe(true);
    // A new run must not inherit the previous task's authority.
    expect(controller.isForGeneration(2)).toBe(false);
  });

  it("revokes on demand and is idempotent", () => {
    const controller = new DesktopTaskController();
    grant(controller);
    controller.revoke();
    controller.revoke();
    expect(controller.authorized).toBe(false);
    expect(controller.check(click("obs-1"), observation())).toBe("no-task-authorization");
  });

  it("clears the stopped state and the budget when a new task is granted", () => {
    const controller = new DesktopTaskController();
    grant(controller);
    controller.check(click("obs-1"), observation());
    controller.recordOutcome(false, "boom");
    expect(controller.state.stopped).toBe(true);

    grant(controller);
    expect(controller.state.stopped).toBe(false);
    expect(controller.state.actionsUsed).toBe(0);
  });
});

describe("DesktopTaskController limits", () => {
  it("counts each allowed action and then refuses at the limit", () => {
    const controller = new DesktopTaskController();
    grant(controller);
    for (let index = 0; index < ORB_LIMITS.maxActionsPerTask; index += 1) {
      expect(controller.check(click("obs-1"), observation())).toBeNull();
    }
    expect(controller.state.actionsUsed).toBe(ORB_LIMITS.maxActionsPerTask);
    expect(controller.check(click("obs-1"), observation())).toBe("task-limit-actions");
  });

  it("does not count a refused action against the budget", () => {
    const controller = new DesktopTaskController();
    grant(controller);
    // A stale observation is refused, so it must not consume budget.
    expect(controller.check(click("obs-OLD"), observation())).toBe("stale-observation");
    expect(controller.state.actionsUsed).toBe(0);
  });

  it("expires the task once its duration has passed, and records why", () => {
    const controller = new DesktopTaskController();
    const grantedAt = Date.now();
    grant(controller, grantedAt);
    const later = grantedAt + ORB_LIMITS.maxTaskDurationMs;
    expect(controller.check(click("obs-1"), observation(), later)).toBe("task-expired");
    expect(controller.isAuthorizedAt(later)).toBe(false);
    expect(controller.state.stopped).toBe(true);
    expect(controller.state.stoppedReason).toMatch(/time limit/i);
  });

  it("still allows an action just before expiry", () => {
    const controller = new DesktopTaskController();
    const grantedAt = Date.now();
    grant(controller, grantedAt);
    const justBefore = grantedAt + ORB_LIMITS.maxTaskDurationMs - 1;
    expect(controller.check(click("obs-1"), observation(), justBefore)).toBeNull();
  });

  it("accounts actions using the same clock as the grant", () => {
    // Guards against a test that grants at a fixed epoch while checking against wall time,
    // which would make every assertion pass or fail for the wrong reason.
    const controller = new DesktopTaskController();
    grant(controller, withinTask());
    expect(controller.check(click("obs-1"), observation(), withinTask(1))).toBeNull();
  });
});

describe("DesktopTaskController batch stop", () => {
  it("stops the batch after a failed action", () => {
    const controller = new DesktopTaskController();
    grant(controller);
    expect(controller.check(click("obs-1"), observation())).toBeNull();
    controller.recordOutcome(false, "the driver refused the click");

    // This is what prevents a plan from continuing to act after something went wrong.
    expect(controller.check(click("obs-1"), observation())).toBe("batch-stopped");
    expect(controller.state.stoppedReason).toBe("the driver refused the click");
  });

  it("keeps the batch stopped across further observations until the user continues", () => {
    const controller = new DesktopTaskController();
    grant(controller);
    controller.recordOutcome(false, "boom");
    // A new observation alone must not silently un-stop a failed batch.
    controller.observe("obs-2");
    expect(controller.check(click("obs-2"), observation("obs-2"))).toBe("batch-stopped");
  });

  it("resumes after an explicit continuation", () => {
    const controller = new DesktopTaskController();
    grant(controller);
    controller.recordOutcome(false, "boom");
    controller.continueAfterStop();
    expect(controller.check(click("obs-1"), observation())).toBeNull();
  });

  it("does not stop the batch after a successful action", () => {
    const controller = new DesktopTaskController();
    grant(controller);
    controller.recordOutcome(true, null);
    expect(controller.state.stopped).toBe(false);
    expect(controller.check(click("obs-1"), observation())).toBeNull();
  });

  it("uses a generic reason when the failure carried none", () => {
    const controller = new DesktopTaskController();
    grant(controller);
    controller.recordOutcome(false, null);
    expect(controller.state.stoppedReason).toBe("The action failed.");
  });
});

describe("DesktopTaskController observations", () => {
  it("records the latest observation id", () => {
    const controller = new DesktopTaskController();
    grant(controller);
    controller.observe("obs-9");
    expect(controller.state.lastObservationId).toBe("obs-9");
  });

  it("drops the observation id when the task is revoked", () => {
    const controller = new DesktopTaskController();
    grant(controller);
    controller.observe("obs-9");
    controller.revoke();
    expect(controller.state.lastObservationId).toBeNull();
    expect(controller.state.authorization).toBeNull();
  });

  it("does not persist authorization anywhere, so it cannot be revived by reload", () => {
    // The controller is in-memory only; this asserts the shape rather than a file path.
    const controller = new DesktopTaskController();
    grant(controller);
    const serialized = JSON.stringify(controller.state);
    expect(serialized).toContain("taskId");
    // A fresh controller starts unauthorized even if state text was captured.
    expect(new DesktopTaskController().authorized).toBe(false);
  });
});
