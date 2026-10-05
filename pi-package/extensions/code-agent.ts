/** Pi registration adapter for reference code-agent.ts @9cdc503 (MIT).
 * Sessions execute through Pi Web; no child agent engine or credentials live here.
 */
import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { codeAgentRegistryPath, type CodeAgentTask } from "../../src/shared/code-agent";
import { BridgeClient } from "./bridge-client";

export function backgroundSession(sessionId: string): CodeAgentTask | undefined {
  let raw: string;
  try { raw = readFileSync(codeAgentRegistryPath(), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  const tasks: CodeAgentTask[] = JSON.parse(raw);
  if (!Array.isArray(tasks)) throw new Error("Invalid Code agent registry.");
  return tasks.find(task => task.session_id === sessionId);
}

export function registerCodeAgentTools(pi: ExtensionAPI): void {
  async function call(command: "dispatch" | "status" | "stop", args: unknown, sessionId: string, signal?: AbortSignal) {
    const bridge = BridgeClient.fromEnvironment();
    const token = bridge?.readToken();
    if (!bridge || !token || token.orbSessionId !== sessionId) return { content: [{ type: "text" as const, text: "The calling Computer Use session is not connected to its Orb shell." }], details: { ok: false }, isError: true };
    const result = await bridge.call({ type: "code-agent", sessionId, generation: token.generation, command, arguments: args }, token, signal);
    const running = command === "dispatch" && result.ok ? "\nTell the user the background Code agent is running. Continue a GUI action only if it does not need the result; otherwise end the turn. Do not poll with wait or sleep. A completion notice arrives when both sessions are idle." : "";
    return { content: [{ type: "text" as const, text: JSON.stringify(result.ok ? result.result : result) + running }], details: { ok: result.ok }, isError: !result.ok };
  }
  pi.registerTool({
    name: "code_agent", label: "后台 Code agent", exposure: "model-only", executionMode: "sequential",
    description: "Delegate one stretch of file search or file production to a standard Pi Web session. Use GUI tools for visible actions and web search for quick lookups. Hand off sustained investigation or producing a file, document, spreadsheet or site. Omit session_id for unrelated new work; pass an earlier returned session_id to continue the same artifact. Pass cwd only when the user names a path or an observed current folder is known. Returns immediately after acceptance. Completion returns later to this Computer Use chat. Never poll using wait, long_wait or sleep.",
    parameters: Type.Object({ task: Type.String({ minLength: 1 }), session_id: Type.Optional(Type.String({ minLength: 1 })), cwd: Type.Optional(Type.String({ minLength: 1 })) }, { additionalProperties: false }),
    execute: (_id, args, signal, _update, ctx) => call("dispatch", args, ctx.sessionManager.getSessionId(), signal),
  });
  pi.registerTool({
    name: "code_agent_status", label: "后台任务状态", exposure: "model-only", executionMode: "sequential",
    description: "List background Code agent sessions this Computer Use chat started. Returns count, task, cwd and status. Finished and stopped sessions remain available to continue. Does not include another chat's sessions.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: (_id, args, signal, _update, ctx) => call("status", args, ctx.sessionManager.getSessionId(), signal),
  });
  pi.registerTool({
    name: "code_agent_stop", label: "停止后台任务", exposure: "model-only", executionMode: "sequential",
    description: "Stop a background Code agent this Computer Use chat started and drop queued follow-ups. Does not delete files. The same session_id can later continue the artifact.",
    parameters: Type.Object({ session_id: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    execute: (_id, args, signal, _update, ctx) => call("stop", args, ctx.sessionManager.getSessionId(), signal),
  });
}
