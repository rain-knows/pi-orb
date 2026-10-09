import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { verifyPackage } from '../scripts/verify/package.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'orb-runner-'));
  roots.push(repo);
  const outputDir = join(repo, 'reports');
  mkdirSync(outputDir);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  const artifactDir = join(repo, 'release/1.2.3');
  mkdirSync(join(artifactDir, 'win-unpacked/resources'), { recursive: true });
  writeFileSync(join(artifactDir, 'pi-orb-1.2.3-win-x64.exe'), 'fixture installer');
  writeFileSync(join(artifactDir, 'win-unpacked/resources/app.asar'), 'fixture archive');
  const reports = { credentials: 'credentials', licenses: 'license-inventory', 'package-audit': 'package-audit', 'plugin-load': 'plugin-load', 'packaged-smoke': 'packaged-smoke' };
  const called = [];
  const run = (command, args, options) => {
    called.push([command, args]);
    expect(options.env.PI_ORB_VERIFY_OUTPUT).toBe(outputDir);
    if (command === 'node') {
      const key = args[0].split('/').at(-1).replace('.mjs', '');
      writeFileSync(join(outputDir, reports[key] + '.json'), JSON.stringify({ capturedAt: new Date().toISOString(), passed: true }));
    }
  };
  return { repo, outputDir, run, called };
}
it('records build failure without borrowing earlier successful reports', () => {
  const f = fixture();
  for (const name of ['package-audit', 'packaged-smoke', 'stage-result']) writeFileSync(join(f.outputDir, name + '.json'), JSON.stringify({ passed: true }));
  const result = verifyPackage({ ...f, run: (command, args, options) => {
    if (command === 'npm') throw new Error('fixture build failure');
    f.run(command, args, options);
  } });
  expect(result.passed).toBe(false);
  expect(result.steps.at(-1)).toMatchObject({ name: 'final installer build', ok: false, error: 'fixture build failure' });
  expect(result.reports['package-audit.json']).toBeUndefined();
  expect(JSON.parse(readFileSync(join(f.outputDir, 'stage-result.json'), 'utf8')).passed).toBe(false);
});
it('builds one installer then audits, loads and launches that build', () => {
  const f = fixture();
  const result = verifyPackage(f);
  expect(result.passed).toBe(true);
  expect(f.called.filter(([command]) => command === 'npm')).toEqual([['npm', ['run', 'package:win']]]);
  expect(result.installer.sha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(Object.keys(result.reports)).toContain('plugin-load.json');
});
it('blocks on a failing probe even when its process exits successfully', () => {
  const f = fixture();
  const result = verifyPackage({ ...f, run: (command, args, options) => {
    f.run(command, args, options);
    if (args[0].endsWith('package-audit.mjs')) writeFileSync(join(f.outputDir, 'package-audit.json'), JSON.stringify({ capturedAt: new Date().toISOString(), passed: false }));
  } });
  expect(result.passed).toBe(false);
  expect(result.steps.at(-1)).toMatchObject({ name: 'package audit', ok: false });
  expect(result.reports['plugin-load.json']).toBeUndefined();
});
it('rejects old or missing reports', () => {
  const f = fixture();
  const result = verifyPackage({ ...f, run: () => writeFileSync(join(f.outputDir, 'credentials.json'), JSON.stringify({ capturedAt: '2000-01-01T00:00:00Z', passed: true })) });
  expect(result.passed).toBe(false);
  expect(result.steps[0]).toMatchObject({ name: 'credentials', ok: false });
  rmSync(join(f.outputDir, 'credentials.json'));
  const missing = verifyPackage({ ...f, run: () => {} });
  expect(missing.passed).toBe(false);
  expect(missing.steps[0].ok).toBe(false);
});
