/**
 * Pi context adaptation of dsh-orb-cordis@9cdc503 coordinate-mode.ts / observe.ts (MIT).
 * Reads the SDK-normalized attachment, never screen bounds or a model-supplied image size.
 * One model encoding (pixels); existing native HID millifractions are an internal driver boundary.
 */
import { ORB_TOOL_NAMES, type DesktopAction, type ScreenshotPosition } from "../../src/shared/orb-tools.js";
import { observationRasterSize, type ObservationRasterSize } from "../../src/shared/observation-raster.js";
import { modelPositionToHid } from "../../src/shared/pixel-coordinates.js";

export interface AttachedFrame {
  readonly observationId: string;
  readonly raster: ObservationRasterSize;
}

/** Envelope metadata comes from formatToolResult, not from untrusted window text. */
export function projectOrbImageSpace<T>(messages: readonly T[]): { messages: T[]; frame: AttachedFrame | null } {
  let frame: AttachedFrame | null = null;
  const projected = messages.map(message => {
    if (!message || typeof message !== "object") return message;
    const record = message as Record<string, unknown>;
    const details = record.details as { orbImages?: { observationId: string }[] } | undefined;
    if (record.role !== "toolResult" || typeof record.toolName !== "string" || !ORB_TOOL_NAMES.includes(record.toolName)
      || !Array.isArray(record.content) || !Array.isArray(details?.orbImages)) return message;
    let imageIndex = 0;
    const content = record.content.flatMap(block => {
      if (block?.type === "text" && typeof block.text === "string" && block.text.startsWith('<orb_image observation_id="') && block.text.endsWith("</orb_image>")) return [];
      if (block?.type !== "image") return [block];
      const metadata = details.orbImages?.[imageIndex++];
      const raster = typeof block.data === "string" ? observationRasterSize(Buffer.from(block.data, "base64")) : undefined;
      // An unreadable newest image invalidates the cache. Do not reuse an earlier image's dimensions.
      frame = metadata && raster ? { observationId: metadata.observationId, raster } : null;
      const text = frame
        ? `<orb_image observation_id="${frame.observationId}">\n<coordinate_space>pixels</coordinate_space>\n<attached_size>${raster!.width}x${raster!.height}</attached_size>\n</orb_image>`
        : "Orb screenshot size unavailable. Observe again before coordinate input.";
      return [{ type: "text", text }, block];
    });
    return { ...record, content } as T;
  });
  return { messages: projected, frame };
}

/** Reject stale/missing frame and out-of-image coordinates before the bridge can post input. */
export function pixelActionToHid<T extends Omit<DesktopAction, "observationId">>(action: T, frame: AttachedFrame): T {
  const convert = (position: ScreenshotPosition): ScreenshotPosition => {
    const [x, y] = modelPositionToHid([position.x, position.y], frame.raster);
    return { x, y };
  };
  if ("position" in action) return { ...action, position: convert(action.position as ScreenshotPosition) };
  if ("startPosition" in action && "endPosition" in action) return {
    ...action, startPosition: convert(action.startPosition as ScreenshotPosition), endPosition: convert(action.endPosition as ScreenshotPosition),
  };
  return action;
}
