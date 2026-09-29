import { describe, expect, it } from "vitest";
import {
  createWindowsDesktopBackend,
  encodeBgraPng,
  type WindowsDesktopOps,
} from "../src/main/reference-windows/windows";
import type { WindowsDesktopSnapshot, WindowsWindowFact } from "../src/main/reference-windows/windows-foreground";
import { mapNormalizedToGlobal } from "../src/main/reference-windows/coordinates";

const bounds = { x: 100, y: 50, width: 1000, height: 500 };

function snapshot(): WindowsDesktopSnapshot {
  const window: WindowsWindowFact = {
    hwnd: 42,
    pid: 4242,
    ownerHwnd: 0,
    className: "Chrome_WidgetWin_1",
    appName: "electron",
    title: "Disposable target",
    visible: true,
    iconic: false,
    cloaked: false,
    toolWindow: false,
    popup: false,
    frame: bounds,
    monitor: { x: 0, y: 0, width: 1920, height: 1080 },
    monitorDpi: 144,
  };
  return { foregroundHwnd: 42, windows: [window] };
}

function fakeOps(calls: string[]): WindowsDesktopOps {
  return {
    listWindows: snapshot,
    capturePng: () => Uint8Array.from(encodeBgraPng(1, 1, Buffer.from([1, 2, 3, 255]), false)),
    targetBlocksInput: () => false,
    movePointer: (x, y) => calls.push(`move:${x},${y}`),
    mouseButton: (button, down) => calls.push(`${button}:${down ? "down" : "up"}`),
    scrollWheel: (x, y, delta) => calls.push(`wheel:${x},${y},${delta}`),
    key: (virtualKey, down) => calls.push(`key:${virtualKey},${down ? "down" : "up"}`),
    readClipboardText: () => "previous",
    setClipboardText: text => calls.push(`clipboard:${text}`),
    copyImageFile: path => calls.push(`image:${path}`),
    listWindowApps: () => ["electron"],
    activateApp: () => true,
    foregroundWindowId: () => 42,
    focusWindow: () => true,
    launch: target => calls.push(`launch:${target}`),
    explorerFolder: () => undefined,
  };
}

describe("reference Windows backend", () => {
  it("keeps the reference 0-1000 mapping contract", () => {
    expect(mapNormalizedToGlobal([500, 250], { index: 0, bounds, scale: 1 })).toEqual({ x: 600, y: 175 });
  });

  it("uses one physical coordinate space for click, wheel and paste", async () => {
    const calls: string[] = [];
    const backend = createWindowsDesktopBackend(fakeOps(calls));
    const screen = { index: 0, bounds, scale: 1, windowId: 42 };

    await backend.click({ screen, position: [500, 250], button: "left", count: 1 });
    await backend.scroll({ screen, position: [500, 250], direction: "down", scrollLevel: 2 });
    await backend.typeText({ screen, position: [500, 250], text: "marker", replace: false, submit: false });

    expect(calls.slice(0, 3)).toEqual(["move:600,175", "left:down", "left:up"]);
    expect(calls).toContain("wheel:600,175,-120");
    expect(calls).toContain("wheel:600,175,-120");
    expect(calls).toContain("clipboard:marker");
    expect(calls).toContain("clipboard:previous");
  });

  it("releases a held mouse button when click, long press or drag is cancelled", async () => {
    for (const action of ["click", "longPress", "drag"] as const) {
      const calls: string[] = [];
      const controller = new AbortController();
      const ops = fakeOps(calls);
      const mouseButton = ops.mouseButton;
      ops.mouseButton = (button, down) => {
        mouseButton(button, down);
        if (down) controller.abort(new Error("test cancellation"));
      };
      const backend = createWindowsDesktopBackend(ops);
      const screen = { index: 0, bounds, scale: 1, windowId: 42 };
      const run = action === "click"
        ? backend.click({ screen, position: [500, 250], button: "left", count: 1 }, controller.signal)
        : action === "longPress"
          ? backend.longPress({ screen, position: [500, 250], durationSeconds: 3 }, controller.signal)
          : backend.drag({ startScreen: screen, startPosition: [500, 250], endScreen: screen, endPosition: [700, 400] }, controller.signal);

      await expect(run).rejects.toThrow("test cancellation");
      expect(calls.filter((call) => call === "left:down")).toHaveLength(1);
      expect(calls.filter((call) => call === "left:up")).toHaveLength(1);
    }
  });

  it("attempts release when the native press call throws after posting", async () => {
    const calls: string[] = [];
    const ops = fakeOps(calls);
    const mouseButton = ops.mouseButton;
    ops.mouseButton = (button, down) => {
      mouseButton(button, down);
      if (down) throw new Error("native press failed");
    };
    const backend = createWindowsDesktopBackend(ops);
    const screen = { index: 0, bounds, scale: 1, windowId: 42 };

    await expect(backend.click({ screen, position: [500, 250], button: "left", count: 1 })).rejects.toThrow("native press failed");
    expect(calls).toContain("left:down");
    expect(calls).toContain("left:up");
  });

  it("releases already pressed chord keys when the modifier gap is cancelled", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const ops = fakeOps(calls);
    const key = ops.key;
    ops.key = (virtualKey, down, extended) => {
      key(virtualKey, down, extended);
      if (down) controller.abort(new Error("test cancellation"));
    };
    const backend = createWindowsDesktopBackend(ops);

    await expect(backend.hotkey({ keys: ["control", "a"] }, controller.signal)).rejects.toThrow("test cancellation");
    expect(calls).toContain("key:17,down");
    expect(calls).toContain("key:17,up");
  });

  it("selects a physical window and captures the same bounds used for input", async () => {
    const backend = createWindowsDesktopBackend(fakeOps([]));
    await expect(backend.listScreens()).resolves.toEqual([
      { index: 0, bounds, scale: 1.5, windowId: 42 },
    ]);
  });
});
