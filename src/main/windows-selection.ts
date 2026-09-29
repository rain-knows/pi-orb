/**
 * Windows selection events used by the Orb context chip.
 *
 * This follows deepseek-harness-orb's selection monitor: low-level mouse hooks only
 * provide the selection boundary, while UI Automation reads the selected text from
 * the focused control after the left-button release. No clipboard or synthetic Ctrl+C
 * is involved.
 */

export interface WindowsSelectionMessage {
  readonly type: "mouse-up" | "mouse-down" | "key" | "wheel";
  readonly x?: number;
  readonly y?: number;
  readonly button?: "left" | "right" | "middle";
}

export interface WindowsSelectionRead {
  readonly text: string;
  readonly pid?: number;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface WindowsSelectionProbe {
  readSelection(): Promise<WindowsSelectionRead | undefined>;
}

export interface SelectionContextEvent {
  readonly type: "selection";
  readonly text: string;
  readonly pid: number | null;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
}

export interface SelectionMonitorHandlers {
  readonly onSelection: (event: SelectionContextEvent) => void;
}

/** Convert a native hook message into a selection read request. */
export function dispatchWindowsSelectionMessage(
  message: WindowsSelectionMessage,
  handlers: SelectionMonitorHandlers,
  probe: WindowsSelectionProbe,
  excluded: ReadonlySet<number>,
): void {
  if (message.type !== "mouse-up" || message.button !== "left") return;
  void probe.readSelection().then((selection) => {
    if (!selection || selection.text.trim() === "") return;
    if (selection.pid !== undefined && excluded.has(selection.pid)) return;
    const bounds =
      selection.x !== undefined &&
      selection.y !== undefined &&
      selection.width !== undefined &&
      selection.height !== undefined
        ? { x: selection.x, y: selection.y, width: selection.width, height: selection.height }
        : null;
    handlers.onSelection({
      type: "selection",
      text: selection.text,
      pid: selection.pid ?? null,
      bounds,
    });
  }).catch(() => {
    // A failed UI Automation read simply leaves the previous context untouched.
  });
}

/** Running global selection monitor. */
export interface SelectionMonitor {
  stop(): void;
  setExcludePids(pids: readonly number[]): void;
}

export function startWindowsSelectionMonitor(
  handlers: SelectionMonitorHandlers,
  probe: WindowsSelectionProbe,
  install: (dispatch: (message: WindowsSelectionMessage) => void) => () => void,
): SelectionMonitor {
  const excluded = new Set<number>();
  let unhook = (): void => undefined;
  try {
    unhook = install((message) => {
      dispatchWindowsSelectionMessage(message, handlers, probe, excluded);
    });
  } catch (error) {
    console.warn(`[pi-orb] selection hook unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    stop: () => unhook(),
    setExcludePids: (pids) => {
      excluded.clear();
      for (const pid of pids) excluded.add(pid);
    },
  };
}
