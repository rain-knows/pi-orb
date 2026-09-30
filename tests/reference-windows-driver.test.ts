import { describe, expect, it } from "vitest";
import type { DesktopBackend, ScreenInfo } from "../src/main/reference-windows/backend";
import { ReferenceWindowsDriver } from "../src/main/reference-windows-driver";
import type { WindowsDesktopOps } from "../src/main/reference-windows/windows";

function opsFake() {
  const calls: string[] = [];
  const target = {
    hwnd: 42,
    pid: 9001,
    ownerHwnd: 0,
    className: "Chrome_WidgetWin_1",
    appName: "electron",
    title: "Disposable target",
    visible: true,
    iconic: false,
    cloaked: false,
    toolWindow: false,
    popup: false,
    frame: { x: 100, y: 200, width: 800, height: 600 },
    monitor: { x: 0, y: 0, width: 1920, height: 1080 },
    monitorDpi: 96,
  };
  const other = { ...target, hwnd: 77, pid: 9002, title: "Other window" };
  const ops = {
    listWindows: () => ({ foregroundHwnd: 42, windows: [other, target] }),
    focusWindow: (hwnd: number) => {
      calls.push(`focus:${hwnd}`);
      return hwnd === 42;
    },
  } as unknown as WindowsDesktopOps;
  return { ops, calls };
}

function backendFake(calls: unknown[]) {
  const screen: ScreenInfo = {
    index: 0,
    bounds: { x: 100, y: 200, width: 800, height: 600 },
    scale: 1,
    windowId: 42,
  };
  const backend = {
    listScreens: async () => [screen],
    inspectForeground: async () => ({ appName: "electron", windowTitle: "Disposable target" }),
    listApps: async () => ["electron", "notepad"],
    capture: async () => ({ data: new Uint8Array([1]), mediaType: "image/png" as const }),
    click: async (input: unknown) => calls.push({ kind: "click", input }),
    typeText: async (input: unknown) => calls.push({ kind: "type", input }),
    scroll: async (input: unknown) => calls.push({ kind: "scroll", input }),
    hotkey: async (input: unknown) => calls.push({ kind: "hotkey", input }),
    longPress: async (input: unknown) => calls.push({ kind: "longPress", input }),
    drag: async (input: unknown) => calls.push({ kind: "drag", input }),
  } as unknown as DesktopBackend;
  return backend;
}

