import type { ReferenceWindowInfo } from "./reference-windows-driver";
import { POST_ACTION_WAIT_MS } from "@shared/orb-tools";
import { delay } from "./reference-windows/wait";

function browserPageTitle(result: unknown): string | undefined {
  const value = result as { ok?: boolean; content?: { type?: string; text?: string }[] } | null;
  if (!value?.ok || !Array.isArray(value.content)) return undefined;
  return value.content.flatMap(block => block.type === "text" && typeof block.text === "string"
    ? [...block.text.matchAll(/^- Page Title: (.+)$/gm)].map(match => match[1]) : []).at(-1);
}

/** DOM snapshots identify a page, not a native input target. Match the visible Chrome title
 * solely for the reference observation ribbon; never adopt it as desktop input authority.
 */
export function browserObservationWindow(result: unknown, windows: readonly ReferenceWindowInfo[]): ReferenceWindowInfo | null {
  const title = browserPageTitle(result);
  if (!title) return null;
  const matches = windows.filter(window => window.isOnScreen
    && /^chrome(?:\.exe)?$/i.test(window.appName)
    && window.title === `${title} - Google Chrome`);
  return matches.length === 1 ? matches[0] ?? null : null;
}

/** Chrome's native caption can trail its DOM title (observed ~250ms). Reuse the reference's
 * 600ms readiness budget, without delaying an already matched window or binding input to it.
 */
export async function waitForBrowserObservationWindow(result: unknown, readWindows: () => readonly ReferenceWindowInfo[], signal?: AbortSignal): Promise<ReferenceWindowInfo | null> {
  if (!browserPageTitle(result) || signal?.aborted) return null;
  const deadline = Date.now() + POST_ACTION_WAIT_MS;
  const abort = signal ?? new AbortController().signal;
  do {
    const target = browserObservationWindow(result, readWindows());
    if (target) return target;
    if (Date.now() >= deadline) return null;
    try { await delay(50, abort); } catch (error) { if (abort.aborted) return null; throw error; }
  } while (!abort.aborted);
  return null;
}
