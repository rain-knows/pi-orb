/**
 * Real pi-web SSE event shapes used by the session-controller tests.
 *
 * These are not invented: they reproduce what pi-web actually sends, taken from
 *   - `lib/agent-event-wire.ts` (`toClientAgentEvent` strips the bulky `partial`
 *     field and drops `turn_start`/`turn_end` and system messages), and
 *   - Pi's own assistant stream union
 *     (`@earendil-works/pi-agent-core/dist/proxy.d.ts`).
 *
 * Keeping them in one module matters because a guessed shape fails silently: the
 * UI simply never receives text, with no error anywhere. That exact mistake was
 * made and then caught by the real end-to-end run in the historical Pi Web integration run.
 */

/** Streaming text arrives nested under `assistantMessageEvent`. */
export function textDelta(delta: string, contentIndex = 0): unknown {
  return {
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex, delta },
  };
}

/** Pi announces a new assistant message inside a message_start. */
export function assistantMessageStart(): unknown {
  return { type: "message_start", message: { role: "assistant", content: [] } };
}

/** The first message_end of a turn belongs to the user message. */
export function userMessageEnd(text: string): unknown {
  return { type: "message_end", message: { role: "user", content: text } };
}

export function systemMessageEnd(): unknown {
  return { type: "message_end", message: { role: "system", content: "prompt" } };
}

export function assistantMessageEnd(content: unknown = [], stopReason = "stop"): unknown {
  return { type: "message_end", message: { role: "assistant", content, stopReason } };
}

export function agentEnd(): unknown {
  return { type: "agent_end" };
}

/** pi-web v0.10 logical prompt completion (after retries and follow-ups). */
export function promptDone(): unknown {
  return { type: "prompt_done" };
}

export function streamError(message: string): unknown {
  return { type: "error", message };
}

/** Pi reports a failed model call as a nested assistant event. */
export function assistantError(errorMessage: string): unknown {
  return { type: "message_update", assistantMessageEvent: { type: "error", errorMessage } };
}
