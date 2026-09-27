/**
 * Captures one already-recorded window.
 *
 * Rules that matter for P1-04:
 *  - the window is matched by its native handle, which Electron embeds in a window
 *    source id as `window:<hwnd>:<index>` (verified: the middle segment equals a live
 *    Win32 handle, and the source title matched that window's real title). Matching by
 *    title would be ambiguous and would break when a title changes;
 *  - the source's own title must still agree with the recorded one, so a recycled
 *    handle cannot silently produce a different window;
 *  - a missing source or an empty image is an error, never a fallback to a
 *    full-screen capture.
 */

import { desktopCapturer } from "electron";
import type { CaptureTarget, ScreenshotImage } from "@shared/screenshot";

/** Long-edge ceiling for the capture request; the final check reads the real size. */
export const DEFAULT_MAX_CAPTURE_DIMENSION = 2560;

export interface CaptureOutcome {
  readonly image: ScreenshotImage | null;
  readonly sourceName: string | null;
  readonly sourceId: string | null;
  /** Populated when no image could be produced. */
  readonly reason: string | null;
}

export function windowSourceId(handle: string): string {
  return `window:${handle}:`;
}

/**
 * Find the capture source for a recorded window handle.
 *
 * Exported separately from the capture itself so the matching rule can be unit
 * tested with fabricated sources.
 */
export function matchWindowSource(
  sources: readonly { id: string; name: string }[],
  target: CaptureTarget,
): { id: string; name: string } | null {
  const prefix = windowSourceId(target.handle);
  return sources.find((source) => source.id.startsWith(prefix)) ?? null;
}

export async function captureTargetWindow(
  target: CaptureTarget,
  maxDimension: number = DEFAULT_MAX_CAPTURE_DIMENSION,
): Promise<CaptureOutcome> {
  const longEdge = Math.max(target.bounds.width, target.bounds.height);
  const scale = longEdge > maxDimension ? maxDimension / longEdge : 1;
  const thumbnailSize = {
    width: Math.max(1, Math.round(target.bounds.width * scale)),
    height: Math.max(1, Math.round(target.bounds.height * scale)),
  };

  let sources: Awaited<ReturnType<typeof desktopCapturer.getSources>>;
  try {
    sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize });
  } catch (error) {
    return {
      image: null,
      sourceName: null,
      sourceId: null,
      reason: `The window list could not be read: ${(error as Error).message}`,
    };
  }

  const source = matchWindowSource(sources, target);
  if (!source) {
    return {
      image: null,
      sourceName: null,
      sourceId: null,
      reason:
        "The recorded window is no longer available to capture. It may have been closed or hidden.",
    };
  }

  // A handle can be reused after its window is destroyed. Requiring the title to
  // still agree is not proof of identity, but it does catch an obviously different
  // window, and the alternative — capturing whatever now owns the handle — is worse.
  const recordedTitle = target.title.trim();
  if (recordedTitle.length > 0 && source.name.trim() !== recordedTitle) {
    return {
      image: null,
      sourceName: source.name,
      sourceId: source.id,
      reason: `The window changed since it was recorded (now "${source.name}"). Take the screenshot again.`,
    };
  }

  const thumbnail = sources.find((entry) => entry.id === source.id)?.thumbnail;
  if (!thumbnail || thumbnail.isEmpty()) {
    return {
      image: null,
      sourceName: source.name,
      sourceId: source.id,
      reason: "The window produced an empty image. Some windows cannot be captured.",
    };
  }

  const size = thumbnail.getSize();
  return {
    image: {
      data: thumbnail.toPNG().toString("base64"),
      mimeType: "image/png",
      width: size.width,
      height: size.height,
    },
    sourceName: source.name,
    sourceId: source.id,
    reason: null,
  };
}
