/**
 * Screenshot context rules (P1-04), kept free of Electron so they are testable.
 *
 * Contract (doc/product-contract.md P1-04, §6.1, §6.3):
 *  - a capture happens only after an explicit user action, and only the confirmed
 *    image is sent; cancelling uploads nothing,
 *  - the image the user previewed is byte-identical to the image that is sent,
 *  - the target is selected from non-Orb windows at the explicit capture request,
 *    so Orb focus cannot cause self-capture,
 *  - a failure to identify or capture the target window is reported; the code must
 *    never silently fall back to a full-screen capture,
 *  - size limits are explicit numbers, never "unlimited".
 */

import type { ImageContent } from "./ipc";

/** pi-web's own per-image ceiling, mirrored so we fail before the request does. */
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

/** A capture larger than this is refused before it reaches the session. */
export const MAX_SCREENSHOT_PIXELS = 33_177_600; // 7680 x 4320

/** Identifies which window a capture belongs to, and what was on screen. */
export interface CaptureTarget {
  /** Native window handle as a decimal string (a Win32 HWND is a pointer). */
  readonly handle: string;
  readonly processId: number;
  /** Window title at the time of recording. May be empty for some windows. */
  readonly title: string;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** DPI of the monitor the window is on, as reported by the OS. */
  readonly dpi: number;
}

export interface CaptureTargetSnapshot {
  readonly target: CaptureTarget;
  /** When the target was recorded, in epoch milliseconds. */
  readonly recordedAt: number;
}

export interface ScreenshotImage {
  readonly data: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
}

/**
 * A capture awaiting the user's decision.
 *
 * The identifier exists so a late response cannot confirm a capture the user has
 * already replaced: it is generated per capture and echoed back on confirm.
 */
export interface PendingCapture {
  readonly observationId: string;
  readonly target: CaptureTargetSnapshot;
  readonly image: ScreenshotImage;
  readonly capturedAt: number;
}

export type CaptureOrigin = "user-request" | "automatic";

export type CaptureRefusal =
  | "no-target"
  | "no-image"
  | "too-large"
  | "too-many-pixels"
  | "bad-encoding";

export interface CaptureValidation {
  readonly ok: boolean;
  readonly refusal: CaptureRefusal | null;
  readonly message: string;
}

/** Bytes represented by base64 text, or `null` when the text is not valid base64. */
export function base64ByteLength(data: string): number | null {
  if (typeof data !== "string" || data.length === 0 || data.length % 4 !== 0) return null;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const end = data.length - padding;
  for (let index = 0; index < end; index += 1) {
    const code = data.charCodeAt(index);
    const isBase64 =
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x30 && code <= 0x39) ||
      code === 0x2b ||
      code === 0x2f;
    if (!isBase64) return null;
  }
  for (let index = end; index < data.length; index += 1) {
    if (data[index] !== "=") return null;
  }
  return (data.length / 4) * 3 - padding;
}

/**
 * Validate a capture before it is offered to the user.
 *
 * An oversized capture is refused rather than silently resized: a resize changes
 * the pixels the model sees, and the preview must correspond to what is sent.
 */
