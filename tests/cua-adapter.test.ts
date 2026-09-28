import { describe, expect, it } from "vitest";
import { CuaDriverAdapter, type CuaDriverLike, type CuaSdkLike } from "../src/main/cua-adapter";
import type { DesktopObservation, TypeAction, ScrollAction, ClickAction } from "../src/shared/orb-tools";

/**
 * A stand-in SDK whose action results are supplied by the test.
 *
 * The defects these tests pin were all of the same shape: the driver reports a refusal as a *normal
 * return value*, so code that ignores the result reports a refused action to the model as a success.
 * Reproducing that needs control over the returned object, not over thrown errors.
 */
function makeSdk(options: {
  clickResult?: unknown;
  scrollResult?: unknown;
  typeResult?: unknown;
  callToolResult?: unknown;
}) {
  const calls: { scroll: unknown[]; typeText: unknown[]; click: unknown[]; callTool: [string, string][] } = {
    scroll: [],
    typeText: [],
    click: [],
    callTool: [],
  };
  const sdk = {
    CuaDriver: {
      create: (): CuaDriverLike => ({
        listWindows: async () => ({ windows: [] }),
        getWindowState: async () => ({ structuredJson: "{}" }),
        click: async (input: unknown) => {
          calls.click.push(input);
          return options.clickResult;
        },
        typeText: async (input: unknown) => {
          calls.typeText.push(input);
          return options.typeResult;
        },
        scroll: async (input: unknown) => {
          calls.scroll.push(input);
          return options.scrollResult;
        },
        callTool: async (name: string, args: string) => {
          calls.callTool.push([name, args]);
          return options.callToolResult;
        },
        shutdown: async () => {},
      }),
    },
    ListWindowsInput: { create: (input: Record<string, unknown>) => input },
    GetWindowStateInput: { create: (input: Record<string, unknown>) => input },
    ClickInput: { create: (input: Record<string, unknown>) => input },
    TypeTextInput: { create: (input: Record<string, unknown>) => input },
    ScrollInput: { create: (input: Record<string, unknown>) => input },
    ActionTarget: { Window: class {} },
    ClickPosition: { Coordinates: class {}, Element: class {} },
    InputDeliveryMode: { Background: 0, Foreground: 1 },
    ClickButton: { Left: 0 },
    ScrollDirection: { Up: 0, Down: 1, Left: 2, Right: 3 },
  } as unknown as CuaSdkLike;
  return { sdk, calls };
}

const observation: DesktopObservation = {
  id: "obs-1",
  window: { id: "42", pid: 4242, appName: "test", title: "test window", bounds: { x: 0, y: 0, width: 1200, height: 800 } },
  coordinateSpace: {
    action: "screenshot-fraction",
    space: 1000,
    windowRect: { x: 0, y: 0, width: 1200, height: 800 },
  },
  elements: [],
  capturedAt: 0,
  degraded: false,
} as unknown as DesktopObservation;

const click: ClickAction = { kind: "click", observationId: "obs-1", position: { x: 500, y: 500 } };
const scroll: ScrollAction = { kind: "scroll", observationId: "obs-1", direction: "down", amount: 3, position: { x: 500, y: 500 } };
const type: TypeAction = { kind: "type", observationId: "obs-1", text: "hello" };

function adapterWith(overrides: Parameters<typeof makeSdk>[0]) {
  const { sdk, calls } = makeSdk(overrides);
  const adapter = new CuaDriverAdapter({ sdk, ownProcessId: -1 });
  adapter.create();
  return { adapter, calls };
}

