/**
 * Platform boundary for the native foreground selection monitor.
 *
 * Source: `deepseek-harness-orb` commit `72f1d738458a223696685a909e806b683eff5885`,
 * `apps/desktop/src/selection-monitor.ts` (MIT — see `THIRD_PARTY_NOTICES.md` §3.5).
 *
 * Adapted: the reference also carries macOS implementations. pi-orb supports Windows x64 only, so the
 * non-Windows branch returns undefined and the monitor stays disabled rather than pretending to work
 * on a platform nothing here has been measured on.
 */

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