describe("ReferenceWindowsDriver", () => {
  it("observes the foreground window without a renderer-selected target", async () => {
    const { ops, calls } = opsFake();
    const driver = new ReferenceWindowsDriver({
      ops,
      backend: backendFake([]),
      ownProcessId: 1,
    });

    const observed = await driver.observe({});
    expect(observed.ok).toBe(true);
    expect(observed.observation?.window.id).toBe("42");
    expect(calls).toEqual([]);

    const foreground = await driver.observe({});
    expect(foreground.observation?.window.id).toBe("42");
  });

  it("keeps unauthorised observations metadata-only and returns a fresh image after acting", async () => {
    const { ops } = opsFake();
    const driver = new ReferenceWindowsDriver({ ops, backend: backendFake([]), ownProcessId: 1 });
    const sharedObservation = (await driver.observe({ includeImage: true })).observation!;
    expect(sharedObservation.image).toMatchObject({ data: "AQ==", mimeType: "image/png", width: 800, height: 600 });
    const acted = await driver.act({ kind: "click", observationId: sharedObservation.observationId, position: { x: 400, y: 300 } }, sharedObservation);
    if (!acted.ok) throw new Error(acted.error ?? "Click failed");
    expect(acted.observation.observationId).not.toBe(sharedObservation.observationId);
    expect(acted.observation.image).toMatchObject({ mimeType: "image/png", width: 800, height: 600 });
    expect(driver.lastObservation?.observationId).toBe(acted.observation.observationId);
  });

  it("passes reference backend millifraction coordinates and action amounts", async () => {
    const { ops } = opsFake();
    const calls: unknown[] = [];
    const driver = new ReferenceWindowsDriver({
      ops,
      backend: backendFake(calls),
      ownProcessId: 1,
    });
    const observed = await driver.observe({});
    expect(observed.observation).not.toBeNull();
    const observation = observed.observation!;

    expect(await driver.act({ kind: "click", observationId: observation.observationId, position: { x: 125, y: 250 } }, observation)).toMatchObject({ ok: true });
    expect(await driver.act({ kind: "scroll", observationId: observation.observationId, direction: "down", amount: 3, position: { x: 500, y: 600 } }, observation)).toMatchObject({ ok: true });
    expect(await driver.act({ kind: "type", observationId: observation.observationId, text: "hello", position: { x: 125, y: 250 } }, observation)).toMatchObject({ ok: true });
    expect(await driver.act({ kind: "hotkey", observationId: observation.observationId, keys: ["ctrl", "c"] }, observation)).toMatchObject({ ok: true });
    expect(await driver.act({ kind: "longPress", observationId: observation.observationId, position: { x: 300, y: 400 }, durationSeconds: 2 }, observation)).toMatchObject({ ok: true });
    expect(await driver.act({ kind: "drag", observationId: observation.observationId, startPosition: { x: 100, y: 200 }, endPosition: { x: 800, y: 700 } }, observation)).toMatchObject({ ok: true });

    expect(calls).toEqual([
      { kind: "click", input: expect.objectContaining({ position: [125, 250] }) },
      { kind: "scroll", input: expect.objectContaining({ direction: "down", scrollLevel: 3, position: [500, 600] }) },
      { kind: "type", input: expect.objectContaining({ text: "hello", replace: false, submit: false, position: [125, 250] }) },
      { kind: "hotkey", input: { keys: ["ctrl", "c"] } },
      { kind: "longPress", input: expect.objectContaining({ position: [300, 400], durationSeconds: 2 }) },
      { kind: "drag", input: expect.objectContaining({ startPosition: [100, 200], endPosition: [800, 700] }) },
    ]);
    expect(driver.lastObservation?.foreground).toEqual({ appName: "electron", windowTitle: "Disposable target" });
  });

  it("observes a native app behind Orb without a wake shortcut or renderer target", async () => {
    const { ops } = opsFake();
    const original = ops.listWindows;
    ops.listWindows = () => {
      const snapshot = original();
      return {
        foregroundHwnd: 99,
        windows: [
          { ...snapshot.windows[0]!, hwnd: 99, pid: 1, appName: "pi-orb", title: "Orb" },
          { ...snapshot.windows[1]!, appName: "notepad", className: "Notepad" },
        ],
      };
    };
    const driver = new ReferenceWindowsDriver({ ops, backend: backendFake([]), ownProcessId: 1 });
    expect(driver.captureTarget()).toMatchObject({ handle: "42", processId: 9001, title: "Disposable target", dpi: 96 });
    const observed = await driver.observe({ includeImage: true });
    expect(observed).toMatchObject({ ok: true, observation: { window: { id: "42", appName: "notepad" } } });
  });

  it("rejects input when a different app takes foreground before the action", async () => {
    const { ops } = opsFake();
    let foregroundHwnd = 42;
    const original = ops.listWindows;
    ops.listWindows = () => ({ ...original(), foregroundHwnd });
    const calls: unknown[] = [];
    const driver = new ReferenceWindowsDriver({ ops, backend: backendFake(calls), ownProcessId: 1 });
    const observation = (await driver.observe({})).observation!;
    foregroundHwnd = 77;
    const result = await driver.act({ kind: "click", observationId: observation.observationId, position: { x: 500, y: 500 } }, observation);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("foreground window changed") });
    expect(calls).toEqual([]);
  });

  it("returns a fresh observation when an action opens a native application window", async () => {
    const { ops } = opsFake();
    let foregroundHwnd = 42;
    const original = ops.listWindows;
    ops.listWindows = () => ({ ...original(), foregroundHwnd });
    const backend = backendFake([]);
    backend.click = async () => { foregroundHwnd = 77; };
    backend.listScreens = async () => [{
      index: 0,
      bounds: { x: 100, y: 200, width: 800, height: 600 },
      scale: 1,
      windowId: foregroundHwnd,
    }];
    const driver = new ReferenceWindowsDriver({ ops, backend, ownProcessId: 1 });
    const first = (await driver.observe({ includeImage: true })).observation!;
    const result = await driver.act({ kind: "click", observationId: first.observationId, position: { x: 500, y: 500 } }, first);
    expect(result).toMatchObject({ ok: true, observation: { window: { id: "77", title: "Other window" } } });
    expect(driver.lastObservation?.observationId).not.toBe(first.observationId);
  });

  it("lists running apps with a fresh observation and cancels a long wait", async () => {
    const { ops } = opsFake();
    const driver = new ReferenceWindowsDriver({ ops, backend: backendFake([]), ownProcessId: 1 });
    const first = (await driver.observe({ includeImage: true })).observation!;
    const apps = await driver.act({ kind: "listApps", observationId: first.observationId }, first);
    if (!apps.ok) throw new Error(apps.error ?? "Application listing failed");
    expect(apps).toMatchObject({ ok: true, apps: ["electron", "notepad"] });
    expect(apps.observation.observationId).not.toBe(first.observationId);
    const controller = new AbortController();
    const pending = driver.act({ kind: "longWait", observationId: apps.observation.observationId, waitSeconds: 10 }, apps.observation, controller.signal);
    controller.abort(new Error("stopped"));
    await expect(pending).resolves.toMatchObject({ ok: false, error: "stopped" });
  });

  it("forwards the broker cancellation signal into the native backend", async () => {
    const { ops } = opsFake();
    let receivedSignal: AbortSignal | undefined;
    const backend = backendFake([]);
    backend.click = async (_input, signal) => {
      receivedSignal = signal;
    };
    const driver = new ReferenceWindowsDriver({ ops, backend, ownProcessId: 1 });
    const observed = (await driver.observe({})).observation!;
    const controller = new AbortController();

    await driver.act(
      { kind: "click", observationId: observed.observationId, position: { x: 400, y: 400 } },
      observed,
      controller.signal,
    );

    expect(receivedSignal).toBe(controller.signal);
  });

  it("forwards cancellation to hotkey, long press and drag backend calls", async () => {
    const { ops } = opsFake();
    const received: AbortSignal[] = [];
    const backend = backendFake([]);
    backend.hotkey = async (_input, signal) => { if (signal) received.push(signal); };
    backend.longPress = async (_input, signal) => { if (signal) received.push(signal); };
    backend.drag = async (_input, signal) => { if (signal) received.push(signal); };
    const driver = new ReferenceWindowsDriver({ ops, backend, ownProcessId: 1 });
    const observation = (await driver.observe({})).observation!;
    const controller = new AbortController();

    await driver.act({ kind: "hotkey", observationId: observation.observationId, keys: ["ctrl", "c"] }, observation, controller.signal);
    await driver.act({ kind: "longPress", observationId: observation.observationId, position: { x: 200, y: 300 }, durationSeconds: 1 }, observation, controller.signal);
    await driver.act({ kind: "drag", observationId: observation.observationId, startPosition: { x: 200, y: 300 }, endPosition: { x: 600, y: 700 } }, observation, controller.signal);

    expect(received).toEqual([controller.signal, controller.signal, controller.signal]);
  });

  it("requires each type action to name its own screenshot position", async () => {
    const { ops } = opsFake();
    const calls: unknown[] = [];
    const driver = new ReferenceWindowsDriver({
      ops,
      backend: backendFake(calls),
      ownProcessId: 1,
    });
    const first = (await driver.observe({})).observation!;
    await driver.act({ kind: "click", observationId: first.observationId, position: { x: 125, y: 250 } }, first);
    driver.consumeObservation();
    const second = (await driver.observe({})).observation!;
    await driver.act({ kind: "type", observationId: second.observationId, text: "marker", position: { x: 700, y: 400 }, replace: true, submit: true }, second);

    expect(calls.at(-1)).toEqual({
      kind: "type",
      input: expect.objectContaining({ position: [700, 400], text: "marker", replace: true, submit: true }),
    });
    driver.resetActionContext();
    driver.consumeObservation();
    const third = (await driver.observe({})).observation!;
    await driver.act({ kind: "type", observationId: third.observationId, text: "center", position: { x: 300, y: 500 } }, third);
    expect(calls.at(-1)).toEqual({
      kind: "type",
      input: expect.objectContaining({ position: [300, 500], text: "center" }),
    });
  });
});
