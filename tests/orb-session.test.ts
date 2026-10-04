import { describe, expect, it, vi } from "vitest";
import { OrbSessionController } from "../src/main/orb-session";
import type { PiWebClient } from "../src/main/pi-web-client";
import type { OrbSessionEvent } from "@shared/ipc";
import {
  agentEnd,
  promptDone,
  assistantError,
  assistantMessageEnd,
  assistantMessageStart,
  streamError,
  systemMessageEnd,
  textDelta,
  userMessageEnd,
} from "./fixtures/pi-web-events";

interface FakeClient {
  createSession: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  respondToExtensionUi: ReturnType<typeof vi.fn>;
  openEventStream: ReturnType<typeof vi.fn>;
  delivered: ((event: unknown) => void)[];
  closed: number;
}

function fakeClient(): FakeClient {
  const state: FakeClient = {
    createSession: vi.fn(),
    prompt: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    respondToExtensionUi: vi.fn().mockResolvedValue(undefined),
    openEventStream: vi.fn(),
    delivered: [],
    closed: 0,
  };
  let nextId = 0;
  state.createSession.mockImplementation(async () => `session-${(nextId += 1)}`);
  state.openEventStream.mockImplementation(
    async (_sessionId: string, onEvent: (event: unknown) => void) => {
      state.delivered.push(onEvent);
      return () => {
        state.closed += 1;
      };
    },
  );
  return state;
}

function setup() {
  const client = fakeClient();
  const events: OrbSessionEvent[] = [];
  const logs: Record<string, unknown>[] = [];
  const controller = new OrbSessionController({
    client: client as unknown as PiWebClient,
    emit: (event) => events.push(event),
    log: (entry) => logs.push(entry),
  });
  controller.beginGeneration(1);
  return { client, controller, events, logs };
}

