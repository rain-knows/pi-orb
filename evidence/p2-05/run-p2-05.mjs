// P2-05 distribution stage runner.
//
// One command for the whole automated part of P2-05: build the unpacked Windows app, audit what is
// inside it, then start that exact artifact and prove it runs. The individual probes are separate
// files so they can be re-run on their own; this only sequences them and reports the combined
// result, because "the installer built" on its own says nothing about either question.
//
// What remains manual is recorded in `doc/manual-acceptance.md` §E: installing on a clean machine,
// the SmartScreen prompt for an unsigned installer, uninstall data retention, and an upgrade over
// an installed copy.
//
// Run: node evidence/p2-05/run-p2-05.mjs

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const evidenceDir = import.meta.dirname;
const repo = resolve(evidenceDir, "..", "..");

const stage = {
  capturedAt: new Date().toISOString(),
  steps: [],
  passed: false,
};

function step(name, command, args, options = {}) {
  const started = Date.now();
  try {
    const output = execFileSync(command, args, {
      cwd: repo,
      env: { ...process.env, NODE_ENV: "development" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      maxBuffer: 64 * 1024 * 1024,
    });
    stage.steps.push({ name, ok: true, ms: Date.now() - started, output: output.trim().split(/\r?\n/u).slice(-4).join(" | ") });
    return true;
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    stage.steps.push({
      name,
      ok: false,
      ms: Date.now() - started,
      output: (output || error.message).trim().split(/\r?\n/u).slice(-6).join(" | "),
    });
    if (options.stopOnFailure !== false) throw error;
    return false;
  }
}

// `npm run package:win:dir` runs the project build first, so a broken type or a broken renderer
// fails here rather than producing a stale package. The probes are launched through `node` on PATH
// because this shell runs commands as a shell string, which would split an absolute
// `C:\Program Files\...` interpreter path at the space.
try {
  step("build and package the unpacked Windows app", "npm", ["run", "package:win:dir"]);
  step("audit the packaged artifact", "node", ["evidence/p2-05/run-package-audit.mjs"]);
  step("load the independent packaged plugin with Pi", "node", ["evidence/personal-startup/run-plugin-load.mjs"]);
  step("start the packaged application and drive its renderer", "node", ["evidence/p2-05/run-packaged-smoke.mjs"]);
} catch {
  // The failed step already records the command output. Persist this run's failure below rather
  // than leaving an older successful stage-result.json behind when an intermediate gate fails.
}

const auditPath = join(evidenceDir, "package-audit.json");
const smokePath = join(evidenceDir, "packaged-smoke.json");
stage.artifactAudit = existsSync(auditPath) ? JSON.parse(readFileSync(auditPath, "utf8")) : null;
stage.packagedSmoke = existsSync(smokePath) ? JSON.parse(readFileSync(smokePath, "utf8")) : null;
stage.installer = existsSync(join(repo, "release"))
  ? "release/<version>/pi-orb-<version>-win-x64.exe (built by `npm run package:win`)"
  : null;

stage.passed = stage.steps.every((entry) => entry.ok) && stage.artifactAudit?.passed === true && stage.packagedSmoke?.passed === true;
writeFileSync(join(evidenceDir, "stage-result.json"), `${JSON.stringify(stage, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      passed: stage.passed,
      steps: stage.steps.map(({ name, ok, ms }) => ({ name, ok, ms })),
      artifactAudit: stage.artifactAudit ? { passed: stage.artifactAudit.passed, checks: stage.artifactAudit.checks.length } : null,
      packagedSmoke: stage.packagedSmoke ? { passed: stage.packagedSmoke.passed, checks: stage.packagedSmoke.checks.length } : null,
      failed: [
        ...stage.steps.filter((entry) => !entry.ok).map((entry) => entry.name),
        ...(stage.packagedSmoke?.checks.filter((entry) => !entry.ok).map((entry) => entry.name) ?? []),
        ...(stage.artifactAudit?.checks.filter((entry) => !entry.ok).map((entry) => entry.name) ?? []),
      ],
    },
    null,
    2,
  ),
);

process.exit(stage.passed ? 0 : 1);
