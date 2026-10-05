import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { projectComputerUseContext, pruneToolText } from "../pi-package/extensions/computer-use-context";

type Messages = ContextEvent["messages"];
const image = (data: string) => ({ type: "image" as const, data, mimeType: "image/png" });
const tool = (name: string, data?: string) => ({ role: "toolResult" as const, toolName: name, toolCallId: `call-${name}`, timestamp: 1, isError: false, content: data ? [image(data)] : [{ type: "text" as const, text: "error without screenshot" }] });

describe("Computer Use model context", () => {
  it("retains only the latest GUI image and leaves persisted messages untouched", () => {
    const messages: Messages = [tool("click", "first"), tool("input_text", "second"), tool("scroll", "latest")];
    const persisted = structuredClone(messages);
    const projected = projectComputerUseContext(messages);
    expect(projected).toMatchObject([
      { toolCallId: "call-click", content: [{ type: "text" }] },
      { toolCallId: "call-input_text", content: [{ type: "text" }] },
      { toolCallId: "call-scroll", content: [image("latest")] },
    ]);
    expect(messages).toEqual(persisted);
    expect(projectComputerUseContext(projected)).toEqual(projected);
  });

  it("counts automatic first frames together with action images, preserving user and unrelated tool images", () => {
    const messages: Messages = [
      { role: "custom", customType: "computer-use", content: [image("old-frame")], display: false, timestamp: 1 },
      { role: "user", content: [image("user")], timestamp: 2 },
      tool("read", "file"),
      tool("click", "action"),
      { role: "custom", customType: "computer-use", content: [image("new-frame")], display: false, timestamp: 3 },
    ];
    const projected = projectComputerUseContext(messages);
    expect(JSON.stringify(projected)).not.toContain('"data":"old-frame"');
    expect(JSON.stringify(projected)).not.toContain('"data":"action"');
    for (const data of ["new-frame", "user", "file"]) expect(JSON.stringify(projected)).toContain(`"data":"${data}"`);
  });

  it("does not discard the current image when a later tool failed without a screenshot", () => {
    expect(projectComputerUseContext([tool("click", "latest"), tool("scroll")])[0]).toEqual(tool("click", "latest"));
  });

  it("uses the reference 8192 code-point threshold without splitting emoji", () => {
    const blocks = [{ type: "text" as const, text: "🙂".repeat(8192) }];
    expect(pruneToolText(blocks)).toBe(blocks);
    const result = pruneToolText([{ type: "text", text: "🙂".repeat(8193) }]);
    expect(result).toEqual([{ type: "text", text: "🙂".repeat(4096) + "\n\n[... tool result middle pruned ...]\n\n" + "🙂".repeat(1024) }]);
  });

  it("slices text across blocks and preserves intervening images and result metadata", () => {
    const messages: Messages = [{ ...tool("read"), isError: true, details: { path: "out.txt" }, content: [
      { type: "text", text: "a".repeat(4200) }, image("middle"), { type: "text", text: "b".repeat(4500) },
    ] }];
    const persisted = structuredClone(messages);
    const projected = projectComputerUseContext(messages);
    expect(projected[0]).toMatchObject({ isError: true, details: { path: "out.txt" }, toolCallId: "call-read", content: [
      { type: "text", text: "a".repeat(4096) + "\n\n[... tool result middle pruned ...]\n\n" }, image("middle"), { type: "text", text: "b".repeat(1024) },
    ] });
    expect(messages).toEqual(persisted);
  });
});
