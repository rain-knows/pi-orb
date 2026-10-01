import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureBrowserExtensionEnvironment } from "../src/shared/browser-extension-env";

describe("host-local Playwright authentication", () => {
  it("refreshes both hosts' MCP environment from the private configuration", () => {
    const directory = mkdtempSync(join(tmpdir(), "playwright-auth-test-"));
    const path = join(directory, "auth.json");
    vi.stubEnv("PLAYWRIGHT_MCP_EXTENSION_TOKEN", "stale-token");
    vi.stubEnv("PLAYWRIGHT_MCP_PROFILE_DIR_NAME", "Default");
    try {
      writeFileSync(path, JSON.stringify({ token: "fixture-token", profileDirName: "Profile 1" }));
      configureBrowserExtensionEnvironment(path);
      expect(process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN).toBe("fixture-token");
      expect(process.env.PLAYWRIGHT_MCP_PROFILE_DIR_NAME).toBe("Profile 1");
      configureBrowserExtensionEnvironment(join(directory, "absent.json"));
      expect(process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN).toBe("fixture-token");
      writeFileSync(path, '{"token":"fixture-secret",');
      expect(() => configureBrowserExtensionEnvironment(path)).toThrow("Invalid Playwright extension authentication configuration.");
    } finally { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); }
  });
});