describe("CuaDriverAdapter refusal handling", () => {
  it("reports a refused click as refused instead of success", async () => {
    // The driver returns an ActionResult with effect: Refused (4) rather than throwing.
    const { adapter } = adapterWith({
      clickResult: { effect: 4, route: 1, error: { code: "element_not_found", hint: "observe again" } },
    });
    const result = await adapter.act(click, observation);
    expect(result.ok).toBe(false);
    expect(result.refused).toBe(true);
    expect(result.error).toContain("element_not_found");
  });

  it("reports a refused scroll as refused instead of success", async () => {
    const { adapter } = adapterWith({
      scrollResult: { isError: true, errorCode: "some_other_error", text: "nope" },
    });
    const result = await adapter.act(scroll, observation);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("some_other_error");
  });

  it("reports a refused type as refused instead of success", async () => {
    const { adapter } = adapterWith({
      typeResult: { isError: true, errorCode: "value_readonly", text: "read only" },
    });
    const result = await adapter.act(type, observation);
    expect(result.ok).toBe(false);
  });

  it("accepts a successful click whose effect is not Refused", async () => {
    const { adapter } = adapterWith({ clickResult: { effect: 2, route: 1, summary: "posted" } });
    const result = await adapter.act(click, observation);
    expect(result).toEqual({ ok: true, refused: false, error: null });
  });

  it("accepts a successful ToolResult", async () => {
    const { adapter } = adapterWith({ scrollResult: { isError: false, text: "scrolled" } });
    expect((await adapter.act(scroll, observation)).ok).toBe(true);
  });
});

describe("CuaDriverAdapter background-to-foreground escalation", () => {
  it("escalates a background_unavailable scroll through callTool with delivery_mode foreground", async () => {
    // The driver's own refusal says to retry with `delivery_mode: "foreground"`, but ScrollInput has no
    // such field, so the typed API can never comply. Without the callTool path the escalation the
    // driver documents was unreachable and every scroll on Chromium/Electron content stayed refused.
    const { adapter, calls } = adapterWith({
      scrollResult: { isError: true, errorCode: "background_unavailable", text: "retry with foreground" },
      callToolResult: { isError: false, text: "scrolled via SendInput wheel" },
    });
    const result = await adapter.act(scroll, observation);
    expect(result.ok).toBe(true);
    expect(calls.callTool).toHaveLength(1);
    const call = calls.callTool[0] as [string, string];
    expect(call[0]).toBe("scroll");
    const parsed = JSON.parse(call[1]);
    expect(parsed.delivery_mode).toBe("foreground");
    // The retry must carry the same target and geometry, or it would scroll somewhere else.
    expect(parsed.direction).toBe("down");
    expect(parsed.amount).toBe(3);
    expect(parsed.pid).toBe(4242);
    expect(parsed.window_id).toBe("42");
  });

  it("escalates a background_unavailable type through callTool", async () => {
    const { adapter, calls } = adapterWith({
      typeResult: { isError: true, errorCode: "background_unavailable", text: "retry with foreground" },
      callToolResult: { isError: false, text: "typed" },
    });
    const result = await adapter.act(type, observation);
    expect(result.ok).toBe(true);
    const call = calls.callTool[0] as [string, string];
    expect(call[0]).toBe("type_text");
    expect(JSON.parse(call[1]).text).toBe("hello");
  });

  it("does not escalate before the driver says background is impossible", async () => {
    // The driver's contract is explicit that foreground steals the user's focus, so it must only be
    // used after a background attempt was refused. Escalating up front would be a bug, not a shortcut.
    const { adapter, calls } = adapterWith({ scrollResult: { isError: false, text: "scrolled in background" } });
    const result = await adapter.act(scroll, observation);
    expect(result.ok).toBe(true);
    expect(calls.callTool).toHaveLength(0);
  });

  it("does not escalate on an unrelated error", async () => {
    const { adapter, calls } = adapterWith({
      scrollResult: { isError: true, errorCode: "window_gone", text: "no such window" },
      callToolResult: { isError: false, text: "should not be reached" },
    });
    const result = await adapter.act(scroll, observation);
    expect(result.ok).toBe(false);
    expect(calls.callTool).toHaveLength(0);
  });

  it("reports a refused escalation as refused", async () => {
    const { adapter } = adapterWith({
      scrollResult: { isError: true, errorCode: "background_unavailable", text: "retry" },
      callToolResult: { isError: true, errorCode: "foreground_unavailable", text: "cannot activate" },
    });
    const result = await adapter.act(scroll, observation);
    expect(result.ok).toBe(false);
    expect(result.refused).toBe(true);
    expect(result.error).toContain("foreground_unavailable");
  });
});

