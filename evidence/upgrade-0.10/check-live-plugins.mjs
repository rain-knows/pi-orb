// Read-only plugin inventory plus actual native MCP connection/tool enumeration.
import { writeFileSync } from "node:fs";
const base = "http://127.0.0.1:30141";
const cwd = "D:/workself/pi-orb";
const report = { capturedAt: new Date().toISOString(), packages: [], diagnostics: [], mcp: [], passed: false };
const inventory = await fetch(`${base}/api/plugins?cwd=${encodeURIComponent(cwd)}`).then(response => response.json());
if (inventory.error) throw new Error(inventory.error);
report.packages = inventory.packages.map(item => ({ source: item.source, version: item.version, disabled: item.disabled, resourceCounts: item.counts }));
report.diagnostics = inventory.diagnostics;
await Promise.all(["context7", "anysearch", "amap", "deepwiki", "chrome-devtools"].map(async name => {
  try {
    const result = await fetch(`${base}/api/mcp/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, scope: "global", cwd }), signal: AbortSignal.timeout(70000) }).then(response => response.json());
    report.mcp.push({ name, state: result.result?.state, toolCount: result.result?.toolCount, tools: result.result?.tools?.map(tool => typeof tool === "string" ? tool : tool.name), reason: result.reason ?? result.result?.error });
  } catch (error) { report.mcp.push({ name, state: "failed", error: error.name }); }
}));
report.passed = report.diagnostics.length === 0 && report.mcp.every(row => row.state === "connected" || row.state === "ready" || row.state === "ok");
writeFileSync(new URL("live-plugins.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
