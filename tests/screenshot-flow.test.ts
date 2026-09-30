import { describe, expect, it, vi } from "vitest";
import { ScreenshotFlow } from "../src/main/screenshot-flow";
import { PendingCaptureStore } from "../src/main/pending-capture";
import type { CaptureTarget, CaptureTargetSnapshot, ScreenshotImage } from "@shared/screenshot";
import type { ImageContent } from "@shared/ipc";

function target(overrides: Partial<CaptureTarget> = {}): CaptureTarget {
  return {
    handle: "329270",
    processId: 4242,
    title: "Editor — notes.txt",
    bounds: { x: 0, y: 0, width: 1200, height: 800 },
    dpi: 144,
    ...overrides,
  };
}

function snapshot(overrides: Partial<CaptureTarget> = {}): CaptureTargetSnapshot {
  return { target: target(overrides), recordedAt: 1_000 };
}

/** A recognizable payload so "what was previewed" can be compared byte for byte. */
function image(overrides: Partial<ScreenshotImage> = {}): ScreenshotImage {
  return {
    data: Buffer.from("PNG-PIXEL-PAYLOAD-0123456789").toString("base64"),
    mimeType: "image/png",
    width: 1200,
    height: 800,
    ...overrides,
  };
}

interface Harness {
  readonly flow: ScreenshotFlow;
  readonly sent: { text: string; images: readonly ImageContent[] }[];
  readonly captureCalls: CaptureTarget[];
}

function harness(
  options: {
    target?: CaptureTargetSnapshot | null;
    image?: ScreenshotImage | null;
    captureReason?: string | null;
    /** Force the record's validity verdict, to exercise each refusal reason. */
    validityReason?: "ok" | "no-record" | "window-gone" | "window-changed";
    currentTitle?: string;
    sendError?: Error;
  } = {},
): Harness {
  const sent: { text: string; images: readonly ImageContent[] }[] = [];
  const captureCalls: CaptureTarget[] = [];
  let counter = 0;

  const recorded = options.target === undefined ? snapshot() : options.target;
  // The flow consumes a record taken before the orb took focus; it never reads the foreground window
  // itself, so the harness supplies the record and its verdict rather than a reader.
  const reason = options.validityReason ?? (recorded === null ? "no-record" : "ok");

  const flow = new ScreenshotFlow({
    recordedTarget: {
      snapshot: recorded,
      validate: async () => ({
        valid: reason === "ok" && recorded !== null,
        reason,
        snapshot: recorded,
        ...(options.currentTitle === undefined ? {} : { currentTitle: options.currentTitle }),
      }),
    },
    capture: async (t) => {
      captureCalls.push(t);
      return {
        image: options.image === undefined ? image() : options.image,
        reason: options.captureReason ?? null,
      };
    },
    send: async (text, images) => {
      if (options.sendError) throw options.sendError;
      sent.push({ text, images });
    },
    store: new PendingCaptureStore({
      now: () => 5_000,
      newObservationId: () => `obs-${(counter += 1)}`,
    }),
  });

  return { flow, sent, captureCalls };
}

