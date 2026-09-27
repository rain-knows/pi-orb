// P0-01 baseline recorder.
//
// The P0-01 deliverable requires recording "已有用户源码 diff 可区分" AND an
// inspectable per-file hash baseline, so later runs can prove the six pre-existing
// pi-web modifications were not touched by this project. The first attempt only
// described that in prose; this script actually stores the hashes.
//
// Reads pi-web read-only. Writes only into evidence/p0-01/.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..", "..");
const piWebRepo = process.env.PI_ORB_P0_PI_WEB ?? "C:\\Users\\JUSTLIKEZYP\\OneDrive\\文档\\daily\\pi-web";
const outDir = join(repo, "evidence", "p0-01");

const git = (...args) => execFileSync("git", ["-C", piWebRepo, ...args], { encoding: "utf8" });
const gitTrim = (...args) => git(...args).trim();

/**
 * Modified tracked files (the user's own work).
 *
 * NOTE: do not trim() the whole porcelain output. For the first line the leading
 * status space is significant (` M path`), and trimming it shifts the path by one
 * character. That exact bug produced "pp/endfield.css" once; the verifier caught it.
 */
function trackedChanges() {
  return git("status", "--porcelain")
    .trimEnd()
    .split(/\r?\n/)
    .filter((line) => line.length > 3)
    .filter((line) => !line.startsWith("??"))
    .map((line) => ({ status: line.slice(0, 2), path: line.slice(3).replace(/^"|"$/g, "") }))
    .filter((entry) => /\.(tsx?|css|md|json|js|mjs)$/.test(entry.path));
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

const head = gitTrim("rev-parse", "HEAD");
const changes = trackedChanges();
const files = changes.map((entry) => {
  const abs = join(piWebRepo, entry.path);
  const info = existsSync(abs) ? statSync(abs) : null;
  return {
    path: entry.path,
    gitStatus: entry.status,
    // Working-tree hash: proves the current file bytes have not changed since capture.
    workingTreeSha256: info ? sha256(abs) : null,
    // Committed blob: lets a reader tell "user edit" apart from "our edit",
    // since our edits would change the working tree without the blob moving.
    headBlobSha1: (() => {
      try { return gitTrim("rev-parse", `HEAD:${entry.path}`); } catch { return null; }
    })(),
    bytes: info?.size ?? null,
  };
});

const record = {
  capturedAt: new Date().toISOString(),
  purpose: "Hash baseline for the user's pre-existing pi-web modifications (N1/N2/N6 evidence).",
  piWebRepo,
  head,
  changedFileCount: files.length,
  files,
  verification: {
    method: "Re-run evidence/p0-01/verify-baseline.mjs; it recomputes every workingTreeSha256 and fails on any mismatch.",
    note: "A prose claim of 'hashes recorded' is not evidence; these values and the verifier are.",
  },
};

writeFileSync(join(outDir, "changed-files-baseline.json"), JSON.stringify(record, null, 2) + "\n", "utf8");
writeFileSync(
  join(outDir, "changed-files.sha256"),
  files.map((f) => `${f.workingTreeSha256}  ${f.path}`).join("\n") + "\n",
  "utf8",
);

console.log(JSON.stringify({ head, changedFileCount: files.length, files: files.map((f) => f.path) }, null, 2));
