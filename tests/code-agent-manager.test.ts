import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiWebClient } from "../src/main/pi-web-client";
import { CodeAgentManager } from "../src/main/code-agent-manager";
import { BACKGROUND_ROLE, COMPLETION_BODY_MAX_CHARS, completionNoticeText } from "../src/shared/code-agent";

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

function fixture() {
  const workspace = mkdtempSync(join(tmpdir(), "orb-code-agent-"));
  directories.push(workspace);
  const events = new Map<string, (event: unknown) => void>();
  const running = new Map<string, boolean>();
  const order: string[] = [];
  let number = 0;
  let foregroundIdle = false;
  const delivered: string[] = [];
  const client = {
    getState: vi.fn(async (id: string) => ({ provider: "fixture", modelId: "model", thinkingLevel: "off", running: running.get(id) ?? false })),
    createSession: vi.fn(async () => `worker-${++number}`),
    setSessionName: vi.fn(async () => {}),
    openEventStream: vi.fn(async (id: string, callback: (event: unknown) => void) => { order.push(`subscribe:${id}`); events.set(id, callback); return () => { order.push(`close:${id}`); events.delete(id); }; }),
    queuePrompt: vi.fn(async (id: string) => { order.push(`prompt:${id}`); running.set(id, true); }),
    lastAssistantOutcome: vi.fn(async (): Promise<{ text: string; error: string | null }> => ({ text: "Produced artifact.txt", error: null })),
    clearQueue: vi.fn(async () => {}),
    abort: vi.fn(async (id: string) => { running.set(id, false); }),
  };
  const registryPath = join(workspace, "registry.json");
  const options = { client: client as unknown as PiWebClient, registryPath, deliver: async (_owner: string, text: string) => { if (!foregroundIdle) return false; delivered.push(text); foregroundIdle = false; return true; } };
  const manager = new CodeAgentManager(options);
  return { manager, options, client, workspace, registryPath, events, running, order, delivered, idle: () => { foregroundIdle = true; }, complete: async (id: string) => { running.set(id, false); events.get(id)?.({ type: "agent_settled" }); await vi.waitFor(async () => expect((await manager.status("owner") as { tasks: { status: string }[] }).tasks.find(task => task.status === "running")).toBeUndefined()); } };
}

