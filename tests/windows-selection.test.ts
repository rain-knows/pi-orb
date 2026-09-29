import { describe, expect, it, vi } from "vitest";
import {
  dispatchWindowsSelectionMessage,
  startWindowsSelectionMonitor,
  type WindowsSelectionProbe,
} from "../src/main/windows-selection";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Windows selection monitor", () => {
  it("reads a selection only after a left-button release and preserves its bounds", async () => {
    const onSelection = vi.fn();
    const probe: WindowsSelectionProbe = {
      readSelection: async () => ({ text: "selected text", pid: 42, x: 10, y: 20, width: 80, height: 18 }),
    };
    const excluded = new Set<number>();
    dispatchWindowsSelectionMessage({ type: "mouse-down", button: "left" }, { onSelection }, probe, excluded);
    dispatchWindowsSelectionMessage({ type: "mouse-up", button: "right" }, { onSelection }, probe, excluded);
    expect(onSelection).not.toHaveBeenCalled();
    dispatchWindowsSelectionMessage({ type: "mouse-up", button: "left" }, { onSelection }, probe, excluded);
    await flush();
    expect(onSelection).toHaveBeenCalledWith({
      type: "selection",
      text: "selected text",
      pid: 42,
      bounds: { x: 10, y: 20, width: 80, height: 18 },
    });
  });

  it("does not surface empty or excluded selections", async () => {
    const onSelection = vi.fn();
    let read = 0;
    const probe: WindowsSelectionProbe = {
      readSelection: async () => {
        read += 1;
        return read === 1 ? { text: "  ", pid: 5 } : { text: "orb text", pid: 99 };
      },
    };
    const excluded = new Set([99]);
    dispatchWindowsSelectionMessage({ type: "mouse-up", button: "left" }, { onSelection }, probe, excluded);
    dispatchWindowsSelectionMessage({ type: "mouse-up", button: "left" }, { onSelection }, probe, excluded);
    await flush();
    expect(onSelection).not.toHaveBeenCalled();
  });

  it("updates the excluded pid set without replacing the hook", () => {
    let dispatch: ((message: { type: "mouse-up"; button: "left" }) => void) | undefined;
    const onSelection = vi.fn();
    const probe: WindowsSelectionProbe = { readSelection: async () => ({ text: "ignored", pid: 7 }) };
    const monitor = startWindowsSelectionMonitor(
      { onSelection },
      probe,
      (next) => {
        dispatch = next as typeof dispatch;
        return vi.fn();
      },
    );
    monitor.setExcludePids([7]);
    dispatch?.({ type: "mouse-up", button: "left" });
    expect(dispatch).toBeTypeOf("function");
    monitor.stop();
  });
});
