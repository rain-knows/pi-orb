// Summarize only this authorized browser probe: do not publish raw account snapshots or cookies.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const file = process.argv[2];
if (!file) throw new Error('Pass the JSONL file of the authorized live browser probe.');
const events = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const messages = events.filter(e => e.type === 'message');
const probeStart = messages.findIndex(e => e.message.role === 'user' && e.message.content.some(c => c.text?.startsWith('继续浏览器扩展验证')));
const navigationStart = messages.findIndex(e => e.message.role === 'user' && e.message.content.some(c => c.text?.startsWith('复测原任务')));
if (probeStart < 0 || navigationStart < 0) throw new Error('The named probe turns are missing.');
const probe = messages.slice(probeStart);
const navigation = messages.slice(navigationStart);
const textOf = e => (e.message.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
const results = probe.filter(e => e.message.role === 'toolResult' && e.message.toolName === 'orb_browser');
const raw = results.map(textOf).join('\n');
const calls = navigation.flatMap(e => (e.message.content ?? []).filter(c => c.type === 'toolCall').map(c => {
  const result = results.find(r => r.message.toolCallId === c.id);
  return { name: c.name, command: c.arguments?.name, at: e.timestamp, elapsedMs: result ? Date.parse(result.timestamp) - Date.parse(e.timestamp) : null };
}));
const officialSnapshot = results.map(textOf).find(text => text.includes('Page URL: https://space.bilibili.com/1265652806')
  && text.includes('bilibili机构认证-企业') && text.includes('《明日方舟：终末地》官方账号'));
const firstVideo = officialSnapshot?.slice(officialSnapshot.indexOf('最新发布')).match(/\/url: (?:https:)?\/\/www\.bilibili\.com\/video\/(BV\w+)/)?.[1];
const pages = results.flatMap(e => [...textOf(e).matchAll(/^- Page URL: (.+)\n- Page Title: (.+)$/gm)].map(m => ({ url: m[1], title: m[2], at: e.timestamp, refs: [...textOf(e).matchAll(/\[ref=(\w+)\]/g)].length })));
const session = events.find(e => e.type === 'session');
const id = session?.id ?? events.find(e => e.id)?.sessionId;
const response = await fetch(`http://127.0.0.1:30141/api/agent/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'get_state' }) });
const state = (await response.json()).data;
const checks = [
  { name: 'existing Bilibili search tab returns inline DOM references', ok: pages.some(p => p.url.startsWith('https://www.bilibili.com/?page=SearchResults') && p.refs > 0) },
  { name: 'official account certification is present in tool-returned DOM', ok: Boolean(officialSnapshot) },
  { name: 'latest-published list and its first video are returned by the official account', ok: firstVideo === 'BV1DEhH6tEBA' },
  { name: 'the first video was opened in an extension-owned tab', ok: /^- \d+: (?:\(current\) )?\[.*\]\(https:\/\/www\.bilibili\.com\/video\/BV1DEhH6tEBA\/[^)]*\)$/m.test(raw) },
  { name: 'real model navigation uses browser commands without advisor or native coordinate tools', ok: calls.length > 0 && calls.every(c => c.name === 'orb_browser') },
  { name: 'browser tools succeed and the model turn finishes', ok: results.every(e => !e.message.isError) && state?.isStreaming === false && state?.isPromptRunning === false },
];
const report = { capturedAt: new Date().toISOString(), sessionId: id, model: state?.model,
  method: 'user Chrome Profile 1, Microsoft Playwright extension protocol 2, production Orb named pipe, real configured Pi model; user selected the existing Bilibili tab',
  source: file, screenshot: 'live-official-profile.png', checks, navigationCalls: calls, pages,
  note: 'Initial extension tab selection involved the user. No raw snapshots, cookies or user account identifiers are exported. The final inspected page was the official profile; the opened video tab was later absent from the browser inventory.',
  passed: checks.every(c => c.ok) };
writeFileSync(resolve(import.meta.dirname, 'live-extension-probe.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, checks, navigationCalls: calls }, null, 2));
if (!report.passed) process.exitCode = 1;
