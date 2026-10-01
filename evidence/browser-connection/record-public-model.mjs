// Exports only the named verification sessions' tool names, timings, and fixture result.
// Never exports unrelated chat text, browser snapshots, storage, credentials, or token values.
import { readFileSync, writeFileSync } from 'node:fs';
const sessionId = process.argv[2];
if (!sessionId) throw new Error('Pass the verification session id');
const response = await fetch(`http://127.0.0.1:30141/api/agent/${sessionId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'get_state' }) });
const state = (await response.json()).data;
const messages = readFileSync(state.sessionFile, 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(record => record.type === 'message');
const calls = messages.flatMap(record => record.message.role === 'assistant' ? (record.message.content ?? []).filter(block => block.type === 'toolCall').map(block => ({ id: block.id, tool: block.name, command: block.arguments?.name, at: record.timestamp })) : []);
const results = messages.filter(record => record.message.role === 'toolResult');
const text = record => (record.message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const report = { capturedAt: new Date().toISOString(), sessionId, cwd: process.argv[3], checks: [
  { name: 'ordinary Pi Web model directly calls the public browser tool', ok: calls.some(call => call.command === 'browser_navigate') && calls.every(call => call.tool === 'orb_browser') },
  { name: 'a DOM click is followed by the changed fixture snapshot', ok: results.some(record => text(record).includes('已验证') && text(record).includes('Pi public browser verification')) },
  { name: 'all browser results succeed and the real model turn completes', ok: results.length >= 3 && results.every(record => !record.message.isError) && !state.isStreaming && !state.isPromptRunning },
], calls: calls.map(call => { const result = results.find(record => record.message.toolCallId === call.id); return { tool: call.tool, command: call.command, ok: result ? !result.message.isError : false, elapsedMs: result ? Date.parse(result.timestamp) - Date.parse(call.at) : null }; }) };
report.passed = report.checks.every(check => check.ok);
writeFileSync(new URL(process.argv[4] ?? './public-model-probe.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
