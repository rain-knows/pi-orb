import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRunDirectory } from './run-directory.mjs';

const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');

// Importing this module does not build or write anything. Tests call this runner directly.
export function verifyPackage({ repo = resolve(import.meta.dirname, '../..'), outputDir = createRunDirectory('packaging'), run = execFileSync } = {}) {
  const { version } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  const installer = join(repo, 'release', version, `pi-orb-${version}-win-x64.exe`);
  const asar = join(repo, 'release', version, 'win-unpacked/resources/app.asar');
  const stage = { capturedAt: new Date().toISOString(), version, outputDir, steps: [], reports: {}, passed: false };
  const commands = [
    ['credentials', 'node', ['scripts/verify/credentials.mjs'], 'credentials.json'],
    ['licenses', 'node', ['scripts/verify/licenses.mjs'], 'license-inventory.json'],
    ['final installer build', 'npm', ['run', 'package:win'], null],
    ['package audit', 'node', ['scripts/verify/package-audit.mjs'], 'package-audit.json'],
    ['Pi plugin loading', 'node', ['scripts/verify/plugin-load.mjs'], 'plugin-load.json'],
    ['packaged application launch', 'node', ['scripts/verify/packaged-smoke.mjs'], 'packaged-smoke.json'],
  ];
  for (const [name, command, args, reportName] of commands) {
    const started = Date.now();
    try {
      run(command, args, {
        cwd: repo, env: { ...process.env, NODE_ENV: 'development', PI_ORB_VERIFY_OUTPUT: outputDir },
        encoding: 'utf8', stdio: 'inherit', shell: process.platform === 'win32',
      });
      if (reportName) {
        const report = JSON.parse(readFileSync(join(outputDir, reportName), 'utf8'));
        if (report.passed !== true || Date.parse(report.capturedAt) < Date.parse(stage.capturedAt) || !Number.isFinite(Date.parse(report.capturedAt))) {
          throw new Error(`${reportName} failed or does not belong to this run`);
        }
        stage.reports[reportName] = report;
      } else {
        stage.installer = { path: installer, bytes: statSync(installer).size, sha256: digest(installer) };
        stage.asar = { path: asar, sha256: digest(asar) };
      }
      stage.steps.push({ name, ok: true, ms: Date.now() - started });
    } catch (error) {
      stage.steps.push({ name, ok: false, ms: Date.now() - started, error: error.message });
      break;
    }
  }
  if (stage.steps.length === commands.length && stage.steps.every(step => step.ok)) {
    try {
      if (digest(installer) !== stage.installer.sha256 || digest(asar) !== stage.asar.sha256) throw new Error('Final artifact changed during verification');
      stage.passed = true;
    } catch (error) {
      stage.steps.push({ name: 'final artifact identity', ok: false, error: error.message });
    }
  }
  writeFileSync(join(outputDir, 'stage-result.json'), JSON.stringify(stage, null, 2) + '\n');
  return stage;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = verifyPackage();
  console.log(JSON.stringify({ passed: result.passed, outputDir: result.outputDir, steps: result.steps, installer: result.installer }, null, 2));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `reports=${result.outputDir}\n`);
  process.exitCode = result.passed ? 0 : 1;
}
