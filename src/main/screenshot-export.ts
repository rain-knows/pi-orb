import { validateCapture, type ScreenshotImage } from "@shared/screenshot";

/** File extensions accepted by the explicit screenshot export action. */
export function screenshotExportExtension(mimeType: string): "png" | "jpg" | "gif" | "webp" | null {
  switch (mimeType) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    default: return null;
  }
}

/** Decode only a capture that already satisfies the shared screenshot contract. */
export function screenshotExportBytes(image: ScreenshotImage): Buffer {
  const validation = validateCapture(image);
  if (!validation.ok) throw new Error(validation.message);
  return Buffer.from(image.data, "base64");
}
