import { describe, expect, it, vi } from "vitest";
import { POST_ACTION_WAIT_MS } from "../src/shared/orb-tools";
import type { DesktopBackend } from "../src/main/reference-windows/backend";
import { ReferenceWindowsDriver } from "../src/main/reference-windows-driver";
import type { WindowsDesktopOps } from "../src/main/reference-windows/windows";

async function fixture(waitMs = 0) {
  const state = { foreground: 42, windowsAvailable: true };
  const windows = [42, 77].map(hwnd => ({ hwnd, pid: hwnd, ownerHwnd: 0, className: "Probe", appName: `app${hwnd}`, title: `Window ${hwnd}`, visible: true, iconic: false, cloaked: false, toolWindow: false, popup: false, frame: { x: 100, y: 100, width: 800, height: 600 }, monitor: { x: 0, y: 0, width: 1920, height: 1080 }, monitorDpi: 96 }));
  const openApp = vi.fn(async (_input: { name: string }, _signal?: AbortSignal) => ({ name: "app77", kind: "activated" as "activated" | "launched" }));
  const capture = vi.fn(async () => ({ data: new Uint8Array([1]), mediaType: "image/png" }));
  const backend = {
    openApp, capture,
    listScreens: async () => windows.map(window => ({ index: 0, bounds: window.frame, scale: 1, windowId: window.hwnd })),
    inspectForeground: async () => ({ appName: `app${state.foreground}`, windowTitle: `Window ${state.foreground}` }),
  } as unknown as DesktopBackend;
  const ops = { listWindows: () => ({ foregroundHwnd: state.foreground, windows: state.windowsAvailable ? windows : [] }) } as unknown as WindowsDesktopOps;
  const driver = new ReferenceWindowsDriver({ backend, ops, ownProcessId: 1, postActionWaitMs: waitMs });
  const initial = await driver.observe({ includeImage: true });
  expect(initial.ok).toBe(true);
  capture.mockClear();
  const observation = initial.observation!;
  const action = { kind: "openApp" as const, name: "app77", observationId: observation.observationId };
  return { driver, state, openApp, capture, observation, action };
}

describe("reference open_app and actual foreground observation", () => {
  it("uses the backend activation and binds the frame it actually captures", async () => {
    const f = await fixture();
    f.openApp.mockImplementationOnce(async () => { f.state.foreground = 77; return { name: "app77", kind: "activated" }; });
    expect(await f.driver.act(f.action, f.observation)).toMatchObject({ ok: true, app: { name: "app77", kind: "activated" }, observation: { window: { id: "77" }, image: { mimeType: "image/png" } } });
    expect(f.driver.lastObservation?.window.id).toBe("77");
    expect(f.driver.lastObservation?.observationId).not.toBe(f.observation.observationId);
  });
  it("does not misreport a slow launch as failed or pretend its window is already foreground", async () => {
    const f = await fixture();
    f.openApp.mockResolvedValueOnce({ name: "app77", kind: "launched" });
    expect(await f.driver.act(f.action, f.observation)).toMatchObject({ ok: true, app: { kind: "launched" }, observation: { window: { id: "42" }, image: { mimeType: "image/png" } } });
  });
  it("can observe the launched application on a subsequent wait", async () => {
    const f = await fixture();
    f.openApp.mockResolvedValueOnce({ name: "app77", kind: "launched" });
    const opened = await f.driver.act(f.action, f.observation);
    if (!opened.ok) throw new Error(opened.error ?? "Open failed");
    f.state.foreground = 77;
    expect(await f.driver.act({ kind: "wait", observationId: opened.observation.observationId }, opened.observation)).toMatchObject({ ok: true, observation: { window: { id: "77" }, image: { mimeType: "image/png" } } });
  });
  it("returns the real open error with a new frame instead of losing the observation", async () => {
    const f = await fixture();
    f.openApp.mockRejectedValueOnce(new Error("Executable not found"));
    expect(await f.driver.act(f.action, f.observation)).toMatchObject({ ok: false, error: "Executable not found", observation: { window: { id: "42" }, image: { mimeType: "image/png" } } });
  });
  it("waits the reference settle interval before capturing the post-open frame", async () => {
    vi.useFakeTimers();
    try {
      const f = await fixture(POST_ACTION_WAIT_MS);
      const action = f.driver.act(f.action, f.observation);
      await vi.advanceTimersByTimeAsync(POST_ACTION_WAIT_MS - 1);
      expect(f.capture).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect((await action).ok).toBe(true);
      expect(f.capture).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("does not launch when the request is already canceled", async () => {
    const f = await fixture();
    expect(await f.driver.act(f.action, f.observation, AbortSignal.abort())).toMatchObject({ ok: false });
    expect(f.openApp).not.toHaveBeenCalled();
    expect(f.capture).not.toHaveBeenCalled();
  });
  it("reports capture failure when no application window remains after launch", async () => {
    const f = await fixture();
    f.openApp.mockImplementationOnce(async () => { f.state.windowsAvailable = false; return { name: "app77", kind: "launched" }; });
    expect(await f.driver.act(f.action, f.observation)).toMatchObject({ ok: false, error: "No application window is available to observe." });
    expect(f.driver.lastObservation).toBeNull();
  });
  it("does not recapture after an in-flight open is canceled", async () => {
    const f = await fixture();
    const abort = new AbortController();
    f.openApp.mockImplementationOnce(async () => { abort.abort(); throw abort.signal.reason; });
    expect(await f.driver.act(f.action, f.observation, abort.signal)).toMatchObject({ ok: false });
    expect(f.capture).not.toHaveBeenCalled();
  });
});
