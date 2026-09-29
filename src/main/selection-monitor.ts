/** Platform boundary for the native foreground selection monitor. */

import type { SelectionMonitor, SelectionMonitorHandlers } from "./windows-selection";

export type { SelectionContextEvent, SelectionMonitor, SelectionMonitorHandlers } from "./windows-selection";

/** Start the monitor on supported platforms; unsupported platforms stay disabled. */
export async function startSelectionMonitor(
  handlers: SelectionMonitorHandlers,
): Promise<SelectionMonitor | undefined> {
  if (process.platform !== "win32") return undefined;
  const [{ productionSelectionProbe, installWindowsSelectionHooks }, { startWindowsSelectionMonitor }] =
    await Promise.all([import("./windows-selection-native"), import("./windows-selection")]);
  return startWindowsSelectionMonitor(handlers, productionSelectionProbe(), installWindowsSelectionHooks);
}
