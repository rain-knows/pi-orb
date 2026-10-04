import { afterEach, describe, expect, it, vi } from "vitest";
import { browserObservationWindow, waitForBrowserObservationWindow } from "../src/main/browser-observation-frame";
import type { ReferenceWindowInfo } from "../src/main/reference-windows-driver";

const chrome: ReferenceWindowInfo = { windowId: 1, pid: 2, appName: "chrome.exe", title: "Current page - Google Chrome",
  bounds: { x: 10, y: 20, width: 900, height: 700 }, isOnScreen: true, zIndex: 1n };
const snapshot = (title: string) => ({ type: "text", text: `### Page\n- Page Title: ${title}\n### Snapshot\n- button "Play" [ref=e7]` });

describe("DOM browser observation ribbon", () => {
  afterEach(() => vi.useRealTimers());
  it("uses the latest returned page title and the real visible Chrome bounds", () => {
    expect(browserObservationWindow({ ok: true, content: [snapshot("Previous page"), snapshot("Current page")] }, [chrome])).toBe(chrome);
  });
  it("does not mark an unrelated app, hidden window, failed result or ambiguous Chrome window", () => {
    const result = { ok: true, content: [snapshot("Current page")] };
    expect(browserObservationWindow(result, [{ ...chrome, appName: "QQ.exe" }])).toBeNull();
    expect(browserObservationWindow(result, [{ ...chrome, isOnScreen: false }])).toBeNull();
    expect(browserObservationWindow({ ...result, ok: false }, [chrome])).toBeNull();
    expect(browserObservationWindow(result, [chrome, { ...chrome, windowId: 3 }])).toBeNull();
    expect(browserObservationWindow({ ok: true, tools: [] }, [chrome])).toBeNull();
  });
  it("waits for a delayed native caption and cancels before drawing after Stop", async () => {
    vi.useFakeTimers();
    const result = { ok: true, content: [snapshot("Current page")] };
    let windows = [{ ...chrome, title: "about:blank - Google Chrome" }];
    const pending = waitForBrowserObservationWindow(result, () => windows);
    await vi.advanceTimersByTimeAsync(200);
    windows = [chrome];
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toBe(chrome);
    const controller = new AbortController();
    const cancelled = waitForBrowserObservationWindow(result, () => [], controller.signal);
    controller.abort();
    expect(await cancelled).toBeNull();
  });
});
