// Production MCP/extension authentication against the user's Chrome; no extension-page
// scripting, copied profile/cookies, arbitrary browser code, or printed token values.
import { buildSync } from 'esbuild';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = resolve('.tmp/public-browser');
mkdirSync(dir, { recursive: true });
buildSync({ entryPoints: ['src/main/browser-broker.ts'], outfile: `${dir}/broker.mjs`, bundle: true, format: 'esm', platform: 'node', packages: 'external' });
const { BrowserBroker } = await import(pathToFileURL(`${dir}/broker.mjs`).href);
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><meta charset="utf-8"><title>Pi public browser verification</title><h1>Playwright 公用工具验证</h1><button onclick="this.textContent=\'已验证\'">验证连接</button>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;
writeFileSync(`${dir}/fixture.json`, JSON.stringify({ url }));
const report = { capturedAt: new Date().toISOString(), method: 'production BrowserBroker + user Chrome Profile 1 + persisted extension token; automatic connections, no manual confirmation', checks: [], calls: [], passed: false };
const grant = () => ({ authorized: true, level: 'full-access', sessionId: 'token-probe', generation: 1, stopped: false, stoppedReason: null, lastObservationId: null });
let broker;
const call = async (name, args = {}) => {
  const start = performance.now();
  const result = await broker.call({ name, arguments: args }, 'token-probe', 1);
  report.calls.push({ name, ok: result.ok, elapsedMs: Math.round(performance.now() - start) });
  if (!result.ok) throw new Error(result.message ?? result.reason ?? 'Browser call failed');
  return (result.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
};
try {
  broker = new BrowserBroker(grant, undefined, 'pi-web-auth-verification');
  const page = await call('browser_navigate', { url });
  report.checks.push({ name: 'persisted token connects the real extension without manual approval', ok: page.includes('Pi public browser verification') && page.includes(url) });
  const ref = page.split('\n').find(line => line.includes('"验证连接"'))?.match(/\[ref=(\w+)\]/)?.[1];
  if (!ref) throw new Error('Verification button missing');
  const clicked = await call('browser_click', { element: '验证连接', target: ref });
  report.checks.push({ name: 'DOM action returns the changed page inline', ok: clicked.includes('已验证') });
  await call('browser_tabs', { action: 'close' });
  broker.revoke();
  broker = new BrowserBroker(grant, undefined, 'pi-web-auth-reconnection');
  const reconnected = await call('browser_navigate', { url });
  report.checks.push({ name: 'a new relay authenticates automatically after revocation', ok: reconnected.includes('Pi public browser verification') });
  await call('browser_tabs', { action: 'close' });
} catch (error) { report.checks.push({ name: 'token probe completes', ok: false, detail: String(error.message).replace(process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN ?? '$not-a-token$', '[redacted]') }); }
finally {
  broker?.revoke();
  report.passed = report.checks.length > 0 && report.checks.every(check => check.ok);
  writeFileSync(resolve('evidence/browser-connection/token-probe.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
if (!report.passed) { server.close(); process.exitCode = 1; }
else {
  console.log('Fixture stays available for the Pi Web/Orb model probe.');
  process.on('SIGINT', () => server.close());
  process.on('SIGTERM', () => server.close());
}
