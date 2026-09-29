import { describe, expect, it } from "vitest";
import type { DesktopBackend, ScreenInfo } from "../src/main/reference-windows/backend";
import { ReferenceWindowsDriver, type ReferenceWindowInfo } from "../src/main/reference-windows-driver";
import type { WindowsDesktopOps } from "../src/main/reference-windows/windows";

/**
 * `orb_open_app` is the one action that changes which window the task acts on, so its rule is
 * tested directly: an application that is already running may be activated, anything else fails
 * with the previous target intact, and no path through the driver can start a process.
 *
 * The user decision behind this is recorded in `doc/pi-orb-development-goals.md` §5 (P2-04):
 * activation only, never launch.
 */

interface Fact {
  hwnd: number;
  pid: number;
  ownerHwnd: number;
  className: string;
  appName: string;
  title: string;
  visible: boolean;
  iconic: boolean;
  cloaked: boolean;
  toolWindow: boolean;
  popup: boolean;
  frame: { x: number; y: number; width: number; height: number };
  monitor: { x: number; y: number; width: number; height: number };
  monitorDpi: number;
}

function fact(overrides: Partial<Fact> = {}): Fact {
  return {
    hwnd: 42,
    pid: 9001,
    ownerHwnd: 0,
    className: "Notepad",
    appName: "notepad.exe",
    title: "Untitled - Notepad",
    visible: true,
    iconic: false,
    cloaked: false,
    toolWindow: false,
    popup: false,
    frame: { x: 100, y: 200, width: 800, height: 600 },
    monitor: { x: 0, y: 0, width: 1920, height: 1080 },
    monitorDpi: 96,
    ...overrides,
  };
}

function opsFake(options: {
  running: readonly string[];
  /** What `activateApp` does: whether it claims success and which hwnd becomes foreground. */
  activates?: (name: string, state: { foregroundHwnd: number }) => boolean;
  startForeground?: number;
}) {
  const calls: string[] = [];
  const state = { foregroundHwnd: options.startForeground ?? 42 };
  const windows = [
    fact(),
    fact({ hwnd: 55, pid: 9003, appName: "explorer.exe", title: "Documents", className: "CabinetWClass" }),
    fact({ hwnd: 77, pid: 9002, appName: "chrome.exe", title: "Some page mentioning notepad", className: "Chrome_WidgetWin_1" }),
  ];
  const ops = {
    listWindows: () => ({ foregroundHwnd: state.foregroundHwnd, windows }),
    listWindowApps: () => {
      calls.push("listWindowApps");
      return options.running;
    },
    activateApp: (name: string) => {
      calls.push(`activateApp:${name}`);
      const handled = options.activates ? options.activates(name, state) : false;
      return handled;
    },
    launch: () => {
      // Any call here is a product defect: pi-orb must not start a process.
      calls.push("launch");
      throw new Error("launch must not be reachable from the open-app path");
    },
    focusWindow: (hwnd: number) => {
      calls.push(`focus:${hwnd}`);
      return true;
    },
  } as unknown as WindowsDesktopOps;
  return { ops, calls, state, windows };
}

function backendFake(calls: unknown[]) {
  const screenFor = (windowId: number): ScreenInfo => ({
    index: 0,
    bounds: { x: 100, y: 200, width: 800, height: 600 },
    scale: 1,
    windowId,
  });
  const backend = {
    listScreens: async () => [screenFor(42), screenFor(55), screenFor(77)],
    capture: async (screen: ScreenInfo) => {
      calls.push({ kind: "capture", windowId: screen.windowId });
      return { data: new Uint8Array([1]), mediaType: "image/png" as const };
    },
    click: async (input: unknown) => calls.push({ kind: "click", input }),
    typeText: async (input: unknown) => calls.push({ kind: "type", input }),
    scroll: async (input: unknown) => calls.push({ kind: "scroll", input }),
    hotkey: async (input: unknown) => calls.push({ kind: "hotkey", input }),
    longPress: async (input: unknown) => calls.push({ kind: "longPress", input }),
    drag: async (input: unknown) => calls.push({ kind: "drag", input }),
  } as unknown as DesktopBackend;
  return backend;
}

async function observedDriver(options: Parameters<typeof opsFake>[0], onTargetChanged?: (target: ReferenceWindowInfo) => void) {
  const { ops, calls, state, windows } = opsFake(options);
  const backendCalls: unknown[] = [];
  const driver = new ReferenceWindowsDriver({
    ops,
    backend: backendFake(backendCalls),
    ownProcessId: 1,
    resolveRecordedTarget: () => ({ handle: "42", pid: 9001, title: "Untitled - Notepad" }),
    ...(onTargetChanged ? { onTargetChanged } : {}),
  });
  const observed = await driver.observe({ includeImage: true });
  expect(observed.ok).toBe(true);
  return { driver, observation: observed.observation!, calls, backendCalls, state, windows };
}

