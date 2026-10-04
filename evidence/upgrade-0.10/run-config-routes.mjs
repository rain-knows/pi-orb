// Exercise real production save routes against a disposable config, never user files.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
const web = process.env.PI_ORB_EVIDENCE_PI_WEB ?? "C:/Users/JUSTLIKEZYP/OneDrive/文档/daily/pi-web";
const root = resolve(`.tmp/upgrade/config-routes-${Date.now()}`), agent = join(root, "agent");
mkdirSync(agent, { recursive: true });
writeFileSync(join(agent, "settings.json"), "{}");
writeFileSync(join(agent, "models.json"), '{"providers":{}}');
writeFileSync(join(agent, "mcp.json"), '{"mcpServers":{"fixture":{"command":"unused-disabled-fixture","enabled":false}}}');
const port = 48000 + process.pid % 2000, base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [join(web, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"],
  { cwd: web, env: { ...process.env, PI_CODING_AGENT_DIR: agent, PI_WEB_PASSWORD: "route-probe", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" }, windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
const report = { method: "Actual Pi Web production routes with isolated synthetic configs", checks: [], passed: false };
const headers = { authorization: `Basic ${Buffer.from("pi:route-probe").toString("base64")}`, "content-type": "application/json" };
const request = async (path, method, body) => {
  const response = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  const value = await response.json(); if (!response.ok || value.error) throw new Error(value.error ?? String(response.status)); return value;
};
try {
  const deadline = Date.now() + 30000;
  for (;;) {
    try { await request("/api/models-config", "GET"); break; }
    catch (error) { if (Date.now() > deadline || child.exitCode !== null) throw error; await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  const models = { providers: {}, verification: "actual-save-sentinel" };
  await request("/api/models-config", "PUT", models);
  report.checks.push({ name: "models route persists an actual edit and reads it back", ok: JSON.stringify(await request("/api/models-config", "GET")) === JSON.stringify(models) && JSON.parse(readFileSync(join(agent, "models.json"))).verification === models.verification });
  for (let index = 0; index < 20; index++) await request("/api/mcp", "POST", { action: index % 2 ? "disable" : "enable", scope: "global", name: "fixture" });
  report.checks.push({ name: "MCP production save survives repeated replacement and persists final state", ok: JSON.parse(readFileSync(join(agent, "mcp.json"))).mcpServers.fixture.enabled === false });
  report.checks.push({ name: "MCP route reads the written synthetic server", ok: JSON.stringify(await request("/api/mcp", "GET")).includes("fixture") });
  report.passed = report.checks.every(check => check.ok);
} catch (error) { report.error = error.message; }
finally {
  if (child.pid && child.exitCode === null) try { execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch {}
  writeFileSync(new URL("config-routes.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
if (!report.passed) process.exitCode = 1;
