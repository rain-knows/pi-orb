import { describe, expect, it } from "vitest";
import { matchWindowSource, windowSourceId } from "../src/main/desktop-capture";
import type { CaptureTarget } from "@shared/screenshot";

function target(overrides: Partial<CaptureTarget> = {}): CaptureTarget {
  return {
    handle: "329270",
    processId: 42,
    title: "Editor — notes.txt",
    bounds: { x: 0, y: 0, width: 1200, height: 800 },
    dpi: 144,
    ...overrides,
  };
}

describe("windowSourceId", () => {
  it("uses the prefix Electron actually emits", () => {
    // Verified against a real Electron 44.4.5 run: a window source id is
    // `window:<native handle>:<index>`, and the middle segment equalled a live
    // Win32 window handle whose title matched the source name.
    expect(windowSourceId("329270")).toBe("window:329270:");
  });
});

describe("matchWindowSource", () => {
  const sources = [
    { id: "window:1181646:0", name: "Backstop Window" },
    { id: "window:329270:0", name: "Editor — notes.txt" },
    { id: "screen:0:0", name: "Entire screen" },
  ];

  it("matches the recorded handle exactly", () => {
    expect(matchWindowSource(sources, target())?.id).toBe("window:329270:0");
  });

  it("does not match a different window", () => {
    expect(matchWindowSource(sources, target({ handle: "999" }))).toBeNull();
  });

  it("does not match a screen source even if the numbers coincide", () => {
    // A full-screen capture would defeat the point of recording one window.
    const screenOnly = [{ id: "screen:329270:0", name: "Entire screen" }];
    expect(matchWindowSource(screenOnly, target())).toBeNull();
  });

  it("does not accept a handle that is merely a prefix of another", () => {
    // "window:32927:" must not match "window:329270:0": the trailing colon is what
    // keeps identity exact.
    const nearMiss = [{ id: "window:3292700:0", name: "Editor — notes.txt" }];
    expect(matchWindowSource(nearMiss, target({ handle: "329270" }))).toBeNull();
  });

  it("returns null for an empty source list", () => {
    expect(matchWindowSource([], target())).toBeNull();
  });
});
