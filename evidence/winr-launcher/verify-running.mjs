// Read-only check of the current user's real installed Orb and Pi Web.
// No provider request, screen capture, desktop action or secret is recorded.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';

const handshake = JSON.parse(readFileSync(join(process.env.APPDATA, 'pi-orb/bridge-token.json'), 'utf8'));
const call = type => new Promise((resolve, reject) => {
  const socket = createConnection(handshake.pipePath);
  let data = '';
  socket.on('connect', () => socket.write(JSON.stringify({ type, version: 2, requestId: randomUUID(),
    token: handshake.token, sessionId: handshake.orbSessionId, generation: handshake.generation,
    ...(type === 'code-agent' ? { command: 'status' } : {}) }) + '\n'));
  socket.on('data', chunk => {
    data += chunk;
    if (data.includes('\n')) { socket.end(); resolve(JSON.parse(data.split('\n')[0])); }
  });
  socket.on('error', reject);
  socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('Bridge timeout')); });
});
const request = async type => {
  const response = await fetch(`http://127.0.0.1:30141/api/agent/${handshake.orbSessionId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }),
    signal: AbortSignal.timeout(10000),
  });
  return { http: response.status, body: await response.json() };
};
const status = await call('status');
const agents = await call('code-agent');
const state = await request('get_state');
const all = await request('get_tools');
const tools = Array.isArray(all.body.data) ? all.body.data : [];
const expected = ['click', 'input_text', 'scroll', 'hotkey', 'long_press', 'drag', 'wait', 'long_wait',
  'screenshot', 'open_in_browser', 'open_in_finder', 'list_apps', 'open_app',
  'code_agent', 'code_agent_status', 'code_agent_stop'];
const active = tools.filter(tool => tool.active).map(tool => tool.name);
const result = { at: new Date().toISOString(), mainPid: handshake.pid, sessionId: handshake.orbSessionId,
  workspace: handshake.workspace, bridge: { ok: status.ok, status: status.result },
  background: { ok: agents.ok, result: agents.result },
  piWeb: { http: state.http, success: state.body.success, activeTools: active, expectedOrbTools: expected,
    missing: expected.filter(name => !active.includes(name)), oldOrbTools: active.filter(name => name.startsWith('orb_')) },
};
result.passed = status.ok && status.result?.authorized === true && status.result?.level === 'full-access'
  && agents.ok && state.http === 200 && result.piWeb.missing.length === 0 && result.piWeb.oldOrbTools.length === 0;
writeFileSync(join(import.meta.dirname, 'runtime.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ passed: result.passed, mainPid: result.mainPid, activeOrbTools: expected.length, missing: result.piWeb.missing }));
if (!result.passed) process.exitCode = 1;
