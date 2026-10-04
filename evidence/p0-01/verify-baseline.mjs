// P0-01 baseline verifier.
//
// Recomputes every hash recorded by record-baseline.mjs and fails on any mismatch.
// This is what makes "the user's six pre-existing changes were not touched" a check
// instead of an assertion in prose.
//
// Exits non-zero when: a file's bytes changed, a file disappeared, a new modified
// tracked file appeared, or pi-web HEAD moved.
//
// This check is about a **developer-local** pi-web checkout, whose path is recorded in
// `changed-files-baseline.json` and overridable with `PI_ORB_P0_PI_WEB`. It is not a property of
// this repository, so on a machine that has no such checkout (another contributor, a CI runner) it
// reports `skipped: true` with a reason and exits 0 — the comparison genuinely did not happen.
// It must never report `passed: true` for a comparison it could not run; the release gate prints
// the skipped state instead of counting it as a satisfied check.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..", "..");
// The original P0 snapshot remains historical after the authorized Pi Web 0.10 upgrade.
const baselinePath = join(repo, "evidence", "personal-startup", "pi-web-baseline.json");
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const piWebRepo = process.env.PI_ORB_P0_PI_WEB ?? baseline.piWebRepo;

function skip(reason) {
  console.log(
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        piWebRepo,
        skipped: true,
        reason,
        passed: false,
        hint: "set PI_ORB_P0_PI_WEB to a pi-web checkout at the recorded commit to run this comparison",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (!piWebRepo) {
  skip("no pi-web checkout path is recorded or configured");
}
if (!existsSync(join(piWebRepo, ".git"))) {
  skip(`no git checkout of pi-web at ${piWebRepo}`);
}

const git = (...args) => execFileSync("git", ["-C", piWebRepo, ...args], { encoding: "utf8" });
const gitTrim = (...args) => git(...args).trim();
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

const failures = [];
const checked = [];

for (const file of baseline.files) {
  const abs = join(piWebRepo, file.path);
  if (!existsSync(abs)) {
    failures.push({ path: file.path, problem: "missing" });
    continue;
  }
  const actual = sha256(abs);
  if (actual !== file.workingTreeSha256) {
    failures.push({ path: file.path, problem: "hash-mismatch", expected: file.workingTreeSha256, actual });
  } else {
    checked.push(file.path);
  }
}

const headNow = gitTrim("rev-parse", "HEAD");
if (headNow !== baseline.head) {
  failures.push({ problem: "head-moved", expected: baseline.head, actual: headNow });
}

// A new modified tracked file would mean something outside the recorded set changed.
// (trimEnd is required: the first porcelain line's leading status space is meaningful.)
const modifiedNow = git("status", "--porcelain")
  .trimEnd()
  .split(/\r?\n/)
  .filter((line) => line.length > 3)
  .filter((line) => !line.startsWith("??"))
  .map((line) => line.slice(3).replace(/^"|"$/g, ""));
const baselinePaths = new Set(baseline.files.map((f) => f.path));
const unexpected = modifiedNow.filter((path) => !baselinePaths.has(path));
if (unexpected.length > 0) {
  failures.push({ problem: "unexpected-modified-files", paths: unexpected });
}

const report = {
  verifiedAt: new Date().toISOString(),
  piWebRepo,
  skipped: false,
  head: headNow,
  headUnchanged: headNow === baseline.head,
  checkedFiles: checked,
  checkedCount: checked.length,
  failures,
  passed: failures.length === 0,
};
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
