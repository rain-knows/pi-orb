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
    coordinateSpace: {
      action: "screenshot-fraction",
      space: 1000,
      windowRect: { x: 0, y: 0, width: 1200, height: 800 },
    },
    elements: [],
    elementsUnavailable: false,
    degraded: false,
    ...overrides,
  };
}

const budget = { stopped: false };

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

  it("exposes reference actions supported by the Windows backend", () => {
    expect(Object.values(ORB_TOOLS)).toEqual([
      "orb_observe", "orb_click", "orb_type", "orb_scroll", "orb_hotkey", "orb_long_press", "orb_drag", "orb_open_app", "orb_wait", "orb_long_wait", "orb_list_apps",
    ]);
  });
});

describe("validateAction", () => {
  it("accepts a click addressed by a screenshot fraction", () => {
    const action: DesktopAction = { kind: "click", observationId: "obs-1", position: { x: 10, y: 20 } };
    expect(validateAction(action, observation(), budget)).toBeNull();
  });

  it("accepts the extreme fractions, since they are the far edges of the screenshot", () => {
    for (const position of [{ x: 0, y: 0 }, { x: 1000, y: 1000 }]) {
      const action: DesktopAction = { kind: "click", observationId: "obs-1", position };
      expect(validateAction(action, observation(), budget)).toBeNull();
    }
  });

  it("refuses a fraction outside 0-1000 instead of clamping it, which would move the action", () => {
    for (const position of [{ x: -1, y: 0 }, { x: 0, y: 1001 }, { x: Number.NaN, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 0 }]) {
      const action: DesktopAction = { kind: "click", observationId: "obs-1", position };
      expect(validateAction(action, observation(), budget)).toBe("needs-position");
    }
  });

  it("refuses a click with no target at all", () => {
    const action = { kind: "click", observationId: "obs-1" } as DesktopAction;
    expect(validateAction(action, observation(), budget)).toBe("needs-position");
  });

  it("validates right, double click and modifiers", () => {
    const base = { kind: "click", observationId: "obs-1", position: { x: 1, y: 2 } } as const;
    expect(validateAction({ ...base, button: "right", count: 2, modifiers: ["shift", "ctrl"] }, observation(), budget)).toBeNull();
    expect(validateAction({ ...base, modifiers: [" Shift ", "CTRL"] }, observation(), budget)).toBeNull();
    expect(validateAction({ ...base, modifiers: ["unknown"] }, observation(), budget)).toBe("invalid-click-options");
  });

  it("refuses a non-finite coordinate instead of letting it reach the driver", () => {
    const action: DesktopAction = { kind: "click", observationId: "obs-1", position: { x: Number.NaN, y: 0 } };
    expect(validateAction(action, observation(), budget)).toBe("needs-position");
  });

  it("refuses an action decided from a superseded observation", () => {
    const action: DesktopAction = { kind: "click", observationId: "obs-OLD", position: { x: 1, y: 2 } };
    // This is the one-action-one-observation rule: acting on a stale picture is refused.
    expect(validateAction(action, observation(), budget)).toBe("stale-observation");
  });

  it("refuses an action when there is no observation", () => {
    const action: DesktopAction = { kind: "click", observationId: "obs-1", position: { x: 1, y: 2 } };
    expect(validateAction(action, null, budget)).toBe("observation-unknown");
  });

  it("refuses everything once the batch was stopped", () => {
    const action: DesktopAction = { kind: "click", observationId: "obs-1", position: { x: 1, y: 2 } };
    expect(validateAction(action, observation(), { ...budget, stopped: true })).toBe("batch-stopped");
  });

  it("requires text and bounds its length", () => {
    const empty: DesktopAction = { kind: "type", observationId: "obs-1", text: "", position: { x: 1, y: 2 } };
    expect(validateAction(empty, observation(), budget)).toBe("text-too-long");

    const tooLong: DesktopAction = {
      kind: "type",
      observationId: "obs-1",
      text: "x".repeat(ORB_LIMITS.maxTypedCharacters + 1),
      position: { x: 1, y: 2 },
    };
    expect(validateAction(tooLong, observation(), budget)).toBe("text-too-long");

    const atLimit: DesktopAction = {
      kind: "type",
      observationId: "obs-1",
      text: "x".repeat(ORB_LIMITS.maxTypedCharacters),
      position: { x: 1, y: 2 },
    };
    expect(validateAction(atLimit, observation(), budget)).toBeNull();
  });

  it("bounds the scroll amount and validates the direction", () => {
    const tooMany: DesktopAction = {
      kind: "scroll",
      observationId: "obs-1",
      direction: "down",
      amount: ORB_LIMITS.maxScrollAmount + 1,
      position: { x: 0, y: 0 },
    };
    expect(validateAction(tooMany, observation(), budget)).toBe("scroll-amount-out-of-range");

    const zero: DesktopAction = {
      kind: "scroll",
      observationId: "obs-1",
      direction: "down",
      amount: 0,
      position: { x: 0, y: 0 },
    };
    expect(validateAction(zero, observation(), budget)).toBe("scroll-amount-out-of-range");

    const badDirection = {
      kind: "scroll",
      observationId: "obs-1",
      direction: "sideways",
      amount: 1,
      position: { x: 0, y: 0 },
    } as unknown as DesktopAction;
    expect(validateAction(badDirection, observation(), budget)).toBe("unsupported-direction");

    const ok: DesktopAction = {
      kind: "scroll",
      observationId: "obs-1",
      direction: "down",
      amount: 3,
      position: { x: 0, y: 0 },
    };
    expect(validateAction(ok, observation(), budget)).toBeNull();
  });

  it("validates hotkeys and rejects screenshot shortcuts", () => {
    expect(validateAction({ kind: "hotkey", observationId: "obs-1", keys: ["ctrl", "c"] }, observation(), budget)).toBeNull();
    expect(validateAction({ kind: "hotkey", observationId: "obs-1", keys: ["win", "shift", "4"] }, observation(), budget)).toBe("forbidden-hotkey");
    expect(validateAction({ kind: "hotkey", observationId: "obs-1", keys: ["shift", "mystery"] }, observation(), budget)).toBe("invalid-hotkey");
    expect(validateAction({ kind: "hotkey", observationId: "obs-1", keys: ["ctrl", "alt", "shift", "x", "y"] }, observation(), budget)).toBe("invalid-hotkey");
  });

  it("bounds long press and keeps drag endpoints inside screenshot fraction space", () => {
    const point = { x: 250, y: 400 };
    expect(validateAction({ kind: "longPress", observationId: "obs-1", position: point, durationSeconds: 3 }, observation(), budget)).toBeNull();
    expect(validateAction({ kind: "longPress", observationId: "obs-1", position: point, durationSeconds: 0.5 }, observation(), budget)).toBe("invalid-long-press-duration");
    expect(validateAction({ kind: "drag", observationId: "obs-1", startPosition: point, endPosition: { x: 900, y: 700 } }, observation(), budget)).toBeNull();
    expect(validateAction({ kind: "drag", observationId: "obs-1", startPosition: point, endPosition: { x: 1001, y: 700 } }, observation(), budget)).toBe("needs-position");
  });

  it("accepts reference wait durations and lists apps under the current observation", () => {
    expect(validateAction({ kind: "wait", observationId: "obs-1" }, observation(), budget)).toBeNull();
    expect(validateAction({ kind: "listApps", observationId: "obs-1" }, observation(), budget)).toBeNull();
    for (const waitSeconds of [10, 30, 60, 120]) {
      expect(validateAction({ kind: "longWait", observationId: "obs-1", waitSeconds }, observation(), budget)).toBeNull();
    }
    expect(validateAction({ kind: "longWait", observationId: "obs-1", waitSeconds: 9 }, observation(), budget)).toBe("invalid-long-wait");
  });
});

