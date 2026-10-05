/** Ported from mini-yifan/dsh-orb-cordis@9cdc50302d202f4497569731be488a8afa500da7,
 * packages/computer-use/src/observe.ts:82-111 (MIT; Copyright (c) 2026 mini-yifan / DeepSeek).
 * Only the DesktopForeground type import is replaced with the Pi observation contract.
 */
import type { DesktopObservation } from "./orb-tools";

function envelopeValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function formatForegroundEnvelope(foreground: NonNullable<DesktopObservation["foreground"]>): string {
  const appName = envelopeValue(foreground.appName) || "none";
  const lines = [`<frontmost_app>${appName}</frontmost_app>`];
  if (foreground.windowTitle !== undefined) {
    const title = envelopeValue(foreground.windowTitle);
    if (title !== "") lines.push(`<frontmost_window>${title}</frontmost_window>`);
  }
  if (foreground.focusNote !== undefined) {
    const note = envelopeValue(foreground.focusNote);
    if (note !== "") lines.push(`<focus_note>${note}</focus_note>`);
    return lines.join("\n");
  }
  if (foreground.finderFolder !== undefined) {
    const folder = envelopeValue(foreground.finderFolder);
    if (folder !== "") lines.push(`<frontmost_folder>${folder}</frontmost_folder>`);
  }
  return lines.join("\n");
}