describe("reference Code agent sessions through Pi Web", () => {
  it("accepts a first-class session without waiting for completion and subscribes before prompting", async () => {
    const f = fixture();
    expect(await f.manager.dispatch("owner", f.workspace, "full-access", { task: "Build a document" })).toEqual({ accepted: true, created: true, session_id: "worker-1" });
    expect(f.client.createSession).toHaveBeenCalledWith(f.workspace + "\\build-a-document", expect.objectContaining({
      toolNames: ["read", "grep", "find", "ls", "write", "edit", "bash"],
    }));
    expect(f.order).toEqual(["subscribe:worker-1", "prompt:worker-1"]);
    expect(f.client.queuePrompt).toHaveBeenCalledWith("worker-1", expect.stringContaining(BACKGROUND_ROLE));
    expect(await f.manager.status("owner")).toMatchObject({ count: 1, tasks: [{ status: "running" }] });
    expect(await f.manager.status("another-owner")).toEqual({ count: 0, tasks: [] });
    await expect(f.manager.dispatch("another-owner", f.workspace, "full-access", { task: "Steal session", session_id: "worker-1" })).rejects.toThrow("only a background session");
    f.manager.dispose();
  });

  it("parks completion while the foreground is busy and delivers once after idle", async () => {
    const f = fixture();
    await f.manager.dispatch("owner", f.workspace, "full-access", { task: "Build a document" });
    await f.complete("worker-1");
    expect(f.delivered).toEqual([]);
    expect(JSON.parse(readFileSync(f.registryPath, "utf8"))[0].pending).toBe(true);
    f.idle();
    await Promise.all([f.manager.deliverPending("owner"), f.manager.deliverPending("owner")]);
    expect(f.delivered).toHaveLength(1);
    expect(f.delivered[0]).toContain("Produced artifact.txt");
    f.idle();
    await f.manager.deliverPending("owner");
    expect(f.delivered).toHaveLength(1);
    f.manager.dispose();
  });

  it("coalesces duplicate settled events into one outcome and notice", async () => {
    const f = fixture();
    await f.manager.dispatch("owner", f.workspace, "full-access", { task: "Build a document" });
    f.running.set("worker-1", false);
    const settled = f.events.get("worker-1")!;
    settled({ type: "agent_settled" });
    settled({ type: "agent_settled" });
    await vi.waitFor(async () => expect((await f.manager.status("owner") as { tasks: { status: string }[] }).tasks).toEqual([{ session_id: "worker-1", task: "Build a document", cwd: expect.any(String), status: "idle" }]));
    f.idle();
    await f.manager.deliverPending("owner");
    expect(f.client.lastAssistantOutcome).toHaveBeenCalledTimes(1);
    expect(f.delivered).toHaveLength(1);
    f.manager.dispose();
  });

  it("records provider failures and delivers one failure notice after the owner is idle", async () => {
    const f = fixture();
    await f.manager.dispatch("owner", f.workspace, "full-access", { task: "Build a document" });
    f.events.get("worker-1")?.({ type: "prompt_error", errorMessage: "provider rejected prompt" });

    await vi.waitFor(async () => expect(await f.manager.status("owner")).toMatchObject({
      count: 1,
      tasks: [{ session_id: "worker-1", status: "error" }],
    }));
    expect(JSON.parse(readFileSync(f.registryPath, "utf8"))[0]).toMatchObject({
      status: "error",
      pending: true,
      outcome: "provider rejected prompt",
    });
    expect(f.delivered).toEqual([]);

    f.idle();
    await f.manager.deliverPending("owner");
    expect(f.delivered).toHaveLength(1);
    expect(f.delivered[0]).toContain("failed this task");
    f.idle();
    await f.manager.deliverPending("owner");
    expect(f.delivered).toHaveLength(1);
    f.manager.dispose();
  });

  it("continues the owned artifact session and creates a separate session for unrelated work", async () => {
    const f = fixture();
    await f.manager.dispatch("owner", f.workspace, "full-access", { task: "Build a document" });
    await f.complete("worker-1");
    expect(await f.manager.dispatch("owner", f.workspace, "full-access", { task: "Change its font", session_id: "worker-1" })).toMatchObject({ created: false, session_id: "worker-1" });
    expect(f.client.createSession).toHaveBeenCalledTimes(1);
    expect(await f.manager.dispatch("owner", f.workspace, "full-access", { task: "Build a document" })).toMatchObject({ created: true, session_id: "worker-2" });
    const stored = JSON.parse(readFileSync(f.registryPath, "utf8"));
    expect(stored[0].cwd).not.toBe(stored[1].cwd);
    f.manager.dispose();
  });

  it("reports a final provider error at settled even without a prompt_error event", async () => {
    const f = fixture();
    await f.manager.dispatch("owner", f.workspace, "full-access", { task: "Build a document" });
    f.client.lastAssistantOutcome.mockResolvedValue({ text: "", error: "400 invalid model" });
    await f.complete("worker-1");
    expect(JSON.parse(readFileSync(f.registryPath, "utf8"))[0]).toMatchObject({ status: "error", pending: true, outcome: "400 invalid model" });
    expect(f.delivered).toEqual([]);
    f.idle();
    await f.manager.deliverPending("owner");
    expect(f.delivered).toHaveLength(1);
    expect(f.delivered[0]).toContain("failed this task");
    f.idle();
    await f.manager.deliverPending("owner");
    expect(f.delivered).toHaveLength(1);
    f.manager.dispose();
  });

  it("stops queued work and its notice, rejects another owner's stop and preserves continuation", async () => {
    const f = fixture();
    await f.manager.dispatch("owner", f.workspace, "full-access", { task: "Build a document" });
    const staleEvent = f.events.get("worker-1")!;
    await expect(f.manager.stop("other", "worker-1")).rejects.toThrow("only a background session");
    expect(await f.manager.stop("owner", "worker-1")).toEqual({ accepted: true, session_id: "worker-1" });
    expect(f.client.clearQueue).toHaveBeenCalledWith("worker-1");
    expect(f.client.abort).toHaveBeenCalledWith("worker-1");
    staleEvent({ type: "agent_settled" });
    f.idle();
    await f.manager.deliverPending("owner");
    expect(f.delivered).toEqual([]);
    await f.manager.dispatch("owner", f.workspace, "full-access", { task: "Continue", session_id: "worker-1" });
    expect(f.client.createSession).toHaveBeenCalledTimes(1);
    f.manager.dispose();
  });

  it("restores ownership and completion after the helper restarts", async () => {
    const f = fixture();
    await f.manager.dispatch("owner", f.workspace, "full-access", { task: "Build a document" });
    f.manager.dispose();
    f.running.set("worker-1", false);
    const restored = new CodeAgentManager(f.options);
    await restored.restore();
    expect(await restored.status("owner")).toMatchObject({ count: 1, tasks: [{ status: "idle" }] });
    f.idle();
    await restored.deliverPending("owner");
    expect(f.delivered).toHaveLength(1);
    restored.dispose();
  });

  it("honors cancellation before creating a worker and bounds completion text", async () => {
    const f = fixture();
    await expect(f.manager.dispatch("owner", f.workspace, "full-access", { task: "Build a document" }, AbortSignal.abort())).rejects.toThrow();
    expect(f.client.createSession).not.toHaveBeenCalled();
    expect(completionNoticeText({ owner: "o", session_id: "s", task: "t", cwd: "x", status: "idle", pending: true, outcome: "x".repeat(9000), tools: [] })).toHaveLength(COMPLETION_BODY_MAX_CHARS);
    f.manager.dispose();
  });
});
