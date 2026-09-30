/**
 * Request-only image budget, inspired by reference attachment-local request-image.ts.
 * rain-knows/deepseek-harness-orb@72f1d738458a223696685a909e806b683eff5885, MIT.
 * Pi's public context hook replaces dsh attachment projections; durable messages are never changed.
 */
import { ORB_TOOLS } from "../../src/shared/orb-tools.js";

const orbTools = new Set<string>(Object.values(ORB_TOOLS));
export const RETAINED_ORB_IMAGES = 3;

/** Copy only changed tool messages; user attachments and other tool content pass through intact. */
export function limitOrbImages<T>(messages: readonly T[]): T[] {
  let remaining = RETAINED_ORB_IMAGES;
  return [...messages].reverse().map(message => {
    if (!message || typeof message !== "object") return message;
    const record = message as Record<string, unknown>;
    if (record.role !== "toolResult" || typeof record.toolName !== "string" || !orbTools.has(record.toolName) || !Array.isArray(record.content)) return message;
    let changed = false;
    const content = [...record.content].reverse().map(block => {
      if (!block || typeof block !== "object" || block.type !== "image") return block;
      if (remaining-- > 0) return block;
      changed = true;
      return { type: "text", text: "[较早的 Orb 工具截图已从本次模型请求省略；动作、观察编号和窗口信息保留，完整图片仍在聊天记录中。]" };
    }).reverse();
    return changed ? { ...record, content } as T : message;
  }).reverse();
}

/** Exact encoded/base64 size of projected image blocks; never logs image data. */
export function orbImageBudget(messages: readonly unknown[]): { images: number; bytes: number; base64Bytes: number } {
  let images = 0; let bytes = 0; let base64Bytes = 0;
  for (const message of messages) {
    const record = message as Record<string, unknown> | null;
    if (!record || record.role !== "toolResult" || typeof record.toolName !== "string" || !orbTools.has(record.toolName) || !Array.isArray(record.content)) continue;
    for (const block of record.content) if (block?.type === "image" && typeof block.data === "string") {
      images++; bytes += Buffer.byteLength(block.data, "base64"); base64Bytes += Buffer.byteLength(block.data, "utf8");
    }
  }
  return { images, bytes, base64Bytes };
}
