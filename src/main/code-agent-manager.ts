/** Reference code-agent.ts / code-agent-completion.ts @9cdc503, MIT.
 * First-class background sessions stay in Pi Web. Pi owns execution and history;
 * this adapter owns delegation, SSE completion notices and cancellation.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { PiWebClient } from "./pi-web-client";
import { completionNoticeText, queuedTaskText, slugFromTask, uniqueDirectory, type CodeAgentTask } from "../shared/code-agent";
import type { OrbAccessLevel } from "../shared/ipc";

interface CodeAgentManagerOptions {
  client: PiWebClient;
  registryPath: string;
  deliver: (owner: string, text: string) => Promise<boolean>;
  log?: (error: unknown) => void;
}

export class CodeAgentManager {
  readonly #options: CodeAgentManagerOptions;
  readonly #tasks = new Map<string, CodeAgentTask>();
  readonly #streams = new Map<string, () => void>();
  readonly #epochs = new Map<string, number>();
  readonly #delivering = new Set<string>();
  readonly #completing = new Set<string>();
  readonly #dispatching = new Set<string>();
  #disposed = false;

  constructor(options: CodeAgentManagerOptions) {
    this.#options = options;
    let raw: string;
    try { raw = readFileSync(options.registryPath, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    const tasks: unknown = JSON.parse(raw);
    if (!Array.isArray(tasks) || tasks.some(task => !task || typeof task.owner !== "string" || typeof task.session_id !== "string" || typeof task.cwd !== "string" || typeof task.task !== "string" || !["running", "idle", "error"].includes(task.status) || typeof task.pending !== "boolean" || typeof task.outcome !== "string" || !Array.isArray(task.tools) || task.tools.some((name: unknown) => typeof name !== "string"))) throw new Error("Invalid Code agent session registry.");
    for (const task of tasks as CodeAgentTask[]) this.#tasks.set(task.session_id, task);
  }

  async restore(): Promise<void> {
    for (const task of this.#tasks.values()) if (task.status === "running") {
      try {
        await this.#subscribe(task);
        if (!(await this.#options.client.getState(task.session_id)).running) await this.#complete(task.session_id, this.#epochs.get(task.session_id)!);
      } catch (error) { this.#fail(task, error); }
    }
  }

  async dispatch(owner: string, workspace: string, level: OrbAccessLevel, value: unknown, signal?: AbortSignal): Promise<unknown> {
    const args = value as { task?: unknown; session_id?: unknown; cwd?: unknown } | null;
    if (!args || typeof args.task !== "string" || !args.task.trim() || (args.session_id !== undefined && (typeof args.session_id !== "string" || !args.session_id.trim())) || (args.cwd !== undefined && (typeof args.cwd !== "string" || !isAbsolute(args.cwd)))) throw new Error("code_agent requires task, an optional owned session_id, and an optional absolute cwd.");
    if (this.#disposed) throw new Error("The Code agent manager is closed.");
    signal?.throwIfAborted();
    if (this.#dispatching.has(owner)) throw new Error("Another Code agent dispatch is being accepted.");
    this.#dispatching.add(owner);
    let task: CodeAgentTask | undefined;
    let created = false;
    try {
      if (args.session_id !== undefined) {
        task = this.#owned(owner, args.session_id as string);
        if (args.cwd !== undefined && resolve(args.cwd as string).toLowerCase() !== resolve(task.cwd).toLowerCase()) throw new Error("code_agent cwd does not match the continued session cwd.");
      } else {
        const cwd = args.cwd === undefined ? uniqueDirectory(workspace, slugFromTask(args.task)) : resolve(args.cwd as string);
        mkdirSync(cwd, { recursive: true });
        const model = await this.#options.client.getState(owner);
        signal?.throwIfAborted();
        // Pi Web session overrides accept only its built-in tool names. The Orb host may expose
        // extension tools such as web_search, but naming them here would make /api/agent/new
        // reject the worker. The extension activates installed web tools before the worker turn.
        const toolNames = ["read", "grep", "find", "ls"];
        if (level !== "read-only") toolNames.push("write", "edit");
        if (level === "full-access") toolNames.push("bash");
        const session_id = await this.#options.client.createSession(cwd, {
          toolNames,
          ...(model.provider && model.modelId ? { provider: model.provider, modelId: model.modelId } : {}),
          ...(model.thinkingLevel ? { thinkingLevel: model.thinkingLevel } : {}),
        });
        task = { owner, session_id, task: args.task.trim(), cwd, status: "idle", pending: false, outcome: "", tools: toolNames };
        this.#tasks.set(session_id, task);
        this.#save();
        created = true;
        signal?.throwIfAborted();
        await this.#options.client.setSessionName(session_id, `Code agent: ${task.task.slice(0, 80)}`);
      }
      task.task = args.task.trim();
      task.status = "running";
      task.pending = false;
      task.outcome = "";
      this.#save();
      if (!this.#streams.has(task.session_id)) await this.#subscribe(task);
      signal?.throwIfAborted();
      await this.#options.client.queuePrompt(task.session_id, queuedTaskText(task.task));
      this.#dispatching.delete(owner);
      if (!(await this.#options.client.getState(task.session_id)).running) await this.#complete(task.session_id, this.#epochs.get(task.session_id)!);
      return { accepted: true, created, session_id: task.session_id };
    } catch (error) {
      if (task) this.#fail(task, error);
      throw error;
    } finally { this.#dispatching.delete(owner); }
  }

  async status(owner: string): Promise<unknown> {
    const tasks = [];
    for (const task of this.#tasks.values()) if (task.owner === owner) {
      if (task.status === "running" && !this.#dispatching.has(owner)) {
        try {
          if (!(await this.#options.client.getState(task.session_id)).running) await this.#complete(task.session_id, this.#epochs.get(task.session_id) ?? 0);
        } catch (error) { this.#fail(task, error); }
      }
      tasks.push({ session_id: task.session_id, task: task.task, cwd: task.cwd, status: task.status });
    }
    return { count: tasks.length, tasks };
  }

  async stop(owner: string, sessionId: string): Promise<unknown> {
    const task = this.#owned(owner, sessionId);
    this.#epochs.set(sessionId, (this.#epochs.get(sessionId) ?? 0) + 1);
    this.#streams.get(sessionId)?.();
    this.#streams.delete(sessionId);
    task.pending = false;
    task.status = "idle";
    this.#save();
    await this.#options.client.clearQueue(sessionId);
    await this.#options.client.abort(sessionId);
    return { accepted: true, session_id: sessionId };
  }

  async deliverPending(owner: string): Promise<void> {
    if (this.#disposed || this.#delivering.has(owner)) return;
    this.#delivering.add(owner);
    try {
      for (const task of this.#tasks.values()) if (task.owner === owner && task.pending) {
        if (!await this.#options.deliver(owner, completionNoticeText(task))) break;
        task.pending = false;
        this.#save();
      }
    } catch (error) { this.#options.log?.(error); }
    finally { this.#delivering.delete(owner); }
  }

  dispose(): void {
    this.#disposed = true;
    for (const close of this.#streams.values()) close();
    this.#streams.clear();
  }

  #owned(owner: string, sessionId: string): CodeAgentTask {
    const task = this.#tasks.get(sessionId);
    if (!task || task.owner !== owner || sessionId === owner) throw new Error("code_agent can target only a background session this Computer Use chat started.");
    return task;
  }

  async #subscribe(task: CodeAgentTask): Promise<void> {
    const epoch = (this.#epochs.get(task.session_id) ?? 0) + 1;
    this.#epochs.set(task.session_id, epoch);
    const close = await this.#options.client.openEventStream(task.session_id, value => {
      const event = value as { type?: string; errorMessage?: string };
      if (this.#epochs.get(task.session_id) !== epoch || this.#disposed) return;
      if (event.type === "agent_settled") void this.#complete(task.session_id, epoch).catch(error => this.#fail(task, error));
      if (event.type === "prompt_error") this.#fail(task, new Error(event.errorMessage ?? "Background prompt failed."));
    }, error => { if (this.#epochs.get(task.session_id) === epoch && !this.#disposed) this.#fail(task, error); });
    if (this.#disposed || this.#epochs.get(task.session_id) !== epoch) close();
    else this.#streams.set(task.session_id, close);
  }

  async #complete(sessionId: string, epoch: number): Promise<void> {
    const task = this.#tasks.get(sessionId);
    if (!task || task.status !== "running" || this.#disposed || this.#epochs.get(sessionId) !== epoch || this.#dispatching.has(task.owner) || this.#completing.has(sessionId)) return;
    this.#completing.add(sessionId);
    try {
      const outcome = await this.#options.client.lastAssistantOutcome(sessionId);
      if (this.#epochs.get(sessionId) !== epoch || task.status !== "running" || this.#disposed) return;
      task.status = outcome.error === null ? "idle" : "error";
      task.outcome = outcome.error ?? outcome.text;
      task.pending = true;
      this.#save();
      await this.deliverPending(task.owner);
    } finally {
      this.#completing.delete(sessionId);
    }
  }

  #fail(task: CodeAgentTask, error: unknown): void {
    if (this.#disposed || task.status === "error") return;
    task.status = "error";
    task.outcome = error instanceof Error ? error.message : String(error);
    task.pending = true;
    this.#save();
    this.#options.log?.(error);
    void this.deliverPending(task.owner);
  }

  #save(): void {
    mkdirSync(dirname(this.#options.registryPath), { recursive: true });
    const temporary = `${this.#options.registryPath}.tmp`;
    writeFileSync(temporary, JSON.stringify([...this.#tasks.values()]), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.#options.registryPath);
  }
}