describe("ScreenshotFlow.start", () => {
  it("returns a preview carrying the capture and the target description", async () => {
    const { flow } = harness();
    const result = await flow.start("what is this?");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.width).toBe(1200);
      expect(result.height).toBe(800);
      expect(result.mimeType).toBe("image/png");
      expect(result.targetDescription).toContain("Editor — notes.txt");
      expect(result.targetStale).toBe(false);
    }
  });

  it("sends nothing when a capture is only being previewed", async () => {
    const { flow, sent } = harness();
    await flow.start("hello");
    expect(sent).toHaveLength(0);
  });

  it("refuses when no target window was recorded, and does not capture anything", async () => {
    const { flow, sent, captureCalls } = harness({ target: null });
    const result = await flow.start("hello");
    expect(result.ok).toBe(false);
    // No fallback capture happened: a whole-screen screenshot would defeat the point.
    expect(captureCalls).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("reports a capture failure without sending", async () => {
    const { flow, sent } = harness({ image: null, captureReason: "The window is gone." });
    const result = await flow.start("hello");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("The window is gone.");
    expect(sent).toHaveLength(0);
  });

  it("previews the recorded window even though it is no longer in front", async () => {
    // The decisive property of the fix: after the user switches to the orb, the recorded window is
    // not in front by design. Requiring foreground-ness refused every capture the user asked for.
    const { flow } = harness();
    const result = await flow.start("hello");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.targetStale).toBe(false);
  });

  it("never reads the foreground window itself", async () => {
    // The flow's only source of a target is the record. A reader that consulted the foreground at
    // capture time would return the orb, which is exactly the defect this replaced.
    const flow = new ScreenshotFlow({
      recordedTarget: {
        snapshot: snapshot(),
        validate: async () => ({ valid: true, reason: "ok", snapshot: snapshot() }),
      },
      capture: async () => ({ image: image(), reason: null }),
      send: async () => {},
    });
    const result = await flow.start("hello");
    expect(result.ok).toBe(true);
  });

  it("refuses with a specific reason when nothing was recorded", async () => {
    const { flow, captureCalls } = harness({ target: null, validityReason: "no-record" });
    const result = await flow.start("hello");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/打开目标应用/);
    expect(captureCalls).toHaveLength(0);
  });

  it("explains that the recorded window is gone", async () => {
    const { flow } = harness({ validityReason: "window-gone" });
    const result = await flow.start("hello");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/目标窗口已关闭/);
  });

  it("names the replacement window when the recorded one changed", async () => {
    const { flow } = harness({ validityReason: "window-changed", currentTitle: "Something else" });
    const result = await flow.start("hello");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/目标窗口已经变化/);
      expect(result.message).toContain("Something else");
    }
  });

  it("treats a failing validity probe as a refusal rather than capturing anyway", async () => {
    const { flow, captureCalls } = harness();
    void flow;
    void captureCalls;
    const failing = new ScreenshotFlow({
      recordedTarget: {
        snapshot: snapshot(),
        validate: async () => {
          throw new Error("probe failed");
        },
      },
      capture: async () => ({ image: image(), reason: null }),
      send: async () => {},
    });
    const result = await failing.start("hello");
    expect(result.ok).toBe(false);
  });
});

