import { describe, expect, it } from "vitest";
import {
  authorizeCapture,
  base64ByteLength,
  describeTarget,
  formatBytes,
  MAX_SCREENSHOT_BYTES,
  resolveConfirmation,
  toImageContent,
  validateCapture,
  type CaptureTargetSnapshot,
  type PendingCapture,
  type ScreenshotImage,
} from "@shared/screenshot";

function image(overrides: Partial<ScreenshotImage> = {}): ScreenshotImage {
  // "AAAA" is 3 bytes of valid base64.
  return { data: "AAAA", mimeType: "image/png", width: 100, height: 50, ...overrides };
}

function snapshot(): CaptureTargetSnapshot {
  return {
    recordedAt: 1_000,
    target: {
      handle: "329270",
      processId: 4242,
      title: "Editor — notes.txt",
      bounds: { x: 0, y: 0, width: 1200, height: 800 },
      dpi: 144,
    },
  };
}

describe("base64ByteLength", () => {
  it("computes decoded length, including padding", () => {
    expect(base64ByteLength("AAAA")).toBe(3);
    expect(base64ByteLength("AAA=")).toBe(2);
    expect(base64ByteLength("AA==")).toBe(1);
    expect(base64ByteLength("A")).toBeNull();
  });

  it("rejects non-base64 text instead of guessing a size", () => {
    expect(base64ByteLength("!!!!!!!!")).toBeNull();
    expect(base64ByteLength("")).toBeNull();
    expect(base64ByteLength("AAA!")).toBeNull();
  });
});

describe("validateCapture", () => {
  it("accepts a normal capture", () => {
    expect(validateCapture(image()).ok).toBe(true);
  });

  it("rejects a missing image", () => {
    const result = validateCapture(null);
    expect(result.ok).toBe(false);
    expect(result.refusal).toBe("no-image");
  });

  it("rejects a non-image mime type", () => {
    const result = validateCapture(image({ mimeType: "application/octet-stream" }));
    expect(result.ok).toBe(false);
    expect(result.refusal).toBe("bad-encoding");
  });

  it("rejects invalid base64", () => {
    const result = validateCapture(image({ data: "not base64 !!" }));
    expect(result.ok).toBe(false);
    expect(result.refusal).toBe("bad-encoding");
  });

  it("rejects an oversized capture rather than silently resizing it", () => {
    // The preview must correspond to what is sent, so a resize is not acceptable.
    const bytes = MAX_SCREENSHOT_BYTES + 3;
    const data = "A".repeat(Math.ceil(bytes / 3) * 4);
    const result = validateCapture(image({ data }));
    expect(result.ok).toBe(false);
    expect(result.refusal).toBe("too-large");
    expect(result.message).toContain("limit");
  });

  it("rejects a capture under the byte limit but over the pixel limit", () => {
    const result = validateCapture(image({ width: 100_000, height: 100_000 }));
    expect(result.ok).toBe(false);
    expect(result.refusal).toBe("too-many-pixels");
  });

  it("rejects a zero-sized image", () => {
    expect(validateCapture(image({ width: 0, height: 0 })).refusal).toBe("no-image");
  });
});

describe("authorizeCapture", () => {
  it("refuses a capture the user did not ask for", () => {
    const result = authorizeCapture({ userInitiated: false, target: snapshot(), image: image() });
    expect(result.ok).toBe(false);
    expect(result.refusal).toBe("no-target");
  });

  it("refuses an automatic capture even when a target and image exist", () => {
    // Automatic per-action screenshots belong to a later milestone and must not
    // have a quiet path to the user's screen here.
    const result = authorizeCapture(
      { userInitiated: true, target: snapshot(), image: image() },
      "automatic",
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("explicit request");
  });

  it("refuses when no target window was recorded, rather than capturing the whole screen", () => {
    const result = authorizeCapture({ userInitiated: true, target: null, image: image() });
    expect(result.ok).toBe(false);
    expect(result.refusal).toBe("no-target");
    // The refusal must not offer a silent whole-screen alternative.
    expect(result.message).not.toContain("full screen");
    expect(result.message).toMatch(/window/i);
  });

  it("accepts an explicit, user-initiated capture with a recorded target", () => {
    expect(authorizeCapture({ userInitiated: true, target: snapshot(), image: image() }).ok).toBe(true);
  });
});

describe("resolveConfirmation", () => {
  const pending: PendingCapture = {
    observationId: "obs-1",
    target: snapshot(),
    image: image(),
    capturedAt: 2_000,
  };

  it("sends only the confirmed, matching capture", () => {
    const outcome = resolveConfirmation({ pending, observationId: "obs-1", confirmed: true });
    expect(outcome.action).toBe("send");
  });

  it("discards on cancel", () => {
    const outcome = resolveConfirmation({ pending, observationId: "obs-1", confirmed: false });
    expect(outcome.action).toBe("discard");
  });

  it("refuses a confirmation for a different capture without consuming it", () => {
    // A delayed click from an earlier preview must not upload an image the user is
    // no longer looking at, and must not destroy the preview they are looking at.
    const outcome = resolveConfirmation({ pending, observationId: "obs-0", confirmed: true });
    expect(outcome.action).toBe("refuse");
    if (outcome.action === "refuse") {
      expect(outcome.reason).toContain("earlier screenshot");
    }
  });

  it("distinguishes a stale decision from a cancel", () => {
    // Collapsing these two was a real defect: a stale click cleared the live preview.
    expect(resolveConfirmation({ pending, observationId: "obs-0", confirmed: false }).action).toBe(
      "refuse",
    );
    expect(resolveConfirmation({ pending, observationId: "obs-1", confirmed: false }).action).toBe(
      "discard",
    );
  });

  it("refuses when nothing is pending", () => {
    expect(resolveConfirmation({ pending: null, observationId: "obs-1", confirmed: true }).action).toBe(
      "refuse",
    );
  });
});

describe("toImageContent", () => {
  it("produces the shape pi-web's validateAgentImages accepts", () => {
    const block = toImageContent(image({ data: "AAAA", mimeType: "image/png" }));
    expect(block).toEqual({ type: "image", data: "AAAA", mimeType: "image/png" });
    // The discriminator is not cosmetic: pi-web rejects any other envelope.
    expect(block.type).toBe("image");
  });
});

describe("describeTarget", () => {
  it("describes the window without exposing pixel data", () => {
    const text = describeTarget(snapshot().target);
    expect(text).toContain("Editor — notes.txt");
    expect(text).toContain("1200x800");
    expect(text).toContain("dpi 144");
  });

  it("falls back to the handle when the window has no title", () => {
    const target = { ...snapshot().target, title: "   " };
    expect(describeTarget(target)).toContain("329270");
  });
});

describe("formatBytes", () => {
  it("formats the three ranges used in the preview", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(4096)).toBe("4 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});