describe("CuaDriverAdapter scroll coordinate conversion", () => {
  /**
   * The driver's request space is window-relative, so the rect carries no screen origin: it is the
   * driver's own reported size, which is the same report the request is measured against. The driver
   * adds its window origin back itself.
   *
   * The point arrives as a screenshot fraction, so the fraction is mapped onto that rect. An earlier
   * version subtracted the driver's *physical* origin from a *screen DIP* point — a mixed-unit bug —
   * and the click landed one cell away from the intended one (evidence/p1-06/loop-verification.json).
   */
  function observationWithOrigin() {
    return {
      ...observation,
      window: { ...observation.window, bounds: { x: 189, y: 135, width: 735, height: 684 } },
      coordinateSpace: {
        action: "screenshot-fraction",
        space: 1000,
        windowRect: { x: 0, y: 0, width: 735, height: 684 },
      },
    } as unknown as DesktopObservation;
  }

  it("subtracts the window origin from a scroll point, exactly like a click", async () => {
    const { sdk, calls } = makeSdk({ scrollResult: { isError: false, text: "ok" } });
    // The observed window reports a physical origin; the adapter records it as the action origin.
    (sdk as unknown as { CuaDriver: { create: () => CuaDriverLike } }).CuaDriver.create = () => ({
      listWindows: async () => ({
        windows: [
          {
            windowId: 42n,
            pid: 4242,
            appName: "test",
            title: "test window",
            bounds: { x: 189, y: 135, width: 735, height: 684 },
            isOnScreen: true,
            zIndex: 5n,
          },
        ],
      }),
      getWindowState: async () => ({ structuredJson: JSON.stringify({ elements: [] }) }),
      click: async (input: unknown) => {
        calls.click.push(input);
        return { effect: 0 };
      },
      typeText: async (input: unknown) => {
        calls.typeText.push(input);
        return { isError: false };
      },
      scroll: async (input: unknown) => {
        calls.scroll.push(input);
        return { isError: false };
      },
      callTool: async (name: string, args: string) => {
        calls.callTool.push([name, args]);
        return { isError: false };
      },
      shutdown: async () => {},
    });

    const adapter = new CuaDriverAdapter({ sdk, ownProcessId: -1 });
    adapter.create();
    const observed = await adapter.observe({ windowId: "42" });
    expect(observed.ok).toBe(true);

    await adapter.act({ ...scroll, position: { x: 500, y: 500 } }, observationWithOrigin());
    const scrolled = calls.scroll[0] as { x: number; y: number };
    // fraction 500/1000 onto the driver's own 735x684 bounds = (367.5, 342).
    // An earlier version subtracted the physical origin from a DIP point and sent ~(182,183),
    // which landed one cell away.
    expect(scrolled.x).toBe(367.5);
    expect(scrolled.y).toBe(342);
  });

  it("keeps the same converted point when it escalates to foreground", async () => {
    const { sdk, calls } = makeSdk({
      scrollResult: { isError: true, errorCode: "background_unavailable", text: "retry" },
      callToolResult: { isError: false, text: "scrolled" },
    });
    (sdk as unknown as { CuaDriver: { create: () => CuaDriverLike } }).CuaDriver.create = () => ({
      listWindows: async () => ({
        windows: [
          {
            windowId: 42n,
            pid: 4242,
            appName: "test",
            title: "test window",
            bounds: { x: 189, y: 135, width: 735, height: 684 },
            isOnScreen: true,
            zIndex: 5n,
          },
        ],
      }),
      getWindowState: async () => ({ structuredJson: JSON.stringify({ elements: [] }) }),
      click: async () => ({ effect: 0 }),
      typeText: async () => ({ isError: false }),
      scroll: async (input: unknown) => {
        calls.scroll.push(input);
        return { isError: true, errorCode: "background_unavailable", text: "retry" };
      },
      callTool: async (name: string, args: string) => {
        calls.callTool.push([name, args]);
        return { isError: false, text: "scrolled" };
      },
      shutdown: async () => {},
    });

    const adapter = new CuaDriverAdapter({ sdk, ownProcessId: -1 });
    adapter.create();
    const observed = await adapter.observe({ windowId: "42" });
    if (!observed.ok) throw new Error("observation failed");
    await adapter.act({ ...scroll, position: { x: 500, y: 500 } }, observationWithOrigin());

    const args = JSON.parse((calls.callTool[0] as [string, string])[1]);
    // The retry must aim at the same converted point, or the escalation would scroll elsewhere while
    // reporting success.
    expect(args.x).toBe(367.5);
    expect(args.y).toBe(342);
    expect(args.delivery_mode).toBe("foreground");
  });
});
