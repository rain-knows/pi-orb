import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const EXPECTED_ORB_CWD = process.env.PI_ORB_P0_ORB_CWD
  ? resolve(process.env.PI_ORB_P0_ORB_CWD)
  : undefined;
const LOG_PATH = process.env.PI_ORB_P0_LOG;
const TOOL_NAME = "orb_probe";
const COMMAND_NAME = "orb-probe";
const EMPTY_PARAMETERS = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

function isOrbCwd(cwd: string): boolean {
  if (!EXPECTED_ORB_CWD) return false;
  return resolve(cwd).toLowerCase() === EXPECTED_ORB_CWD.toLowerCase();
}

function log(event: Record<string, unknown>): void {
  if (!LOG_PATH) return;
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  appendFileSync(LOG_PATH, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, "utf8");
}

export default function p0OrbProbe(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    const orb = isOrbCwd(ctx.cwd);
    log({ event: "session_start", cwd: ctx.cwd, orb, mode: ctx.mode });
    if (!orb) return;

    pi.registerTool({
      name: TOOL_NAME,
      label: "P0 Orb probe",
      description: "P0 read-only probe; never performs desktop input.",
      promptSnippet: "P0 Orb read-only probe",
      promptGuidelines: ["Use only for the P0 read-only integration probe."],
      parameters: EMPTY_PARAMETERS,
      async execute() {
        return {
          content: [{ type: "text", text: "p0-orb-probe" }],
          details: { readOnly: true },
        };
      },
    });
    pi.setActiveTools([...new Set([...pi.getActiveTools(), TOOL_NAME])]);
    pi.registerCommand(COMMAND_NAME, {
      description: "P0 read-only Orb probe",
      handler: async (_args, commandCtx) => {
        log({ event: "command", command: COMMAND_NAME, cwd: commandCtx.cwd, orb: isOrbCwd(commandCtx.cwd) });
        commandCtx.ui.notify("P0 Orb probe", "info");
      },
    });
  });

  pi.on("before_agent_start", (event, ctx) => {
    const orb = isOrbCwd(ctx.cwd);
    log({
      event: "before_agent_start",
      cwd: ctx.cwd,
      orb,
      selectedTools: event.systemPromptOptions.selectedTools,
      promptGuidelines: event.systemPromptOptions.promptGuidelines,
      promptSections: event.systemPromptOptions.appendSystemPrompt,
    });
    if (!orb) return;
    event.systemPromptOptions.sections.orb_p0_probe =
      "This is a read-only integration test; desktop input is forbidden.";
    event.systemPromptOptions.promptGuidelines.push(
      "P0 Orb probe guideline: never perform desktop input.",
    );
  });

  pi.on("session_shutdown", (_event, ctx) => {
    log({ event: "session_shutdown", cwd: ctx.cwd, orb: isOrbCwd(ctx.cwd) });
  });
}
