import { describe, expect, it } from "vitest";
import { screenshotExportBytes, screenshotExportExtension } from "../src/main/screenshot-export";

describe("screenshot export", () => {
  it("keeps the reference backend's supported image extensions", () => {
    expect(screenshotExportExtension("image/png")).toBe("png");
    expect(screenshotExportExtension("image/jpeg")).toBe("jpg");
    expect(screenshotExportExtension("image/gif")).toBe("gif");
    expect(screenshotExportExtension("image/webp")).toBe("webp");
    expect(screenshotExportExtension("image/svg+xml")).toBeNull();
  });

  it("decodes the exact validated preview bytes", () => {
    const bytes = Buffer.from("preview-bytes");
    expect(screenshotExportBytes({
      data: bytes.toString("base64"),
      mimeType: "image/png",
      width: 2,
      height: 2,
    })).toEqual(bytes);
  });

  it("rejects malformed preview data before writing", () => {
    expect(() => screenshotExportBytes({
      data: "not-base64",
      mimeType: "image/png",
      width: 2,
      height: 2,
    })).toThrow("valid base64");
  });
});
