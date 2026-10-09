/** Adapted from mini-yifan/dsh-orb-cordis@aa79308e47265b7d4a774edb688de2bbd7dce66e, computer-use/src/code-agent.ts
 * and code-agent-completion.ts. Copyright (c) 2026 mini-yifan / DeepSeek, MIT.
 * Only Cordis/session-controller boundaries are replaced by Pi Web.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { resolveOrbConfigPath } from "./orb-config";

export const CODE_AGENT_TOOLS = ["code_agent", "code_agent_status", "code_agent_stop"] as const;
export const CODE_AGENT_REGISTRY = "code-agent-sessions.json";
export const COMPLETION_BODY_MAX_CHARS = 4000;
export const BACKGROUND_ROLE = "You are the background worker for a Computer Use session. You do not see the screen and you do not talk to the user. "
  + "If this task asks for a file, document, spreadsheet, or site, produce it, reply with its path, and stop. "
  + "Otherwise search or run commands only until you can answer, including a second search when the first missed the point. "
  + "Reply in a few sentences with the paths or results that matter, then stop. Do not write a report or create extra files.";

export interface CodeAgentTask {
  owner: string;
  session_id: string;
  task: string;
  cwd: string;
  status: "running" | "idle" | "error";
  pending: boolean;
  outcome: string;
  tools: string[];
  userStopped?: boolean;
}

/** Upstream process-lifetime bookmark surface; persistence remains Pi's responsibility. */
export interface CodeAgentBookmark {
  readonly sessionId: string;
  readonly callerId: string;
  readonly task: string;
  readonly cwd: string;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly state: "running" | "completed" | "stopped" | "ended";
  readonly outcome?: string;
  readonly colorIndex: number;
  readonly unread: boolean;
}

export function codeAgentRegistryPath(): string {
  return join(dirname(resolveOrbConfigPath()), CODE_AGENT_REGISTRY);
}

export function slugFromTask(task: string): string {
  const slug = task.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  return slug === "" ? "task" : slug;
}

export function uniqueDirectory(parent: string, slug: string): string {
  const base = join(parent, slug);
  if (!existsSync(base)) return base;
  for (let index = 2; index < 1000; index++) {
    const candidate = `${base}-${index}`;
    if (!existsSync(candidate)) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

export function queuedTaskText(task: string): string {
  return `${task}\n\n${BACKGROUND_ROLE}`;
}

export function completionNoticeText(task: CodeAgentTask, userStopped = false): string {
  const body = userStopped
    ? `The user stopped background Code agent session ${task.session_id} from the main window:\n${task.task}\n\nLast output before it stopped:\n${task.outcome}`
    : `Background Code agent session ${task.session_id} ${task.status === "error" ? "failed" : "finished"} this task:\n${task.task}\n\n${task.outcome || "The Code agent session ended without a final assistant message."}`;
  const capped = body.length <= COMPLETION_BODY_MAX_CHARS ? body : `${body.slice(0, COMPLETION_BODY_MAX_CHARS - 1)}…`;
  return capped + (userStopped ? "\n\nDo not restart this task and do not call code_agent for it again unless the user asks." : "");
}
