// Pi 1.0 native MCP conversion. Credentials stay in the original private file.
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateMcpServerConfig } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/mcp-servers.js";

const path = resolve(process.argv[2]);
const config = JSON.parse(readFileSync(path, "utf8"));
const allowed = ["command", "args", "env", "cwd", "url", "headers", "bearerToken", "bearerTokenEnvVar", "oauth", "exposure", "description", "toolExposure", "enabled", "timeout"];
const checks = [];
for (const [name, old] of Object.entries(config.mcpServers)) {
  const next = Object.fromEntries(Object.entries(old).filter(([key]) => allowed.includes(key)));
  if (old.auth && typeof old.auth === "object") next.auth = old.auth;
  if (old.disabled === true) next.enabled = false;
  const result = validateMcpServerConfig(name, next);
  if (typeof result === "string") throw new Error(`${name}: ${result}`);
  config.mcpServers[name] = next;
  checks.push({ name, removedKeys: Object.keys(old).filter(key => !(key in next)), valid: true });
}
copyFileSync(path, `${path}.pre-pi-1.0`);
writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
writeFileSync(new URL("mcp-conversion.json", import.meta.url), JSON.stringify({ checks, passed: true }, null, 2) + "\n");
console.log(JSON.stringify(checks));
