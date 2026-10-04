// Public Playwright MCP + real Chrome + disposable authenticated site. This proves the DOM
// adaptation, not installation/approval of the extension in the user's Chrome profile.
import { buildSync } from 'esbuild';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { createConnection } from '@playwright/mcp';
const root = resolve('.tmp/browser-connection');
mkdirSync(root, { recursive: true });
buildSync({ entryPoints: ['src/main/browser-broker.ts'], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: `${root}/broker.mjs` });
const { BrowserBroker } = await import(pathToFileURL(`${root}/broker.mjs`).href);
const report = { capturedAt: new Date().toISOString(), method: 'real Chrome, public createConnection/contextGetter, authenticated disposable site; no user cookies copied', checks: [], tools: [], passed: false };
const check = (name, ok, detail) => report.checks.push({ name, ok: Boolean(ok), detail });
const visits = [];
const server = createServer((req, res) => {
  visits.push({ path: req.url, authenticated: req.headers.cookie?.includes('probe_login=local-fixture') ?? false });
  res.setHeader('content-type', 'text/html; charset=utf-8');
  const url = new URL(req.url, 'http://fixture');
  const content = url.pathname === '/home' ? '<form action="/search"><input name="q" aria-label="搜索"><button>搜索</button></form>'
    : url.pathname === '/search' ? '<a href="/nearby">相似帐号</a><a href="/official">明日方舟终末地官方帐号</a>'
    : url.pathname === '/official' ? '<h1>明日方舟终末地官方帐号</h1><a href="/video/first">第一个视频</a>'
    : url.pathname === '/video/first' ? '<h1>官方帐号第一个视频</h1><button>播放</button>' : '<h1>不应进入</h1>';
  res.end(`<!doctype html><meta charset="utf-8"><title>Orb browser fixture</title>${content}`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser, broker;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: false });
  const context = await browser.newContext();
  await context.addCookies([{ name: 'probe_login', value: 'local-fixture', url: base }]);
  const page = await context.newPage();
  await page.goto(base + '/home');
  broker = new BrowserBroker(() => ({ authorized: true, level: 'full-access', sessionId: 'probe', generation: 1 }), () => createConnection({ webmcp: false, snapshot: { mode: 'none' }, codegen: 'none' }, async () => context));
  const call = async (name, args = {}) => {
    const start = performance.now();
    const result = await broker.call({ name, arguments: args }, 'probe', 1);
    report.tools.push({ name, elapsedMs: Math.round(performance.now() - start), ok: result.ok });
    if (!result.ok) throw new Error(JSON.stringify(result));
    return (result.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  };
  const discovered = await broker.call({ name: 'tools' }, 'probe', 1);
  check('discovery exposes snapshots but no arbitrary JavaScript', discovered.tools.some(t => t.name === 'browser_snapshot') && discovered.tools.every(t => !['browser_run_code','browser_evaluate'].includes(t.name)), discovered.tools.map(t => t.name));
  let snapshot = await call('browser_snapshot');
  const ref = (text, label) => {
    const row = text.split('\n').find(line => line.includes(`"${label}"`) && line.includes('[ref='));
    const value = row?.match(/\[ref=(\w+)\]/)?.[1];
    if (!value) throw new Error(`Missing current snapshot ref for ${label}: ${text}`);
    return value;
  };
  snapshot = await call('browser_type', { element: '搜索', target: ref(snapshot, '搜索'), text: '明日方舟终末地', submit: true });
  snapshot = await call('browser_click', { element: '明日方舟终末地官方帐号', target: ref(snapshot, '明日方舟终末地官方帐号') });
  snapshot = await call('browser_click', { element: '第一个视频', target: ref(snapshot, '第一个视频') });
  check('the requested official account and first video are reached in the existing tab', page.url() === base + '/video/first' && snapshot.includes('官方帐号第一个视频') && context.pages().length === 1, { path: new URL(page.url()).pathname, tabs: context.pages().length });
  check('the existing browser session login survives every navigation', visits.filter(v => !v.path.includes('favicon')).every(v => v.authenticated), visits);
  check('the nearby account was never opened', visits.every(v => v.path !== '/nearby'), visits.map(v => v.path));
  await page.screenshot({ path: resolve('evidence/browser-connection/dom-result.png') });
  const pending = broker.call({ name: 'browser_wait_for', arguments: { text: 'never-present' } }, 'probe', 1);
  await new Promise(resolve => setTimeout(resolve, 200));
  broker.revoke();
  const cancelled = await pending;
  check('revocation interrupts an in-flight browser request', cancelled.ok === false && cancelled.reason === 'cancelled', cancelled);
} catch (error) { check('browser probe completes', false, error.message); }
finally {
  broker?.revoke();
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  report.passed = report.checks.length > 0 && report.checks.every(c => c.ok);
  writeFileSync(resolve('evidence/browser-connection/dom-probe.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
if (!report.passed) process.exitCode = 1;