describe("OrbSessionController", () => {
  it("rejects old stream events immediately when workspace or history session changes", async () => {
    const { controller, client } = setup();
    await controller.ensureSession("C:\\work\\orb");
    await controller.prompt("first");
    const first = client.delivered[0]!;
    first(promptDone());
    await controller.ensureSession("C:\\work\\other");
    first({ type: "agent_start" });
    expect(controller.running).toBe(false);
    await controller.prompt("second");
    const second = client.delivered[1]!;
    second(promptDone());
    await controller.openExistingSession("C:\\work\\other", "history-session");
    second({ type: "agent_start" });
    expect(controller.running).toBe(false);
  });

  it("keeps retries, compaction and extension follow-ups in one prompt until prompt_done", async () => {
    const { controller, client, events } = setup();
    await controller.ensureSession("C:\\work\\orb");
    await controller.prompt("first");
    await controller.prompt("queued");
    const deliver = client.delivered[0]!;
    deliver(assistantMessageEnd([{ type: "text", text: "first response" }]));
    deliver(agentEnd());
    deliver({ type: "auto_compaction_start" });
    deliver({ type: "agent_start" });
    deliver(assistantMessageEnd([{ type: "text", text: "follow-up response" }]));
    deliver(agentEnd());
    deliver({ type: "agent_settled" });
    expect(controller.running).toBe(true);
    expect(client.prompt).toHaveBeenCalledTimes(1);
    expect(events.filter(event => event.type === "idle")).toHaveLength(0);
    deliver(promptDone());
    await expect.poll(() => client.prompt.mock.calls.length).toBe(2);
    // An event buffered on the previous stream cannot complete the queued prompt.
    deliver(promptDone());
    expect(controller.running).toBe(true);
    client.delivered[1]!(promptDone());
    expect(controller.running).toBe(false);
  });

  it("completes extension-only runs on agent_settled and reports asynchronous prompt errors", async () => {
    const { controller, client, events } = setup();
    await controller.ensureSession("C:\\work\\orb");
    await controller.prompt("start");
    const deliver = client.delivered[0]!;
    deliver({ type: "prompt_error", errorMessage: "provider unavailable" });
    expect(events).toContainEqual({ type: "error", message: "provider unavailable" });
    expect(controller.running).toBe(true);
    deliver(promptDone());
    deliver({ type: "agent_start" });
    expect(controller.running).toBe(true);
    deliver(textDelta("extension reply"));
    deliver(agentEnd());
    expect(controller.running).toBe(true);
    deliver({ type: "agent_settled" });
    expect(controller.running).toBe(false);
    expect(events).toContainEqual({ type: "assistant-message", text: "extension reply" });
  });

  it("ignores buffered completion and agent starts after Stop", async () => {
    const { controller, client } = setup();
    await controller.ensureSession("C:\\work\\orb");
    await controller.prompt("old");
    const old = client.delivered[0]!;
    await controller.abort();
    old({ type: "agent_start" });
    expect(controller.running).toBe(false);
    await controller.prompt("new");
    old(promptDone());
    expect(controller.running).toBe(true);
    client.delivered[1]!(promptDone());
    expect(controller.running).toBe(false);
  });

  it("projects batch progress and measures new responses without counting same-response tool gaps", async () => {
    const { controller, client, events, logs } = setup();
    await controller.ensureSession("C:\\orb");
    await controller.prompt("batch");
    const deliver = client.delivered[0]!;
    deliver(assistantMessageStart());
    deliver({ type: "tool_execution_start", toolName: "orb_batch", toolCallId: "one", args: {} });
    deliver({ type: "tool_execution_update", toolName: "orb_batch", toolCallId: "one", partialResult: { content: [{ type: "text", text: "执行第 2/3 步" }] } });
    expect(events.at(-1)).toMatchObject({ type: "tool", phase: "update", detail: "执行第 2/3 步" });
    deliver({ type: "tool_execution_end", toolName: "orb_batch", toolCallId: "one", result: { details: { timing: { requestId: "request-1", extensionReturnedAt: 123 } } } });
    expect(events.at(-1)).toMatchObject({ requestId: "request-1", extensionReturnedAt: 123 });
    deliver({ type: "tool_execution_start", toolName: "orb_wait", toolCallId: "two", args: {} });
    expect(logs.filter(l => l.event === "model-response-interval")).toHaveLength(1);
    deliver({ type: "tool_execution_end", toolName: "orb_wait", toolCallId: "two" });
    deliver(assistantMessageStart());
    deliver(textDelta("done"));
    expect(logs.filter(l => l.event === "model-response-interval")).toHaveLength(2);
  });
  it("shares concurrent creation so startup and a prompt cannot bind different sessions", async () => {
    const { client, controller, events } = setup();
    const ids = await Promise.all([controller.ensureSession("C:\\orb"), controller.ensureSession("C:\\orb")]);
    expect(ids).toEqual(["session-1", "session-1"]);
    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.type === "session")).toHaveLength(1);
  });

  it("rejects creation from an old generation without replacing the new session", async () => {
    const { client, controller } = setup();
    let finish!: (id: string) => void;
    client.createSession.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const pending = controller.ensureSession("C:\\orb");
    const rejected = expect(pending).rejects.toThrow("superseded");
    controller.beginGeneration(2);
    const current = await controller.ensureSession("C:\\next");
    finish("obsolete-session");
    await rejected;
    expect(controller.sessionId).toBe(current);
    expect(controller.generation).toBe(2);
  });

  it("can create after a failed startup request", async () => {
    const { client, controller } = setup();
    client.createSession.mockRejectedValueOnce(new Error("service unavailable"));
    await expect(controller.ensureSession("C:\\orb")).rejects.toThrow("service unavailable");
    await expect(controller.ensureSession("C:\\orb")).resolves.toBe("session-1");
  });
  it("creates a session for a workspace and reuses it for the same workspace", async () => {
    const { client, controller } = setup();
    const first = await controller.ensureSession("C:\\work\\orb-a");
    const second = await controller.ensureSession("C:\\work\\orb-a");
    expect(second).toBe(first);
    expect(client.createSession).toHaveBeenCalledTimes(1);
  });

  it("starts a new session when the workspace changes, so two workspaces never share one session", async () => {
    const { client, controller } = setup();
    const a = await controller.ensureSession("C:\\work\\orb-a");
    const b = await controller.ensureSession("C:\\work\\orb-b");
    expect(b).not.toBe(a);
    expect(client.createSession).toHaveBeenCalledTimes(2);
    // pi-web fixes cwd at creation time, so reusing a session would run the new
    // workspace against the old directory.
    expect(client.createSession).toHaveBeenLastCalledWith("C:\\work\\orb-b");
  });

  it("starts a fresh conversation in the same workspace and closes the old stream", async () => {
    const { client, controller } = setup();
    const first = await controller.ensureSession("C:\\work\\orb");
    await controller.prompt("hello");
    client.delivered[0]!(promptDone());
    const second = await controller.newConversation("C:\\work\\orb");
    expect(second).not.toBe(first);
    expect(client.createSession).toHaveBeenCalledTimes(2);
    expect(client.closed).toBeGreaterThan(0);
  });

  it("does not replace a conversation while a turn is running", async () => {
    const { controller } = setup();
    await controller.ensureSession("C:\\work\\orb");
    await controller.prompt("hello");
    await expect(controller.newConversation("C:\\work\\orb")).rejects.toThrow(/running/i);
  });

  it("attaches an existing session without changing its workspace", async () => {
    const { controller, events } = setup();
    await controller.ensureSession("C:\\work\\orb");
    const opened = await controller.openExistingSession("C:\\work\\orb", "persisted-session");
    expect(opened).toBe("persisted-session");
    expect(controller.sessionId).toBe("persisted-session");
    expect(controller.workspace).toBe("C:\\work\\orb");
    expect(events.at(-1)).toEqual({ type: "session", sessionId: "persisted-session", generation: 1 });
  });

  it("refuses a prompt before any workspace session exists", async () => {
    const { controller } = setup();
    await expect(controller.prompt("hello")).rejects.toThrow(/workspace/i);
  });

  it("ignores an empty or whitespace-only prompt", async () => {
    const { client, controller } = setup();
    await controller.ensureSession("C:\\work\\orb");
    await controller.prompt("   ");
    expect(client.prompt).not.toHaveBeenCalled();
  });

  it("subscribes to the event stream before sending the prompt", async () => {
    const { client, controller } = setup();
    await controller.ensureSession("C:\\work\\orb");
    const order: string[] = [];
    client.openEventStream.mockImplementation(async () => {
      order.push("subscribe");
      return () => {};
    });
    client.prompt.mockImplementation(async () => {
      order.push("prompt");
    });
    await controller.prompt("hello");
    // Subscribing afterwards misses the whole first turn (measured in P0-03).
    expect(order).toEqual(["subscribe", "prompt"]);
  });

  it("queues follow-up prompts in the same Pi session and advances one turn at a time", async () => {
    const { client, controller, events } = setup();
    await controller.ensureSession("C:\\work\\orb");
    await controller.prompt("first");
    await controller.prompt("second");
    await controller.prompt("third");

    expect(controller.running).toBe(true);
    expect(client.prompt).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ type: "queued", count: 1 });
    expect(events).toContainEqual({ type: "queued", count: 2 });

    client.delivered[0]!(promptDone());
    await expect.poll(() => client.prompt.mock.calls.length).toBe(2);
    expect(client.prompt.mock.calls[1]).toEqual(["session-1", "second", undefined, "C:\\work\\orb"]);
    client.delivered[1]!(promptDone());
    await expect.poll(() => client.prompt.mock.calls.length).toBe(3);
    expect(client.prompt.mock.calls[2]).toEqual(["session-1", "third", undefined, "C:\\work\\orb"]);
    expect(events.filter((event) => event.type === "idle")).toHaveLength(0);

    client.delivered[2]!(promptDone());
    expect(controller.running).toBe(false);
    expect(events.filter((event) => event.type === "idle")).toHaveLength(1);
  });

  it("reports streaming text and the completed assistant message", async () => {
    const { controller, events, client } = setup();
    await controller.ensureSession("C:\\work\\orb");
    await controller.prompt("hi");
    const deliver = client.delivered[0]!;

    deliver(assistantMessageStart());
    deliver(userMessageEnd("hi"));
    deliver(textDelta("par"));
    deliver(textDelta("tial"));
    deliver(assistantMessageEnd());
    deliver(agentEnd());
    deliver(promptDone());

    const deltas = events.filter((event) => event.type === "assistant-delta");
    expect(deltas.map((event) => (event as { text: string }).text)).toEqual(["par", "tial"]);
    const completed = events.filter((event) => event.type === "assistant-message");
    // Exactly one completion: the first message_end of a turn is the user message
    // and must not be mistaken for the reply.
    expect(completed).toHaveLength(1);
    expect((completed[0] as { text: string }).text).toBe("partial");
    expect(events.at(-1)).toEqual({ type: "idle", stopReason: "stop" });
  });

  it("forwards tool progress without exposing image or secret payloads", async () => {
    const { controller, events, client } = setup();
    await controller.ensureSession("C:\\work\\orb");
    await controller.prompt("inspect");
    const deliver = client.delivered[0]!;
    deliver({ type: "tool_execution_start", toolCallId: "call-1", toolName: "orb_observe", args: { target: "Editor", imageData: "secret pixels", password: "hidden" } });
    deliver({ type: "tool_execution_end", toolCallId: "call-1", toolName: "orb_observe", isError: false });
    const tools = events.filter((event) => event.type === "tool");
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({ phase: "start", id: "call-1", name: "orb_observe" });
    expect(JSON.stringify(tools)).not.toContain("secret pixels");
    expect(JSON.stringify(tools)).not.toContain("hidden");
    expect(tools[1]).toMatchObject({ phase: "end", detail: "Completed", isError: false });
  });

  it("answers only the active Pi extension question and closes it once", async () => {
    const { controller, events, client } = setup();
    await controller.ensureSession("C:\\work\\orb");
    await controller.prompt("choose");
    client.delivered[0]!({ type: "extension_ui_request", id: "question-1", method: "select", title: "Choose a route", options: ["A", "B"] });
    expect(controller.pendingQuestionId).toBe("question-1");
    expect(events.at(-1)).toMatchObject({ type: "question", id: "question-1", method: "select", options: ["A", "B"] });
    await expect(controller.respondToQuestion({ id: "other", value: "A" })).rejects.toThrow("no longer active");
    await controller.respondToQuestion({ id: "question-1", value: "A" });
    expect(client.respondToExtensionUi).toHaveBeenCalledWith("session-1", { id: "question-1", value: "A" });
    expect(controller.pendingQuestionId).toBeNull();
    await expect(controller.respondToQuestion({ id: "question-1", value: "B" })).rejects.toThrow("no longer active");
    expect(events.at(-1)).toEqual({ type: "question-closed", id: "question-1" });
  });

  it("ignores the system-message projection and unrelated event types", async () => {
    const { controller, events, client } = setup();
    await controller.ensureSession("C:\\work\\orb");
    await controller.prompt("hi");
    const deliver = client.delivered[0]!;
    deliver(systemMessageEnd());
    deliver({ type: "tool_execution_update", toolName: "read" });
    deliver({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "hmm" } });
    deliver({ type: "message_update", assistantMessageEvent: { type: "text_end", contentIndex: 0 } });
    deliver({ type: "agent_end" });
    expect(events.filter((event) => event.type === "assistant-delta")).toHaveLength(0);
    expect(events.filter((event) => event.type === "assistant-message")).toHaveLength(0);
  });

  it("reports a failed model call carried inside the update envelope", async () => {
    const { controller, events, client } = setup();
    await controller.ensureSession("C:\\work\\orb");
    await controller.prompt("hi");
    client.delivered[0]!(assistantError("model unavailable"));
    expect(events).toContainEqual({ type: "error", message: "model unavailable" });
  });

  it("does not emit an empty completed message", async () => {
    const { controller, events, client } = setup();
    await controller.ensureSession("C:\\work\\orb");
    await controller.prompt("hi");
    client.delivered[0]!(assistantMessageEnd(""));
    expect(events.filter((event) => event.type === "assistant-message")).toHaveLength(0);
  });

  it("surfaces a stream error", async () => {
    const { controller, events, client } = setup();
    await controller.ensureSession("C:\\work\\orb");
    await controller.prompt("hi");
    client.delivered[0]!(streamError("provider exploded"));
    expect(events).toContainEqual({ type: "error", message: "provider exploded" });
  });

  it("falls back to the final message content when no deltas arrived", async () => {
    const { controller, events, client } = setup();
    await controller.ensureSession("C:\\work\\orb");
    await controller.prompt("hi");
    client.delivered[0]!(assistantMessageEnd([{ type: "text", text: "whole reply" }]));
    expect(events).toContainEqual({ type: "assistant-message", text: "whole reply" });
  });

  it("releases the previous stream when the workspace changes", async () => {
    const { controller, client } = setup();
    await controller.ensureSession("C:\\work\\orb-a");
    await controller.prompt("hi");
    await controller.ensureSession("C:\\work\\orb-b");
    expect(client.closed).toBeGreaterThan(0);
  });

  it("drops the session and stream on a new generation", async () => {
    const { controller, client } = setup();
    await controller.ensureSession("C:\\work\\orb");
    // Subscribe first: only a running turn owns a stream to release.
    await controller.prompt("hi");
    controller.beginGeneration(2);
    expect(controller.sessionId).toBeNull();
    expect(controller.workspace).toBeNull();
    await expect(controller.prompt("hi")).rejects.toThrow(/workspace/i);
    expect(client.closed).toBeGreaterThan(0);
  });

  it("reports a prompt failure and releases the queue when Pi Web rejects it", async () => {
    const { controller, client, events } = setup();
    await controller.ensureSession("C:\\work\\orb");
    client.prompt.mockRejectedValueOnce(new Error("HTTP 500"));
    await controller.prompt("hi");
    expect(controller.running).toBe(false);
    expect(events).toContainEqual({ type: "error", message: "HTTP 500" });
    expect(events.at(-1)).toEqual({ type: "idle", stopReason: null });
  });

  it("only aborts a session that exists", async () => {
    const { controller, client } = setup();
    await controller.abort();
    expect(client.abort).not.toHaveBeenCalled();
    await controller.ensureSession("C:\\work\\orb");
    await controller.abort();
    expect(client.abort).toHaveBeenCalledTimes(1);
  });
});
