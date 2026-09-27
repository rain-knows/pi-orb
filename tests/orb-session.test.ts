import { describe, expect, it, vi } from "vitest";
import { OrbSessionController } from "../src/main/orb-session";
import type { PiWebClient } from "../src/main/pi-web-client";
import type { OrbSessionEvent } from "@shared/ipc";
import {
  agentEnd,
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
  openEventStream: ReturnType<typeof vi.fn>;
  delivered: ((event: unknown) => void)[];
  closed: number;
}

function fakeClient(): FakeClient {
  const state: FakeClient = {
    createSession: vi.fn(),
    prompt: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
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
  const controller = new OrbSessionController({
    client: client as unknown as PiWebClient,
    emit: (event) => events.push(event),
  });
  controller.beginGeneration(1);
  return { client, controller, events };
}

describe("OrbSessionController", () => {
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

    const deltas = events.filter((event) => event.type === "assistant-delta");
    expect(deltas.map((event) => (event as { text: string }).text)).toEqual(["par", "tial"]);
    const completed = events.filter((event) => event.type === "assistant-message");
    // Exactly one completion: the first message_end of a turn is the user message
    // and must not be mistaken for the reply.
    expect(completed).toHaveLength(1);
    expect((completed[0] as { text: string }).text).toBe("partial");
    expect(events.at(-1)).toEqual({ type: "idle", stopReason: "stop" });
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

  it("propagates a prompt failure so the caller can report it", async () => {
    const { controller, client } = setup();
    await controller.ensureSession("C:\\work\\orb");
    client.prompt.mockRejectedValueOnce(new Error("HTTP 500"));
    await expect(controller.prompt("hi")).rejects.toThrow("HTTP 500");
    expect(controller.running).toBe(false);
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
