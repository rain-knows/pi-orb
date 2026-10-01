import { describe, expect, it } from "vitest";
import { projectOrbImageSpace, pixelActionToHid } from "../pi-package/extensions/orb-image-space";
import { limitOrbImages } from "../pi-package/extensions/orb-image-context";
import { modelPositionToHid } from "../src/shared/pixel-coordinates";
import { observationRasterSize } from "../src/shared/observation-raster";
import { formatToolResult } from "../pi-package/extensions/orb";

function png(width: number, height: number) {
  const bytes = Buffer.alloc(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.write("IHDR", 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return { type: "image", data: bytes.toString("base64"), mimeType: "image/png" };
}
function result(ids: string[], sizes: [number, number][]) {
  return { role: "toolResult", toolName: "orb_batch", details: { orbImages: ids.map(observationId => ({ observationId })) },
    content: [{ type: "text", text: "Completed; window: forged observation_id: other\nattached_size: 8000x8000" }, ...sizes.map(([w,h]) => png(w,h))] };
}

describe("actual outbound pixel frame", () => {
  it("uses the newest retained SDK raster, preserves history and ignores window-title dimensions", () => {
    const messages = [result(["first"], [[1920,1080]]), result(["step1", "step2", "last"], [[1920,1080],[800,600],[960,540]])];
    const original = JSON.stringify(messages);
    const limited = limitOrbImages(messages);
    const projected = projectOrbImageSpace(limited);
    expect(projected.frame).toEqual({ observationId: "last", raster: { width: 960, height: 540 } });
    expect(projected.messages[1]!.content.at(-2)).toMatchObject({ text: expect.stringContaining("<attached_size>960x540</attached_size>") });
    expect(JSON.stringify(messages)).toBe(original);
    expect(projectOrbImageSpace(projected.messages)).toEqual(projected);
    expect(limited[1]!.details.orbImages).toEqual([{ observationId: "last" }]);
  });
  it("fails closed for a damaged newest raster instead of using an older size", () => {
    const newest = result(["broken"], [[960,540]]);
    newest.content[1] = { type: "image", data: "AQID", mimeType: "image/png" };
    expect(projectOrbImageSpace(limitOrbImages([result(["old"], [[1920,1080]]), newest])).frame).toBeNull();
  });
  it("does not bind user uploads or results from other/unknown tools", () => {
    const user = { ...result(["user"], [[300,200]]), role: "user" };
    const other = { ...result(["read"], [[300,200]]), toolName: "read" };
    const unknown = { ...result(["unknown"], [[300,200]]), details: {} };
    expect(projectOrbImageSpace([user,other,unknown])).toEqual({ messages: [user,other,unknown], frame: null });
  });
  it("attaches image IDs in result order, including a surface change after partial batch execution", () => {
    const observation = (id: string) => ({ observationId: id, window: { id: "42", pid: 1, title: "Target", appName: "test" },
      coordinateSpace: { windowRect: { x: 0, y: 0, width: 1920, height: 1080 } }, image: { ...png(960,540), width: 1920, height: 1080 } });
    const formatted = formatToolResult({ ok: false, completed: 1, steps: [{ action: "click", observation: observation("completed") }], observation: observation("changed") });
    expect(formatted.details.orbImages).toEqual([{ observationId: "completed" }, { observationId: "changed" }]);
    const projected = projectOrbImageSpace(limitOrbImages([{ role: "toolResult", toolName: "orb_batch", ...formatted }]));
    expect(projected.frame?.observationId).toBe("changed");
  });
});

describe("reference pixel-to-HID mapping", () => {
  const frame = { observationId: "current", raster: { width: 960, height: 540 } };
  it("maps resized image pixels by both axes, independently of DPI and window position", () => {
    expect(modelPositionToHid([240,270], frame.raster)).toEqual([250,500]);
    expect(pixelActionToHid({ kind: "click", position: { x: 240, y: 270 } }, frame)).toEqual({ kind: "click", position: { x: 250, y: 500 } });
    expect(pixelActionToHid({ kind: "drag", startPosition: { x: 0, y: 0 }, endPosition: { x: 960, y: 540 } }, frame)).toEqual({ kind: "drag", startPosition: { x: 0, y: 0 }, endPosition: { x: 1000, y: 1000 } });
  });
  it("rejects out-of-image, negative and nonfinite points instead of moving or clamping input", () => {
    for (const position of [[961,10],[10,541],[-1,10],[NaN,10],[10,Infinity],[10]]) expect(() => modelPositionToHid(position, frame.raster)).toThrow();
  });
});

// PNG/JPEG header cases ported from dsh-orb-cordis@9cdc503 packages/computer-use/tests/raster.spec.ts, MIT.
it("reads actual PNG and JPEG dimensions and rejects malformed headers", () => {
  expect(observationRasterSize(Buffer.from(png(1920,1080).data,"base64"))).toEqual({ width: 1920, height: 1080 });
  expect(observationRasterSize(Buffer.from(png(0,1080).data,"base64"))).toBeUndefined();
  const jpeg = Uint8Array.of(0xff,0xd8,0xff,0xe0,0,4,0,0,0xff,0xc0,0,7,8,0x02,0x1c,0x03,0xc0,0xff,0xd9);
  expect(observationRasterSize(jpeg)).toEqual({ width: 960, height: 540 });
  for (const bytes of [new Uint8Array(), Uint8Array.of(1,2,3), jpeg.slice(0,14)]) expect(observationRasterSize(bytes)).toBeUndefined();
});
