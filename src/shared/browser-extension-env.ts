import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Host-local authentication for Microsoft's extension. Never include it in tool results,
 * Orb's renderer/configuration, or the package. Read before each new relay connection so
 * Electron and Pi Web do not depend on the environment of an old Explorer/terminal process.
 */
export function configureBrowserExtensionEnvironment(path = join(homedir(), ".pi", "agent", "playwright-extension.json")): void {
  let raw: string;
  try { raw = readFileSync(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error("Cannot read Playwright extension authentication configuration.");
  }
  let config: { token?: unknown; profileDirName?: unknown };
  try { config = JSON.parse(raw); } catch { throw new Error("Invalid Playwright extension authentication configuration."); }
  if (!config || typeof config.token !== "string" || !config.token.trim() || /\s/.test(config.token)
    || (config.profileDirName !== undefined && (typeof config.profileDirName !== "string"
      || !config.profileDirName.trim() || /[\\/]/.test(config.profileDirName)
      || [...config.profileDirName].some(character => character.charCodeAt(0) < 32)))) {
    throw new Error("Invalid Playwright extension authentication configuration.");
  }
  process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN = config.token;
  if (typeof config.profileDirName === "string") process.env.PLAYWRIGHT_MCP_PROFILE_DIR_NAME = config.profileDirName;
}