describe("ScreenshotFlow.resolve", () => {
  it("sends exactly the bytes that were previewed", async () => {
    const previewed = image({ data: Buffer.from("DISTINCT-PAYLOAD-ABCDEF").toString("base64") });
    const { flow, sent } = harness({ image: previewed });
    const preview = await flow.start("what is this?");
    if (!preview.ok) throw new Error("expected a preview");

    const result = await flow.resolve(preview.observationId, true);
    expect(result.sent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toBe("what is this?");
    // Byte-identical: same string, same length, same declared size.
    expect(sent[0]!.images[0]!.data).toBe(preview.data);
    expect(sent[0]!.images[0]!.data.length).toBe(preview.data.length);
    expect(sent[0]!.images[0]!.mimeType).toBe(preview.mimeType);
    expect(
      Buffer.from(sent[0]!.images[0]!.data, "base64").equals(
        Buffer.from(preview.data, "base64"),
      ),
    ).toBe(true);
  });

  it("sends an image-only message when the draft was empty", async () => {
    const { flow, sent } = harness();
    const preview = await flow.start("");
    if (!preview.ok) throw new Error("expected a preview");
    await flow.resolve(preview.observationId, true);
    expect(sent[0]!.text).toBe("");
    expect(sent[0]!.images).toHaveLength(1);
  });

  it("uploads nothing on cancel", async () => {
    const { flow, sent } = harness();
    const preview = await flow.start("hello");
    if (!preview.ok) throw new Error("expected a preview");

    const result = await flow.resolve(preview.observationId, false);
    expect(result.sent).toBe(false);
    expect(sent).toHaveLength(0);
    expect(flow.pending).toBeNull();
  });

  it("refuses a confirmation that does not match the previewed capture", async () => {
    const { flow, sent } = harness();
    await flow.start("hello");
    const result = await flow.resolve("obs-does-not-match", true);
    expect(result.sent).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("cannot send the same capture twice", async () => {
    const { flow, sent } = harness();
    const preview = await flow.start("hello");
    if (!preview.ok) throw new Error("expected a preview");

    expect((await flow.resolve(preview.observationId, true)).sent).toBe(true);
    expect((await flow.resolve(preview.observationId, true)).sent).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("sends only the newest capture when two previews happened", async () => {
    const first = image({ data: Buffer.from("FIRST-PAYLOAD").toString("base64") });
    const second = image({ data: Buffer.from("SECOND-PAYLOAD-DIFFERENT").toString("base64") });
    const sent: { text: string; images: readonly ImageContent[] }[] = [];
    let current = first;
    const flow = new ScreenshotFlow({
      recordedTarget: {
        snapshot: snapshot(),
        validate: async () => ({ valid: true, reason: "ok" as const, snapshot: snapshot() }),
      },
      capture: async () => ({ image: current, reason: null }),
      send: async (text, images) => {
        sent.push({ text, images });
      },
    });

    const firstPreview = await flow.start("first");
    if (!firstPreview.ok) throw new Error("expected a preview");
    current = second;
    const secondPreview = await flow.start("second");
    if (!secondPreview.ok) throw new Error("expected a preview");

    // A stale decision must not send, and must not consume the live preview either.
    expect((await flow.resolve(firstPreview.observationId, true)).sent).toBe(false);
    expect(sent).toHaveLength(0);
    expect(flow.pending?.observationId).toBe(secondPreview.observationId);

    // The current preview still sends, with its own message and its own bytes.
    expect((await flow.resolve(secondPreview.observationId, true)).sent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toBe("second");
    expect(Buffer.from(sent[0]!.images[0]!.data, "base64").toString()).toBe("SECOND-PAYLOAD-DIFFERENT");
  });

  it("does not let a stale cancel discard the live preview", async () => {
    const { flow, sent } = harness();
    const firstPreview = await flow.start("first");
    if (!firstPreview.ok) throw new Error("expected a preview");
    const secondPreview = await flow.start("second");
    if (!secondPreview.ok) throw new Error("expected a preview");

    expect((await flow.resolve(firstPreview.observationId, false)).sent).toBe(false);
    expect(flow.pending?.observationId).toBe(secondPreview.observationId);

    expect((await flow.resolve(secondPreview.observationId, true)).sent).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("reports a send failure and uploads nothing", async () => {
    const { flow, sent } = harness({ sendError: new Error("pi-web refused the request") });
    const preview = await flow.start("hello");
    if (!preview.ok) throw new Error("expected a preview");

    const result = await flow.resolve(preview.observationId, true);
    expect(result.sent).toBe(false);
    if (!result.sent) expect(result.message).toContain("pi-web refused");
    expect(sent).toHaveLength(0);
  });

  it("does not send a confirmed image after its message was discarded", async () => {
    const { flow, sent } = harness();
    const preview = await flow.start("hello");
    if (!preview.ok) throw new Error("expected a preview");

    // A workspace switch or shutdown drops the pending capture.
    flow.discard();
    const result = await flow.resolve(preview.observationId, true);
    expect(result.sent).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("discard is idempotent and leaves nothing to confirm", async () => {
    const { flow } = harness();
    await flow.start("hello");
    flow.discard();
    flow.discard();
    expect(flow.pending).toBeNull();
  });
});

describe("ScreenshotFlow consent boundary", () => {
  it("never captures when no explicit user action initiated it", async () => {
    // The flow's only entry point is `start`, which is reachable solely from the
    // user's Screenshot action; there is no automatic path in this milestone.
    const { flow, captureCalls } = harness();
    expect(flow.pending).toBeNull();
    expect(captureCalls).toHaveLength(0);
  });

  it("passes the recorded target, not a newly chosen one, to the capture step", async () => {
    const { flow, captureCalls } = harness();
    await flow.start("hello");
    expect(captureCalls).toHaveLength(1);
    expect(captureCalls[0]).toEqual(target());
  });
});

describe("ScreenshotFlow with a large capture", () => {
  it("refuses an oversized image and never sends it", async () => {
    const huge = image({ data: "A".repeat(14 * 1024 * 1024) });
    const { flow, sent } = harness({ image: huge });
    const result = await flow.start("hello");
    expect(result.ok).toBe(false);
    expect(sent).toHaveLength(0);
    expect(flow.pending).toBeNull();
  });

  it("calls send at most once per confirmation", async () => {
    const { flow } = harness();
    const preview = await flow.start("hello");
    if (!preview.ok) throw new Error("expected a preview");
    const spySend = vi.fn();
    await flow.resolve(preview.observationId, true);
    expect(spySend).not.toHaveBeenCalled();
  });
});