describe("orb_open_app: activation only", () => {
  it("activates an already running application and adopts its window as the new target", async () => {
    const changed: ReferenceWindowInfo[] = [];
    const { driver, observation } = await observedDriver(
      {
        running: ["notepad.exe", "explorer.exe"],
        activates: (name, state) => {
          if (name.toLowerCase() !== "notepad.exe") return false;
          state.foregroundHwnd = 55; // explorer becomes foreground: the app must still be verified
          return true;
        },
      },
      (target) => changed.push(target),
    );

    // First attempt: activation reports success but the foreground window is a different app, so
    // the driver must refuse rather than adopt whatever happens to be in front.
    const mismatched = await driver.act({ kind: "openApp", observationId: observation.observationId, name: "notepad" }, observation);
    expect(mismatched.ok).toBe(false);
    expect(mismatched.error).toMatch(/did not become the foreground window/u);
    expect(changed).toEqual([]);
    // The old target is still the one actions use.
    expect(driver.lastObservation?.window.id).toBe("42");
  });

  it("adopts the window when the requested application really becomes foreground", async () => {
    const changed: ReferenceWindowInfo[] = [];
    const { driver, observation, backendCalls } = await observedDriver(
      {
        running: ["notepad.exe"],
        activates: (name, state) => {
          if (name.toLowerCase() !== "notepad.exe") return false;
          state.foregroundHwnd = 42;
          return true;
        },
      },
      (target) => changed.push(target),
    );

    const acted = await driver.act({ kind: "openApp", observationId: observation.observationId, name: "Notepad" }, observation);
    expect(acted.ok).toBe(true);
    expect(acted.observation?.window.id).toBe("42");
    expect(acted.observation?.window.appName).toBe("notepad.exe");
    // One action, one observation: the caller gets a fresh observation with an image.
    expect(acted.observation?.observationId).not.toBe(observation.observationId);
    expect(acted.observation?.image).toMatchObject({ mimeType: "image/png" });
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ windowId: 42, appName: "notepad.exe" });
    expect(backendCalls.some((call) => (call as { kind?: string }).kind === "capture")).toBe(true);
  });

  it("accepts a display name in any case and with or without the .exe suffix", async () => {
    for (const name of ["notepad", "NOTEPAD.EXE", "  Notepad  "]) {
      const { driver, observation } = await observedDriver({
        running: ["notepad.exe"],
        activates: (activated, state) => {
          if (activated.toLowerCase() !== "notepad.exe") return false;
          state.foregroundHwnd = 42;
          return true;
        },
      });
      const acted = await driver.act({ kind: "openApp", observationId: observation.observationId, name }, observation);
      expect(acted.ok, name).toBe(true);
    }
  });

  it("never launches: an application that is not running fails with the target unchanged", async () => {
    const changed: ReferenceWindowInfo[] = [];
    const { driver, observation, calls } = await observedDriver(
      { running: ["notepad.exe"] },
      (target) => changed.push(target),
    );

    const acted = await driver.act({ kind: "openApp", observationId: observation.observationId, name: "calc" }, observation);
    expect(acted.ok).toBe(false);
    expect(acted.error).toMatch(/not running/u);
    expect(acted.error).toMatch(/does not launch/u);
    // Activation was never attempted and no process was started.
    expect(calls).not.toContain("activateApp:calc");
    expect(calls).not.toContain("launch");
    expect(changed).toEqual([]);
    expect(driver.lastObservation?.window.id).toBe("42");
  });

  it("does not match on a window title, only on the application name", async () => {
    // A browser window whose title contains "notepad" must not be selectable by that label.
    const { driver, observation, calls } = await observedDriver({ running: ["chrome.exe"] });
    const acted = await driver.act({ kind: "openApp", observationId: observation.observationId, name: "notepad" }, observation);
    expect(acted.ok).toBe(false);
    expect(calls).not.toContain("activateApp:notepad");
  });

  it("keeps the previous target when the activation itself fails", async () => {
    const changed: ReferenceWindowInfo[] = [];
    const { driver, observation, calls } = await observedDriver(
      { running: ["notepad.exe"], activates: () => false },
      (target) => changed.push(target),
    );
    const acted = await driver.act({ kind: "openApp", observationId: observation.observationId, name: "notepad" }, observation);
    expect(acted.ok).toBe(false);
    expect(acted.error).toMatch(/could not be brought to the foreground/u);
    expect(calls).toContain("activateApp:notepad.exe");
    expect(calls).not.toContain("launch");
    expect(changed).toEqual([]);
  });

  it("requires the observation the action was decided from, like every other action", async () => {
    const { driver, observation } = await observedDriver({ running: ["notepad.exe"] });
    const stale = await driver.act(
      { kind: "openApp", observationId: "obs-does-not-exist", name: "notepad" },
      observation,
    );
    // The driver compares against its live target, so an action carrying another observation id
    // cannot move the task.
    expect(stale.ok).toBe(false);
  });
});
