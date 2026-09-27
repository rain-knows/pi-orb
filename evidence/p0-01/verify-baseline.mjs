// P0-01 baseline verifier.
//
// Recomputes every hash recorded by record-baseline.mjs and fails on any mismatch.
// This is what makes "the user's six pre-existing changes were not touched" a check
// instead of an assertion in prose.
//
// Exits non-zero when: a file's bytes changed, a file disappeared, a new modified
// tracked file appeared, or pi-web HEAD moved.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..", "..");
const piWebRepo = process.env.PI_ORB_P0_PI_WEB ?? "C:\\Users\\JUSTLIKEZYP\\OneDrive\\文档\\daily\\pi-web";
const baselinePath = join(repo, "evidence", "p0-01", "changed-files-baseline.json");

const git = (...args) => execFileSync("git", ["-C", piWebRepo, ...args], { encoding: "utf8" });
const gitTrim = (...args) => git(...args).trim();
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
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
  head: headNow,
  headUnchanged: headNow === baseline.head,
  checkedFiles: checked,
  checkedCount: checked.length,
  failures,
  passed: failures.length === 0,
};
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
