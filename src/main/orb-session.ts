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

import type { ImageContent, PiWebClient, PiWebUiResponse } from "./pi-web-client";
import type { OrbSessionEvent } from "@shared/ipc";

export interface OrbSessionDeps {
  readonly client: PiWebClient;
  readonly emit: (event: OrbSessionEvent) => void;
  readonly now?: () => number;
}

interface AssistantAccumulator {
  text: string;
}

interface QueuedPrompt {
  readonly text: string;
  readonly images?: readonly ImageContent[];
}

export class OrbSessionController {
  readonly #deps: OrbSessionDeps;
  #sessionId: string | null = null;
  #workspace: string | null = null;
  #generation = 0;
  #closeStream: (() => void) | null = null;
  #running = false;
  #accumulator: AssistantAccumulator | null = null;
  #pendingQuestionId: string | null = null;
  #promptQueue: QueuedPrompt[] = [];
  #creating: { workspace: string; promise: Promise<string> } | null = null;
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

  get pendingQuestionId(): string | null {
    return this.#pendingQuestionId;
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
    this.#creating = null;
    this.#closeStream?.();
    this.#closeStream = null;
    this.#sessionId = null;
    this.#workspace = null;
    this.#running = false;
    this.#accumulator = null;
    this.#pendingQuestionId = null;
    this.#promptQueue = [];
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
    if (this.#creating?.workspace === workspace) return this.#creating.promise;

    this.#closeStream?.();
    this.#closeStream = null;
    this.#running = false;
    this.#pendingQuestionId = null;
    this.#promptQueue = [];

    const creating: { workspace: string; promise: Promise<string> } = {
      workspace,
      promise: this.#deps.client.createSession(workspace).then((sessionId) => {
        if (this.#creating !== creating) throw new Error("The session request was superseded.");
        this.#sessionId = sessionId;
        this.#workspace = workspace;
        this.#deps.emit({ type: "session", sessionId, generation: this.#generation });
        return sessionId;
      }).finally(() => {
        if (this.#creating === creating) this.#creating = null;
      }),
    };
    this.#creating = creating;
    return creating.promise;
  }

  /** Start a fresh session without changing the configured workspace or run generation. */
  async newConversation(workspace: string): Promise<string> {
    if (this.#running) throw new Error("The current conversation is still running.");
    this.#creating = null;
    this.#closeStream?.();
    this.#closeStream = null;
    this.#sessionId = null;
    this.#workspace = null;
    this.#accumulator = null;
    this.#pendingQuestionId = null;
    this.#promptQueue = [];
    return this.ensureSession(workspace);
  }

  /** Attach to an existing persisted Pi session in the same workspace. */
  async openExistingSession(workspace: string, sessionId: string): Promise<string> {
    if (this.#running) throw new Error("The current conversation is still running.");
    this.#creating = null;
    this.#closeStream?.();
    this.#closeStream = null;
    this.#sessionId = sessionId;
    this.#workspace = workspace;
    this.#accumulator = null;
    this.#pendingQuestionId = null;
    this.#deps.emit({ type: "session", sessionId, generation: this.#generation });
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

    const wasRunning = this.#running;
    this.#promptQueue.push({ text, ...(images ? { images } : {}) });
    if (wasRunning) {
      this.#deps.emit({ type: "queued", count: this.#promptQueue.length });
      return;
    }
    this.#running = true;
    await this.#startNextPrompt();
  }

  async abort(): Promise<void> {
    const sessionId = this.#sessionId;
    if (!sessionId) return;
    this.#promptQueue = [];
    await this.#deps.client.abort(sessionId);
    this.#running = false;
    this.#pendingQuestionId = null;
    this.#accumulator = null;
    this.#deps.emit({ type: "idle", stopReason: "aborted" });
  }

  async respondToQuestion(response: PiWebUiResponse): Promise<void> {
    if (!this.#sessionId || this.#pendingQuestionId !== response.id) {
      throw new Error("The question is no longer active.");
    }
    await this.#deps.client.respondToExtensionUi(this.#sessionId, response);
    // Pi Web also emits extension_ui_closed. Clear locally now so a double click cannot answer twice.
    this.#pendingQuestionId = null;
    this.#deps.emit({ type: "question-closed", id: response.id });
  }

  /** Release the stream and drop the session binding (used on shutdown). */
  dispose(): void {
    this.#creating = null;
    this.#closeStream?.();
    this.#closeStream = null;
    this.#sessionId = null;
    this.#workspace = null;
    this.#running = false;
    this.#accumulator = null;
    this.#pendingQuestionId = null;
    this.#promptQueue = [];
  }

  async #subscribe(sessionId: string): Promise<void> {
    this.#closeStream?.();
    this.#closeStream = null;
    this.#closeStream = await this.#deps.client.openEventStream(
      sessionId,
      (event) => this.#handleEvent(event),
      (error) => this.#handleStreamError(error),
    );
  }

  async #startNextPrompt(): Promise<void> {
    const sessionId = this.#sessionId;
    const next = this.#promptQueue.shift();
    if (!sessionId || !next) {
      this.#finishQueue(null);
      return;
    }
    try {
      await this.#subscribe(sessionId);
      this.#accumulator = { text: "" };
      this.#deps.emit({ type: "turn-start" });
      await this.#deps.client.prompt(sessionId, next.text, next.images, this.#workspace ?? undefined);
    } catch (error) {
      this.#accumulator = null;
      this.#deps.emit({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      if (this.#promptQueue.length > 0) {
        await this.#startNextPrompt();
      } else {
        this.#finishQueue(null);
      }
    }
  }

  #finishQueue(stopReason: string | null): void {
    if (this.#promptQueue.length > 0) {
      void this.#startNextPrompt();
      return;
    }
    this.#running = false;
    this.#deps.emit({ type: "idle", stopReason });
  }

  #handleStreamError(error: Error): void {
    if (!this.#running) return;
    this.#closeStream?.();
    this.#closeStream = null;
    this.#promptQueue = [];
    this.#accumulator = null;
    this.#running = false;
    this.#deps.emit({ type: "error", message: error.message });
    this.#deps.emit({ type: "idle", stopReason: null });
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
      case "tool_execution_start":
      case "tool_execution_end": {
        const id = typeof record.toolCallId === "string" ? record.toolCallId : "";
        const name = typeof record.toolName === "string" ? record.toolName : "";
        if (!id || !name) return;
        const phase = type === "tool_execution_start" ? "start" : "end";
        this.#deps.emit({
          type: "tool",
          phase,
          id,
          name,
          detail: phase === "start" ? summarizeToolArgs(record.args) : record.isError === true ? "Failed" : "Completed",
          isError: phase === "end" && record.isError === true,
        });
        return;
      }
      case "extension_ui_request": {
        const method = record.method;
        const id = record.id;
        if (typeof id !== "string" || !["select", "confirm", "input", "editor"].includes(String(method))) return;
        this.#pendingQuestionId = id;
        this.#deps.emit({
          type: "question",
          id,
          method: method as "select" | "confirm" | "input" | "editor",
          title: typeof record.title === "string" ? record.title : "Question",
          message: typeof record.message === "string" ? record.message : "",
          options: Array.isArray(record.options) ? record.options.filter((value): value is string => typeof value === "string") : [],
          prefill: typeof record.prefill === "string" ? record.prefill : "",
        });
        return;
      }
      case "extension_ui_closed": {
        if (this.#pendingQuestionId === null || record.id !== this.#pendingQuestionId) return;
        const id = this.#pendingQuestionId;
        this.#pendingQuestionId = null;
        this.#deps.emit({ type: "question-closed", id });
        return;
      }
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
        if (this.#pendingQuestionId) {
          this.#deps.emit({ type: "question-closed", id: this.#pendingQuestionId });
          this.#pendingQuestionId = null;
        }
        this.#finishQueue(stopReason);
        return;
      }
      case "error": {
        const message =
          typeof record.message === "string" ? record.message : "pi-web reported an error.";
        if (this.#pendingQuestionId) {
          this.#deps.emit({ type: "question-closed", id: this.#pendingQuestionId });
          this.#pendingQuestionId = null;
        }
        this.#deps.emit({ type: "error", message });
        this.#finishQueue(null);
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

function summarizeToolArgs(value: unknown): string {
  if (typeof value !== "object" || value === null) return "Running";
  try {
    const summary = JSON.stringify(value, (key, item: unknown) =>
      /(?:data|base64|image|token|secret|password)/iu.test(key) ? "[omitted]" : item);
    return summary.length > 160 ? `${summary.slice(0, 157)}...` : summary;
  } catch {
    return "Running";
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
