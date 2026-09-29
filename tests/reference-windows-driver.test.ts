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
    listWindows: () => ({ foregroundHwnd: 77, windows: [other, target] }),
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
    capture: async () => ({ data: new Uint8Array([1]), mediaType: "image/png" as const }),
    click: async (input: unknown) => calls.push({ kind: "click", input }),
    typeText: async (input: unknown) => calls.push({ kind: "type", input }),
    scroll: async (input: unknown) => calls.push({ kind: "scroll", input }),
  } as unknown as DesktopBackend;
  return backend;
}

describe("ReferenceWindowsDriver", () => {
  it("binds observation to the recorded HWND and refuses a different window", async () => {
    const { ops, calls } = opsFake();
    const driver = new ReferenceWindowsDriver({
      ops,
      backend: backendFake([]),
      ownProcessId: 1,
      resolveRecordedTarget: () => ({ handle: "42", pid: 9001, title: "Disposable target" }),
    });

    const observed = await driver.observe({});
    expect(observed.ok).toBe(true);
    expect(observed.observation?.window.id).toBe("42");
    expect(calls).toEqual(["focus:42"]);

    const refused = await driver.observe({ windowId: "77" });
    expect(refused.ok).toBe(false);

    const explicitSameTarget = await driver.observe({ windowId: "42" });
    expect(explicitSameTarget.ok).toBe(true);
  });

  it("passes reference backend millifraction coordinates and action amounts", async () => {
    const { ops } = opsFake();
    const calls: unknown[] = [];
    const driver = new ReferenceWindowsDriver({
      ops,
      backend: backendFake(calls),
      ownProcessId: 1,
      resolveRecordedTarget: () => ({ handle: "42", pid: 9001, title: "Disposable target" }),
    });
    const observed = await driver.observe({});
    expect(observed.observation).not.toBeNull();
    const observation = observed.observation!;

    expect(await driver.act({ kind: "click", observationId: observation.observationId, position: { x: 125, y: 250 } }, observation)).toMatchObject({ ok: true });
    expect(await driver.act({ kind: "scroll", observationId: observation.observationId, direction: "down", amount: 3, position: { x: 500, y: 600 } }, observation)).toMatchObject({ ok: true });
    expect(await driver.act({ kind: "type", observationId: observation.observationId, text: "hello" }, observation)).toMatchObject({ ok: true });

    expect(calls).toEqual([
      { kind: "click", input: expect.objectContaining({ position: [125, 250] }) },
      { kind: "scroll", input: expect.objectContaining({ direction: "down", scrollLevel: 3, position: [500, 600] }) },
      { kind: "type", input: expect.objectContaining({ text: "hello", replace: false, submit: false, position: [125, 250] }) },
    ]);
  });

  it("forwards the broker cancellation signal into the native backend", async () => {
    const { ops } = opsFake();
    let receivedSignal: AbortSignal | undefined;
    const backend = backendFake([]);
    backend.click = async (_input, signal) => {
      receivedSignal = signal;
    };
    const driver = new ReferenceWindowsDriver({ ops, backend, ownProcessId: 1 });
    const observed = (await driver.observe({ windowId: "42" })).observation!;
    const controller = new AbortController();

    await driver.act(
      { kind: "click", observationId: observed.observationId, position: { x: 400, y: 400 } },
      observed,
      controller.signal,
    );

    expect(receivedSignal).toBe(controller.signal);
  });

  it("does not expand an explicitly selected target through a model window id", async () => {
    const { ops } = opsFake();
    const driver = new ReferenceWindowsDriver({
      ops,
      backend: backendFake([]),
      ownProcessId: 1,
      resolveRecordedTarget: () => ({ handle: "42", pid: 9001, title: "Disposable target" }),
    });
    expect((await driver.observe({ windowId: "77" })).ok).toBe(false);
  });

  it("keeps the last click position across the required re-observation before typing", async () => {
    const { ops } = opsFake();
    const calls: unknown[] = [];
    const driver = new ReferenceWindowsDriver({
      ops,
      backend: backendFake(calls),
      ownProcessId: 1,
      resolveRecordedTarget: () => ({ handle: "42", pid: 9001, title: "Disposable target" }),
    });
    const first = (await driver.observe({})).observation!;
    await driver.act({ kind: "click", observationId: first.observationId, position: { x: 125, y: 250 } }, first);
    driver.consumeObservation();
    const second = (await driver.observe({})).observation!;
    await driver.act({ kind: "type", observationId: second.observationId, text: "marker" }, second);

    expect(calls.at(-1)).toEqual({
      kind: "type",
      input: expect.objectContaining({ position: [125, 250], text: "marker" }),
    });
    driver.resetActionContext();
    driver.consumeObservation();
    const third = (await driver.observe({})).observation!;
    await driver.act({ kind: "type", observationId: third.observationId, text: "center" }, third);
    expect(calls.at(-1)).toEqual({
      kind: "type",
      input: expect.objectContaining({ position: [500, 500], text: "center" }),
    });
  });
});
