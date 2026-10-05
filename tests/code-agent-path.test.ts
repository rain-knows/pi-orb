import { afterEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { codeAgentRegistryPath, CODE_AGENT_REGISTRY } from "../src/shared/code-agent";

const previous = process.env.PI_ORB_CONFIG;

afterEach(() => {
  if (previous === undefined) delete process.env.PI_ORB_CONFIG;
  else process.env.PI_ORB_CONFIG = previous;
});

describe("Code agent registry location", () => {
  it("uses the same directory as the configured Orb config", () => {
    const configPath = "D:\\isolated\\orb\\orb-config.json";
    process.env.PI_ORB_CONFIG = configPath;
    expect(codeAgentRegistryPath()).toBe(join(dirname(configPath), CODE_AGENT_REGISTRY));
  });
});