describe("validateAction: open app", () => {
  const openApp = (name: string): DesktopAction => ({ kind: "openApp", observationId: "obs-1", name });

  it("accepts a display name or an executable base name", () => {
    expect(validateAction(openApp("Notepad"), observation(), budget)).toBeNull();
    expect(validateAction(openApp("notepad.exe"), observation(), budget)).toBeNull();
    expect(validateAction(openApp("  Explorer  "), observation(), budget)).toBeNull();
    expect(validateAction(openApp("Microsoft Excel"), observation(), budget)).toBeNull();
  });

  it("refuses anything that could carry a path, arguments or a command line", () => {
    // The whole point of the rule: an activation request must not be able to become an execution
    // request. Every one of these would let a model name a file, add switches or start a shell.
    for (const name of [
      "C:\\Windows\\notepad.exe",
      "..\\..\\notepad.exe",
      "notepad.exe /A secret.txt",
      "cmd /c calc",
      "powershell -Command whoami",
      "\"notepad\"",
      "note;pad",
      "note&pad",
      "note|pad",
      "note<pad",
      "--headless",
      "-a",
    ]) {
      expect(validateAction(openApp(name), observation(), budget)).toBe("invalid-app-name");
    }
  });

  it("refuses an empty, whitespace-only or over-long name, and control characters", () => {
    expect(validateAction(openApp(""), observation(), budget)).toBe("invalid-app-name");
    expect(validateAction(openApp("   "), observation(), budget)).toBe("invalid-app-name");
    expect(validateAction(openApp("a".repeat(ORB_LIMITS.maxAppNameLength + 1)), observation(), budget)).toBe("invalid-app-name");
    expect(validateAction(openApp("note\u0000pad"), observation(), budget)).toBe("invalid-app-name");
    expect(validateAction(openApp("note\npad"), observation(), budget)).toBe("invalid-app-name");
  });

  it("still requires a live observation, like every other action", () => {
    expect(validateAction(openApp("Notepad"), null, budget)).toBe("observation-unknown");
    expect(validateAction({ kind: "openApp", observationId: "obs-old", name: "Notepad" }, observation(), budget)).toBe("stale-observation");
  });
});

describe("describeRefusal", () => {
  it("gives every refusal a non-empty, specific message", () => {
    const reasons = [
      "no-task-authorization",
      "stale-generation",
      "stale-observation",
      "batch-stopped",
      "needs-position",
      "invalid-click-options",
      "invalid-long-wait",
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
    expect(describeRefusal("no-task-authorization")).toMatch(/access level/i);
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

  it("states that access is session-level and a matching directory is not authorization", () => {
    expect(section).toMatch(/never grants it/i);
    expect(section).toMatch(/Read Only.*Workspace Write.*Full Access/s);
    expect(section).toContain("New Orb sessions default to Full Access");
    expect(section).toMatch(/current foreground application/i);
    expect(section).toMatch(/review and confirm/i);
  });

  it("states the one-action-one-observation rule", () => {
    expect(section).toMatch(/fresh observation/i);
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
