import { describe, expect, it } from "vitest";
import {
  boundElements,
  describeOrbModeSection,
  describeRefusal,
  ORB_LIMITS,
  ORB_MODE_SECTION,
  ORB_TOOLS,
  validateAction,
  type DesktopAction,
  type DesktopObservation,
} from "@shared/orb-tools";

function observation(overrides: Partial<DesktopObservation> = {}): DesktopObservation {
  return {
    observationId: "obs-1",
    at: 1_000,
    window: {
      id: "329270",
      pid: 4242,
      title: "Editor",
      appName: "editor.exe",
      bounds: { x: 0, y: 0, width: 1200, height: 800 },
    },
    coordinateSpace: { action: "screen-dip", windowSize: "1200x800" },
    elements: [],
    elementsUnavailable: false,
    degraded: false,
    ...overrides,
  };
}

const budget = { actionsUsed: 0, expired: false, stopped: false };

describe("Orb tool naming", () => {
  it("prefixes every desktop tool so it cannot collide with a user extension", () => {
    for (const name of Object.values(ORB_TOOLS)) {
      expect(name.startsWith("orb_")).toBe(true);
    }
  });

  it("keeps the tool names distinct", () => {
    const names = Object.values(ORB_TOOLS);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("validateAction", () => {
  it("accepts a click addressed by element token", () => {
    const action: DesktopAction = { kind: "click", observationId: "obs-1", elementToken: "s1:0" };
    expect(validateAction(action, observation(), budget)).toBeNull();
  });

  it("accepts a click addressed by coordinates", () => {
    const action: DesktopAction = { kind: "click", observationId: "obs-1", point: { x: 10, y: 20 } };
    expect(validateAction(action, observation(), budget)).toBeNull();
  });

  it("refuses a click with no target at all", () => {
    const action: DesktopAction = { kind: "click", observationId: "obs-1" };
    expect(validateAction(action, observation(), budget)).toBe("needs-element-or-point");
  });

  it("refuses a click that supplies both forms, because the intent would be ambiguous", () => {
    const action: DesktopAction = {
      kind: "click",
      observationId: "obs-1",
      elementToken: "s1:0",
      point: { x: 1, y: 2 },
    };
    expect(validateAction(action, observation(), budget)).toBe("ambiguous-target");
  });

  it("refuses a non-finite coordinate instead of letting it reach the driver", () => {
    const action: DesktopAction = { kind: "click", observationId: "obs-1", point: { x: Number.NaN, y: 0 } };
    expect(validateAction(action, observation(), budget)).toBe("needs-element-or-point");
  });

  it("refuses an action decided from a superseded observation", () => {
    const action: DesktopAction = { kind: "click", observationId: "obs-OLD", elementToken: "s1:0" };
    // This is the one-action-one-observation rule: acting on a stale picture is refused.
    expect(validateAction(action, observation(), budget)).toBe("stale-observation");
  });

  it("refuses an action when there is no observation", () => {
    const action: DesktopAction = { kind: "click", observationId: "obs-1", elementToken: "s1:0" };
    expect(validateAction(action, null, budget)).toBe("observation-unknown");
  });

  it("enforces the action limit", () => {
    const action: DesktopAction = { kind: "click", observationId: "obs-1", elementToken: "s1:0" };
    expect(
      validateAction(action, observation(), { ...budget, actionsUsed: ORB_LIMITS.maxActionsPerTask }),
    ).toBe("task-limit-actions");
  });

  it("refuses everything once the batch was stopped", () => {
    const action: DesktopAction = { kind: "click", observationId: "obs-1", elementToken: "s1:0" };
    expect(validateAction(action, observation(), { ...budget, stopped: true })).toBe("batch-stopped");
  });

  it("refuses everything once the task expired, even with budget left", () => {
    const action: DesktopAction = { kind: "click", observationId: "obs-1", elementToken: "s1:0" };
    expect(validateAction(action, observation(), { ...budget, expired: true })).toBe("task-expired");
  });

  it("requires text and bounds its length", () => {
    const empty: DesktopAction = { kind: "type", observationId: "obs-1", text: "" };
    expect(validateAction(empty, observation(), budget)).toBe("needs-element-or-point");

    const tooLong: DesktopAction = {
      kind: "type",
      observationId: "obs-1",
      text: "x".repeat(ORB_LIMITS.maxTypedCharacters + 1),
    };
    expect(validateAction(tooLong, observation(), budget)).toBe("text-too-long");

    const atLimit: DesktopAction = {
      kind: "type",
      observationId: "obs-1",
      text: "x".repeat(ORB_LIMITS.maxTypedCharacters),
    };
    expect(validateAction(atLimit, observation(), budget)).toBeNull();
  });

  it("bounds the scroll amount and validates the direction", () => {
    const tooMany: DesktopAction = {
      kind: "scroll",
      observationId: "obs-1",
      direction: "down",
      amount: ORB_LIMITS.maxScrollAmount + 1,
      point: { x: 0, y: 0 },
    };
    expect(validateAction(tooMany, observation(), budget)).toBe("scroll-amount-out-of-range");

    const zero: DesktopAction = {
      kind: "scroll",
      observationId: "obs-1",
      direction: "down",
      amount: 0,
      point: { x: 0, y: 0 },
    };
    expect(validateAction(zero, observation(), budget)).toBe("scroll-amount-out-of-range");

    const badDirection = {
      kind: "scroll",
      observationId: "obs-1",
      direction: "sideways",
      amount: 1,
      point: { x: 0, y: 0 },
    } as unknown as DesktopAction;
    expect(validateAction(badDirection, observation(), budget)).toBe("unsupported-direction");

    const ok: DesktopAction = {
      kind: "scroll",
      observationId: "obs-1",
      direction: "down",
      amount: 3,
      point: { x: 0, y: 0 },
    };
    expect(validateAction(ok, observation(), budget)).toBeNull();
  });
});

describe("describeRefusal", () => {
  it("gives every refusal a non-empty, specific message", () => {
    const reasons = [
      "no-task-authorization",
      "stale-generation",
      "stale-observation",
      "batch-stopped",
      "task-limit-actions",
      "task-expired",
      "needs-element-or-point",
      "ambiguous-target",
      "text-too-long",
      "scroll-amount-out-of-range",
      "unsupported-direction",
      "observation-unknown",
      "busy",
    ] as const;
    const messages = reasons.map((reason) => describeRefusal(reason));
    for (const message of messages) expect(message.length).toBeGreaterThan(0);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("tells the model that authorization is needed rather than letting it retry blindly", () => {
    expect(describeRefusal("no-task-authorization")).toMatch(/approve/i);
    expect(describeRefusal("stale-observation")).toMatch(/observe/i);
    expect(describeRefusal("batch-stopped")).toMatch(/stopped/i);
  });
});

describe("boundElements", () => {
  it("truncates an element list so one observation cannot flood the context", () => {
    const many = Array.from({ length: ORB_LIMITS.maxElementsPerObservation + 25 }, (_value, index) => ({
      token: `t${index}`,
      role: "Button",
      label: `Button ${index}`,
      actions: ["invoke"],
    }));
    expect(boundElements(many)).toHaveLength(ORB_LIMITS.maxElementsPerObservation);
  });

  it("truncates a long label and says so with an ellipsis", () => {
    const long = "x".repeat(ORB_LIMITS.maxElementLabelLength + 50);
    const [element] = boundElements([{ token: "t", role: "Text", label: long, actions: [] }]);
    expect(element?.label.length).toBe(ORB_LIMITS.maxElementLabelLength + 1);
    expect(element?.label.endsWith("…")).toBe(true);
  });

  it("keeps tokens and actions unchanged", () => {
    const [element] = boundElements([{ token: "s1:0", role: "Button", label: "OK", actions: ["invoke"] }]);
    expect(element).toEqual({ token: "s1:0", role: "Button", label: "OK", actions: ["invoke"] });
  });
});

describe("describeOrbModeSection", () => {
  const section = describeOrbModeSection();

  it("states that a matching directory is not authorization", () => {
    expect(section).toMatch(/never grants it/i);
  });

  it("states the one-action-one-observation rule", () => {
    expect(section).toMatch(/observe again/i);
    expect(section).toMatch(/superseded/i);
  });

  it("states that screen content is data, not instructions or authority", () => {
    expect(section).toMatch(/untrusted/i);
    expect(section).toMatch(/never instructions/i);
  });

  it("tells the model not to retry a refusal blindly", () => {
    expect(section).toMatch(/do not retry blindly/i);
  });

  it("names the section so it can be replaced rather than appended twice", () => {
    expect(ORB_MODE_SECTION).toBe("orb_mode");
  });
});
