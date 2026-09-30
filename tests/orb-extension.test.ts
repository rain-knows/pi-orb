import { describe, expect, it } from "vitest";
import { formatToolResult, renderResult } from "../pi-package/extensions/orb";

describe("Orb extension result rendering", () => {
  it("renders an action result with an observation id as action JSON", () => {
    const result = {
      ok: true,
      action: "click",
      observationId: "obs-1",
      observation: {
        observationId: "obs-after",
        window: { id: "42", pid: 24, title: "Target", appName: "target.exe" },
        coordinateSpace: { action: "screenshot-fraction", space: 1000, windowRect: { x: 0, y: 0, width: 1, height: 1 } },
        elements: [],
        image: { data: "AQID", mimeType: "image/png", width: 1, height: 1 },
      },
      next: "Use this fresh observation for the next action.",
    };

    expect(renderResult(result)).toContain("action: click completed");
    expect(renderResult(result)).toContain("observation_id: obs-after");
  });

  it("renders observations with their coordinate contract", () => {
    const result = {
      observationId: "obs-1",
      window: { id: "42", pid: 24, title: "Target", appName: "target.exe" },
      coordinateSpace: {
        action: "screenshot-fraction",
        space: 1000,
        windowRect: { x: 0, y: 0, width: 800, height: 600 },
      },
      elements: [],
      elementsUnavailable: true,
      degraded: false,
    };

    expect(renderResult(result)).toContain("observation_id: obs-1");
    expect(renderResult(result)).toContain("800x600 px");
  });

  it("returns a fresh action observation as a Pi image block without duplicating base64 in details", () => {
    const image = { data: "AQID", mimeType: "image/png", width: 1, height: 1 };
    const result = formatToolResult({
      ok: true,
      action: "drag",
      observation: {
        observationId: "obs-after-action",
        window: { id: "42", pid: 24, title: "Target", appName: "target.exe" },
        coordinateSpace: { action: "screenshot-fraction", space: 1000, windowRect: { x: 0, y: 0, width: 1, height: 1 } },
        elements: [{ token: "obsolete", role: "Button", label: "Old", actions: ["invoke"] }],
        elementsUnavailable: true,
        degraded: false,
        image,
      },
    });

    expect(result.content).toEqual([
      { type: "text", text: expect.stringContaining("observation_id: obs-after-action") },
      { type: "image", data: "AQID", mimeType: "image/png" },
    ]);
    expect(JSON.stringify(result.details)).not.toContain("AQID");
    expect(JSON.stringify(result.details)).not.toContain("obsolete");
  });
});
