/**
 * Orb session controller (Electron main process).
 *
 * Owns exactly one Orb chat session at a time, bound to the current run
 * generation. It reuses pi-web's existing session creation, prompt, abort and SSE
 * endpoints instead of implementing any part of the agent loop
 * (doc/pi-orb-development-goals.md §4.1).
 *
 * Verified pi-web behaviour this relies on (evidence/p0-03):
 *  - SSE must be subscribed *before* the prompt or the first turn is missed,
 *  - `reload`/reconnect keeps the same session id, so browsing history from the
 *    normal pi-web UI stays possible,
 *  - the first `message_end` in a stream belongs to the user message, so
 *    completion is tracked from assistant-role events only.
 */

import type { ImageContent, PiWebClient } from "./pi-web-client";
import type { OrbSessionEvent } from "@shared/ipc";

export interface OrbSessionDeps {
  readonly client: PiWebClient;
  readonly emit: (event: OrbSessionEvent) => void;
  readonly now?: () => number;
}

interface AssistantAccumulator {
  text: string;
}

export class OrbSessionController {
  readonly #deps: OrbSessionDeps;
  #sessionId: string | null = null;
  #workspace: string | null = null;
  #generation = 0;
  #closeStream: (() => void) | null = null;
  #running = false;
  #accumulator: AssistantAccumulator | null = null;
  constructor(deps: OrbSessionDeps) {
    this.#deps = deps;
  }

  get sessionId(): string | null {
    return this.#sessionId;
  }

  get workspace(): string | null {
    return this.#workspace;
  }

  get running(): boolean {
    return this.#running;
  }

  /**
   * The generation this controller is bound to.
   *
   * The task lock is released against this generation rather than "whatever is
   * current", so a turn that ends after a new run started cannot release the new
   * run's lock.
   */
  get generation(): number {
    return this.#generation;
  }

  /**
   * Bind the controller to a new run. Drops every stream and session reference
   * from the previous run so no stale work can continue under a new generation.
   */
  beginGeneration(generation: number): void {
    this.#closeStream?.();
    this.#closeStream = null;
    this.#sessionId = null;
    this.#workspace = null;
    this.#running = false;
    this.#accumulator = null;
    this.#generation = generation;
  }

