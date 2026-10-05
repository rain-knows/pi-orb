/** Pi context adapter for the reference Computer Use preset.
 * Text slicing is ported from deepseek-harness-orb@72f1d738458a223696685a909e806b683eff5885,
 * packages/compaction/compaction-tool-result-pruner/src/index.ts (MIT, Copyright (c) 2026 DeepSeek).
 * Budgets match dsh-orb-cordis@9cdc503 packages/computer-use/presets/computer-use/agent.cordis.yml.
 * Pi owns compaction/history; this adapter projects model input without mutating persisted messages.
 */
import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import { ORB_TOOL_NAMES } from "../../src/shared/orb-tools";

const THRESHOLD_CHARS = 8192;
const HEAD_CHARS = 4096;
const TAIL_CHARS = 1024;
const PRUNE_MARKER = "\n\n[... tool result middle pruned ...]\n\n";
type Message = ContextEvent["messages"][number];
type ToolResult = Extract<Message, { role: "toolResult" }>;
type Blocks = ToolResult["content"];

/** Reference head/middle/tail slicing across text blocks, retaining rich-block order. */
export function pruneToolText(blocks: Blocks): Blocks {
  const totalChars = blocks.reduce((total, block) => total + (block.type === "text" ? Array.from(block.text).length : 0), 0);
  if (totalChars <= THRESHOLD_CHARS) return blocks;
  const removedEnd = totalChars - TAIL_CHARS;
  const pruned: Blocks = [];
  let consumed = 0;
  let markerInserted = false;
  for (const block of blocks) {
    if (block.type !== "text") { pruned.push(block); continue; }
    const points = Array.from(block.text);
    const blockStart = consumed;
    const blockEnd = blockStart + points.length;
    const headEnd = Math.min(points.length, Math.max(0, HEAD_CHARS - blockStart));
    const tailStart = Math.min(points.length, Math.max(0, removedEnd - blockStart));
    const intersectsRemoved = blockStart < removedEnd && blockEnd > HEAD_CHARS;
    const marker = intersectsRemoved && !markerInserted ? PRUNE_MARKER : "";
    if (marker.length > 0) markerInserted = true;
    const text = points.slice(0, headEnd).join("") + marker + points.slice(tailStart).join("");
    if (text.length > 0) pruned.push({ ...block, text });
    consumed = blockEnd;
  }
  return pruned;
}

/** Keep the latest Orb observation image; user attachments and other tools remain intact. */
export function projectComputerUseContext(messages: ContextEvent["messages"]): ContextEvent["messages"] {
  let retainedImage = false;
  return messages.slice().reverse().map(message => {
    const observation = (message.role === "toolResult" && ORB_TOOL_NAMES.includes(message.toolName))
      || (message.role === "custom" && message.customType === "computer-use");
    if (observation && "content" in message && Array.isArray(message.content)) {
      const content = message.content.slice().reverse().map(block => {
        if (block.type !== "image") return block;
        if (!retainedImage) { retainedImage = true; return block; }
        return { type: "text" as const, text: "[Earlier Computer Use screenshot omitted; use the latest screenshot.]" };
      }).reverse();
      return { ...message, content: message.role === "toolResult" ? pruneToolText(content) : content } as Message;
    }
    if (message.role === "toolResult") return { ...message, content: pruneToolText(message.content) };
    return message;
  }).reverse();
}
