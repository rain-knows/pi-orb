// Ordinary production Pi Web + actual global extensions + native MCP + real provider.
// Emits only verification metadata, never the effective prompt, credentials or search content.
import { readFileSync, writeFileSync } from "node:fs";
const base = process.env.PI_ORB_EVIDENCE_URL ?? "http://127.0.0.1:30141";
const report = { capturedAt: new Date().toISOString(), method: "Production ordinary session; real model calls native Code mode and authenticated Anysearch", checks: [], passed: false };
const post = async (path, body) => {
  const response = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const data = await response.json(); if (!response.ok || data.error) throw new Error(data.error ?? String(response.status)); return data;
};
let id;
try {
  const created = await post("/api/agent/new", { type: "ensure_session", cwd: process.cwd(), provider: "TZcode", modelId: "deepseek-v4.1-flash", thinkingLevel: "off", toolNames: ["read"] });
  id = created.sessionId; report.sessionId = id;
  const command = body => post(`/api/agent/${id}`, body);
  const tools = (await command({ type: "get_tools" })).data;
  const commands = (await command({ type: "get_commands" })).data.commands;
  report.checks.push({ name: "ordinary session has no native Orb desktop tools", ok: !tools.some(tool => tool.name === "orb_observe") });
  report.checks.push({ name: "native MCP and prompt commands are registered once", ok: ["mcp", "prompt-audit", "prompt-export"].every(name => commands.filter(command => command.name === name).length === 1) });
  await command({ type: "prompt", message: "这是只读兼容性验证。只用 codemode：通过 searchTools 查找 Anysearch 的 search 工具，describeNamespace 阅读 anysearch 当前说明并 describeTool 阅读 search 的实际参数，然后真正搜索一次 Pi coding agent 1.0 native MCP documentation。不要使用其他服务器、修改文件或启动子代理。结果非空后简短回答验证成功。不要只说明如何操作。" });
  const deadline = Date.now() + 180000;
  let state;
  do {
    await new Promise(resolve => setTimeout(resolve, 500));
    state = (await command({ type: "get_state" })).data;
  } while ((state.isStreaming || state.isPromptRunning) && Date.now() < deadline);
  const records = readFileSync(state.sessionFile, "utf8").trim().split(/\r?\n/u).map(line => JSON.parse(line));
  const messages = records.filter(record => record.type === "message").map(record => record.message);
  const calls = messages.filter(message => message.role === "assistant").flatMap(message => message.content.filter(block => block.type === "toolCall"));
  const results = messages.filter(message => message.role === "toolResult");
  const resultText = results.flatMap(message => message.content.filter(block => block.type === "text").map(block => block.text)).join("\n");
  report.toolCalls = calls.map(call => call.name);
  report.checks.push({ name: "real model invokes Code mode", ok: calls.some(call => call.name === "codemode") });
  report.checks.push({ name: "native MCP search returns real results without authentication failure", ok: resultText.includes("anysearch") && /https?:\/\//u.test(resultText) && !/401|Unauthorized|Script failed/u.test(resultText) });
  report.checks.push({ name: "all tool results succeed and logical prompt finishes", ok: results.length > 0 && results.every(message => !message.isError) && !state.isStreaming && !state.isPromptRunning && messages.filter(message => message.role === "assistant").at(-1)?.stopReason === "stop" });
  report.passed = report.checks.every(check => check.ok);
} catch (error) { report.error = error.message; }
finally {
  if (id && !report.passed) await post(`/api/agent/${id}`, { type: "abort" }).catch(() => {});
  writeFileSync(new URL("native-mcp-real-model.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
if (!report.passed) process.exitCode = 1;