export function validateCapture(image: ScreenshotImage | null): CaptureValidation {
  if (!image) {
    return { ok: false, refusal: "no-image", message: "The window produced no image." };
  }
  if (typeof image.mimeType !== "string" || !image.mimeType.startsWith("image/")) {
    return {
      ok: false,
      refusal: "bad-encoding",
      message: `Unsupported image type: ${String(image.mimeType)}`,
    };
  }
  const bytes = base64ByteLength(image.data);
  if (bytes === null) {
    return { ok: false, refusal: "bad-encoding", message: "The captured image is not valid base64." };
  }
  if (bytes > MAX_SCREENSHOT_BYTES) {
    return {
      ok: false,
      refusal: "too-large",
      message: `The capture is ${formatBytes(bytes)}, over the ${formatBytes(MAX_SCREENSHOT_BYTES)} limit.`,
    };
  }
  if (image.width * image.height > MAX_SCREENSHOT_PIXELS) {
    return {
      ok: false,
      refusal: "too-many-pixels",
      message: `The capture is ${image.width}x${image.height}, over the ${MAX_SCREENSHOT_PIXELS}-pixel limit.`,
    };
  }
  if (image.width <= 0 || image.height <= 0) {
    return { ok: false, refusal: "no-image", message: "The captured image has no size." };
  }
  return { ok: true, refusal: null, message: "" };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Build the image block pi-web expects on `prompt`.
 *
 * Marked `type: "image"` because that is the exact shape `validateAgentImages`
 * accepts; a different envelope is rejected by pi-web before the model ever sees it.
 */
export function toImageContent(image: ScreenshotImage): ImageContent {
  return { type: "image", data: image.data, mimeType: image.mimeType };
}

export interface CaptureRequestInput {
  /** True only when the user explicitly asked for a screenshot. */
  readonly userInitiated: boolean;
  readonly target: CaptureTargetSnapshot | null;
  readonly image: ScreenshotImage | null;
}

/**
 * Decide whether a capture may be taken and shown.
 *
 * `origin` is deliberately part of the decision: automatic captures (a later
 * milestone's per-action screenshots) are not allowed to reach the user's screen
 * without the same explicit consent path, so this milestone refuses them outright
 * rather than leaving a quiet way in.
 */
export function authorizeCapture(
  input: CaptureRequestInput,
  origin: CaptureOrigin = "user-request",
): CaptureValidation {
  if (origin !== "user-request" || !input.userInitiated) {
    return {
      ok: false,
      refusal: "no-target",
      message:
        "A screenshot is taken only after an explicit request. Automatic capture is not enabled in this version.",
    };
  }
  if (!input.target) {
    return {
      ok: false,
      refusal: "no-target",
      message:
        "No target window was recorded. The screenshot target is captured before the orb takes focus, so bring the window you want to share to the front and try again.",
    };
  }
  return validateCapture(input.image);
}

export interface ConfirmationInput {
  readonly pending: PendingCapture | null;
  readonly observationId: string;
  /** True when the user confirmed; false when they cancelled. */
  readonly confirmed: boolean;
}

export type ConfirmationOutcome =
  | { readonly action: "refuse"; readonly reason: string }
  | { readonly action: "discard"; readonly reason: string }
  | { readonly action: "send"; readonly pending: PendingCapture };

/**
 * Resolve the preview decision.
 *
 * The three non-send outcomes are deliberately distinct:
 *  - `refuse` means this decision does not apply to the capture currently held (it is
 *    stale, or there is none). Nothing is sent, and crucially the current capture is
 *    **not** consumed, so a delayed click from an earlier preview cannot destroy the
 *    preview the user is actually looking at;
 *  - `discard` means the user cancelled the matching capture;
 *  - `send` means the matching capture was confirmed.
 *
 * Collapsing `refuse` into `discard` was a real defect: a stale click cleared the
 * live preview and its message, leaving the user unable to confirm it.
 */
export function resolveConfirmation(input: ConfirmationInput): ConfirmationOutcome {
  if (!input.pending) {
    return { action: "refuse", reason: "There is no screenshot awaiting confirmation." };
  }
  if (input.observationId !== input.pending.observationId) {
    return {
      action: "refuse",
      reason: "This decision belongs to an earlier screenshot. Nothing was sent.",
    };
  }
  if (!input.confirmed) {
    return { action: "discard", reason: "The screenshot was cancelled." };
  }
  return { action: "send", pending: input.pending };
}

/** Human-readable target description for the preview. Never includes pixel data. */
export function describeTarget(target: CaptureTarget): string {
  const size = `${target.bounds.width}x${target.bounds.height}`;
  const name = target.title.trim().length > 0 ? target.title : `window ${target.handle}`;
  return `${name} (${size}, pid ${target.processId}, dpi ${target.dpi})`;
}
