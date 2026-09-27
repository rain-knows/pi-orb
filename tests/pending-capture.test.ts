import { describe, expect, it } from "vitest";
import { PendingCaptureStore } from "../src/main/pending-capture";
import {
  authorizeCapture,
  type CaptureTargetSnapshot,
  type ScreenshotImage,
} from "@shared/screenshot";

function snapshot(): CaptureTargetSnapshot {
  return {
    recordedAt: 1_000,
    target: {
      handle: "100",
      processId: 7,
      title: "Target",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      dpi: 96,
    },
  };
}

function image(): ScreenshotImage {
  return { data: "AAAA", mimeType: "image/png", width: 800, height: 600 };
}

function store() {
  let counter = 0;
  return new PendingCaptureStore({
    now: () => 5_000,
    // Deterministic ids so the tests assert the matching rule, not randomness.
    newObservationId: () => `obs-${(counter += 1)}`,
  });
}

const baseInput = {
  origin: "user-request" as const,
  userInitiated: true,
  target: snapshot(),
  image: image(),
  targetStale: false,
};

describe("PendingCaptureStore", () => {
  it("holds an explicit capture for confirmation and assigns an id", () => {
    const pending = store();
    const result = pending.start(baseInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pending.observationId).toBe("obs-1");
      expect(result.pending.capturedAt).toBe(5_000);
    }
  });

  it("sends the confirmed capture and clears it", () => {
    const pending = store();
    const started = pending.start(baseInput);
    if (!started.ok) throw new Error("expected a pending capture");

    const outcome = pending.resolve(started.pending.observationId, true);
    expect(outcome.action).toBe("send");
    expect(pending.pending).toBeNull();
    // A second confirmation must find nothing rather than re-sending the image.
    expect(pending.resolve(started.pending.observationId, true).action).toBe("refuse");
  });

  it("discards on cancel and clears the pending capture", () => {
    const pending = store();
    const started = pending.start(baseInput);
    if (!started.ok) throw new Error("expected a pending capture");

    expect(pending.resolve(started.pending.observationId, false).action).toBe("discard");
    expect(pending.pending).toBeNull();
  });

  it("replaces an earlier capture so a stale confirmation cannot send the old image", () => {
    const pending = store();
    const first = pending.start(baseInput);
    const second = pending.start(baseInput);
    if (!first.ok || !second.ok) throw new Error("expected two captures");

    expect(first.pending.observationId).not.toBe(second.pending.observationId);
    // Confirming the replaced capture must be refused...
    expect(pending.resolve(first.pending.observationId, true).action).toBe("refuse");
    // ...and must leave the live preview confirmable.
    expect(pending.pending?.observationId).toBe(second.pending.observationId);
    expect(pending.resolve(second.pending.observationId, true).action).toBe("send");
  });

  it("refuses an automatic capture", () => {
    const pending = store();
    const result = pending.start({ ...baseInput, origin: "automatic" });
    expect(result.ok).toBe(false);
    expect(pending.pending).toBeNull();
  });

  it("refuses a capture the user did not initiate", () => {
    const pending = store();
    const result = pending.start({ ...baseInput, userInitiated: false });
    expect(result.ok).toBe(false);
    expect(pending.pending).toBeNull();
  });

  it("refuses a capture with no recorded target instead of falling back", () => {
    const pending = store();
    const result = pending.start({ ...baseInput, target: null });
    expect(result.ok).toBe(false);
    expect(pending.pending).toBeNull();
  });

  it("refuses an empty or invalid image before it can be previewed", () => {
    const pending = store();
    expect(pending.start({ ...baseInput, image: null }).ok).toBe(false);
    expect(pending.start({ ...baseInput, image: { ...image(), data: "!!!" } }).ok).toBe(false);
    expect(pending.pending).toBeNull();
  });

  it("treats a stale target as still previewable but keeps the flag on the caller side", () => {
    // The store does not own the staleness message; it must not drop the capture
    // merely because the window changed, or a user would lose a valid preview.
    const pending = store();
    const result = pending.start({ ...baseInput, targetStale: true });
    expect(result.ok).toBe(true);
  });

  it("discard is idempotent", () => {
    const pending = store();
    pending.start(baseInput);
    pending.discard();
    pending.discard();
    expect(pending.pending).toBeNull();
  });

  it("agrees with authorizeCapture about refusal", () => {
    // The store must not be more permissive than the shared rule.
    const allowed = authorizeCapture({
      userInitiated: true,
      target: snapshot(),
      image: image(),
    });
    expect(allowed.ok).toBe(true);
    expect(store().start(baseInput).ok).toBe(true);
  });
});
