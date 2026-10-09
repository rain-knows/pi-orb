import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRunDirectory } from './run-directory.mjs';

const repo = resolve(import.meta.dirname, '../..');
const outputDir = createRunDirectory('release');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean);
const patterns = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/u],
  ['API key', /\bsk-(?:ant-)?[A-Za-z0-9-]{20,}/u],
  ['AWS key', /\bAKIA[0-9A-Z]{16}\b/u],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/u],
];
const hits = [];
for (const file of new Set(files)) {
  const path = join(repo, file);
  if (!existsSync(path)) continue;
  if (/(^|\/)(auth\.json|\.env(?:\..*)?)$|\.(pem|key|pfx|p12)$/iu.test(file) && !file.endsWith('.env.example')) hits.push({ file, reason: 'credential file' });
  if (!/\.(ts|js|mjs|cjs|json|md|ps1|yml|yaml|vbs|cmd|nsh)$/iu.test(file)) continue;
  for (const [reason, pattern] of patterns) if (pattern.test(readFileSync(path, 'utf8'))) hits.push({ file, reason });
}
const report = { capturedAt: new Date().toISOString(), checkedFiles: files.length, hits, passed: hits.length === 0 };
writeFileSync(join(outputDir, 'credentials.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
