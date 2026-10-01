// Exercises the running packaged Orb's production named pipe. Secrets remain in memory.
import { buildSync } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const file = resolve('.tmp/public-browser/bridge.mjs');
buildSync({ entryPoints: ['pi-package/extensions/bridge-client.ts'], outfile: file, bundle: true, platform: 'node', format: 'esm', packages: 'external' });
const { BridgeClient } = await import(pathToFileURL(file).href);
const bridge = BridgeClient.fromEnvironment();
const token = bridge.readToken();
if (!token?.orbSessionId) throw new Error('Running Orb has not published its session');
const call = value => bridge.call({ sessionId: token.orbSessionId, generation: token.generation, ...value }, token);
const status = await call({ type: 'status' });
const fixture = JSON.parse(readFileSync(resolve('.tmp/public-browser/fixture.json'), 'utf8'));
const start = performance.now();
const result = await call({ type: 'browser', browser: { name: 'browser_navigate', arguments: { url: fixture.url } } });
const page = (result.result?.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const report = { capturedAt: new Date().toISOString(), pid: token.pid, sessionId: token.orbSessionId, elapsedMs: Math.round(performance.now() - start), checks: [
  { name: 'the running shell publishes the same session identity as its Full Access grant', ok: status.ok && status.result?.authorized && status.result?.level === 'full-access' && status.result?.sessionId === token.orbSessionId },
  { name: 'packaged Orb connects its real Chrome extension without manual approval', ok: result.ok && result.result?.ok && page.includes('Pi public browser verification') && page.includes(fixture.url) },
] };
report.passed = report.checks.every(check => check.ok);
writeFileSync(new URL('./orb-token-probe.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