  /**
   * Create or reuse the session for `workspace`.
   *
   * Switching workspace always starts a new session: pi-web fixes `cwd` at
   * creation time, so reusing a session would run the new workspace against the
   * old directory (doc P1-01 "切工作区…不串会话").
   */
  async ensureSession(workspace: string): Promise<string> {
    if (this.#sessionId && this.#workspace === workspace) {
      return this.#sessionId;
    }

    this.#closeStream?.();
    this.#closeStream = null;
    this.#running = false;

    const sessionId = await this.#deps.client.createSession(workspace);
    this.#sessionId = sessionId;
    this.#workspace = workspace;
    this.#deps.emit({
      type: "session",
      sessionId,
      generation: this.#generation,
    });
    return sessionId;
  }

  /**
   * Send a prompt, subscribing to the event stream first.
   *
   * Rejects when no session has been created, so a prompt can never be sent
   * against the wrong workspace.
   */
  async prompt(text: string, images?: readonly ImageContent[]): Promise<void> {
    const sessionId = this.#sessionId;
    if (!sessionId) {
      throw new Error("No Orb session. Select a workspace first.");
    }
    // An image-only message is legitimate (a screenshot with no text), so the empty
    // check only applies when there is nothing to send at all.
    if (text.trim().length === 0 && (!images || images.length === 0)) return;

    await this.#subscribe(sessionId);
    this.#running = true;
    this.#accumulator = { text: "" };
    try {
      await this.#deps.client.prompt(sessionId, text, images, this.#workspace ?? undefined);
    } catch (error) {
      // The prompt never started, so no idle event will arrive to clear the state.
      this.#running = false;
      throw error;
    }
    // Deliberately no success-path cleanup here. The prompt call returning only
    // means pi-web accepted the message; the turn itself continues until an
    // `agent_end` (or a stream error) arrives. Releasing the task lock here would
    // free it while the turn is still running, allowing a second GUI task to be
    // started concurrently.
  }

  async abort(): Promise<void> {
    const sessionId = this.#sessionId;
    if (!sessionId) return;
    await this.#deps.client.abort(sessionId);
    this.#running = false;
  }

  /** Release the stream and drop the session binding (used on shutdown). */
  dispose(): void {
    this.#closeStream?.();
    this.#closeStream = null;
    this.#sessionId = null;
    this.#workspace = null;
    this.#running = false;
    this.#accumulator = null;
  }

  async #subscribe(sessionId: string): Promise<void> {
    this.#closeStream?.();
    this.#closeStream = null;
    this.#closeStream = await this.#deps.client.openEventStream(
      sessionId,
      (event) => this.#handleEvent(event),
      (error) => this.#deps.emit({ type: "error", message: error.message }),
    );
  }

  #handleEvent(event: unknown): void {
    if (typeof event !== "object" || event === null) return;
    const record = event as Record<string, unknown>;
    const type = record.type;
    if (typeof type !== "string") return;

    switch (type) {
      case "message_update":
        this.#handleMessageUpdate(record);
        return;
      case "message_end": {
        // The first message_end of a turn belongs to the user message of that
        // turn; only an assistant message ends the reply.
        const message = record.message as
          | { role?: string; content?: unknown }
          | undefined;
        if (message?.role !== "assistant") return;
        // Prefer streamed deltas, but fall back to the finalized content. The
        // accumulator starts as an empty string, so a truthiness-agnostic `??`
        // would keep the empty string and render a reply as nothing when no
        // delta events arrived.
        const streamed = this.#accumulator?.text ?? "";
        const text = streamed.length > 0 ? streamed : extractText(message.content);
        this.#accumulator = null;
        this.#emitAssistantMessage(text);
        return;
      }
      case "agent_end": {
        const stopReason = typeof record.stopReason === "string" ? record.stopReason : null;
        if (this.#accumulator) {
          this.#emitAssistantMessage(this.#accumulator.text);
          this.#accumulator = null;
        }
        this.#running = false;
        this.#deps.emit({ type: "idle", stopReason });
        return;
      }
      case "error": {
        const message =
          typeof record.message === "string" ? record.message : "pi-web reported an error.";
        this.#running = false;
        this.#deps.emit({ type: "error", message });
        return;
      }
      default:
        return;
    }
  }

  /**
   * Handle the streaming update envelope.
   *
   * The wire format is pi-web's `toClientAgentEvent` projection
   * (`lib/agent-event-wire.ts`): `{ type: "message_update", assistantMessageEvent }`
   * with the bulky `partial` field stripped. The nested `assistantMessageEvent` is
   * Pi's own stream union, so text arrives as
   * `{ type: "text_delta", contentIndex, delta }` and completion as
   * `{ type: "done", reason }`.
   */
  #handleMessageUpdate(record: Record<string, unknown>): void {
    const update = record.assistantMessageEvent;
    if (typeof update !== "object" || update === null) return;
    const updateRecord = update as Record<string, unknown>;
    const updateType = updateRecord.type;

    if (updateType === "text_delta") {
      const delta = updateRecord.delta;
      if (typeof delta !== "string" || delta.length === 0) return;
      if (!this.#accumulator) this.#accumulator = { text: "" };
      this.#accumulator.text += delta;
      this.#deps.emit({ type: "assistant-delta", text: delta });
      return;
    }

    if (updateType === "error") {
      const message = updateRecord.errorMessage;
      this.#running = false;
      this.#deps.emit({
        type: "error",
        message: typeof message === "string" ? message : "The model call failed.",
      });
    }
  }

  #emitAssistantMessage(text: string): void {
    if (text.length === 0) return;
    this.#deps.emit({ type: "assistant-message", text });
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part === "object" && part !== null) {
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string") return text;
      }
      return "";
    })
    .join("");
}
