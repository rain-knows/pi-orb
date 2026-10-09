/**
 * Provenance check: for every file pi-orb claims to have ported from `deepseek-harness-orb`, compare
 * it against the pinned upstream checkout and classify the difference.
 *
 * Why this exists: AGENTS.md requires that reused code keeps its source commit and licence, and that
 * original work is never described as reused (nor the reverse). Until now those claims lived in prose
 * headers, and a header can say "unmodified" while the file has drifted — the same failure mode as a
 * documented constant with no test. This script turns the claim into something re-runnable:
 *
 *   - `unmodified`  — every non-blank pi-orb line appears verbatim in the reference file.
 *   - `adapted`     — extra lines exist, so the file must carry a recorded reason. Printed so the
 *                     reason can be checked against the header.
 *   - `missing`     — the reference file or the pinned checkout is unavailable.
 *
 * It is deliberately a report, not a pass/fail gate: an adapted file is legitimate when the
 * difference is recorded and justified. What it removes is the ability to claim "unmodified"
 * without it being true.
 *
 * Usage: node evidence/p1-07/check-provenance.mjs [--json]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..", "..");

/** Pinned reference commit; every port records this. */
const REFERENCE_COMMIT = "72f1d738458a223696685a909e806b683eff5885";

/** Candidate checkouts, in the order AGENTS.md lists them. */
const CHECKOUTS = [
  "D:\\pi-orb-ref\\deepseek-harness-orb",
  "C:\\Users\\JUSTLIKEZYP\\AppData\\Local\\Temp\\deepseek-harness-orb-pi-orb",
  "C:\\Users\\JUSTLIKEZYP\\AppData\\Local\\Temp\\deepseek-harness-orb-research",
];

/**
 * pi-orb file -> reference file, relative to the checkout root. Only files pi-orb states were ported
 * appear here; a file that is entirely pi-orb's own work must NOT be listed, which is what keeps the
 * attribution honest in the other direction.
 */
const PORTS = {
  "src/main/reference-windows/windows.ts": "packages/experimental/tool-computer-use/src/windows.ts",
  "src/main/reference-windows/wait.ts": "packages/experimental/tool-computer-use/src/wait.ts",
  "src/main/reference-windows/windows-native.ts": "packages/experimental/tool-computer-use/src/windows-native.ts",
  "src/main/reference-windows/windows-foreground.ts": "packages/experimental/tool-computer-use/src/windows-foreground.ts",
  "src/main/reference-windows/coordinates.ts": "packages/experimental/tool-computer-use/src/coordinates.ts",
  "src/main/reference-windows/backend.ts": "packages/experimental/tool-computer-use/src/backend.ts",
  "src/main/windows-selection.ts": "apps/desktop/src/windows-selection.ts",
  "src/main/windows-selection-native.ts": "apps/desktop/src/windows-selection-native.ts",
  "src/main/selection-monitor.ts": "apps/desktop/src/selection-monitor.ts",
  // Current geometry is ported from the plugin reference, recorded by reference-sync/record-reference.mjs.
  "src/main/floating-overlay-guard.ts": "apps/desktop/src/floating-window.ts",
  "src/main/observation-frame.ts": "apps/desktop/src/observation-frame-window.ts",
};

function normalise(text) {
  return text.replace(/\r\n/g, "\n");
}

/** Lines that exist in pi-orb but not verbatim in the reference file. */
function novelLines(ours, theirs) {
  const referenceLines = new Set(normalise(theirs).split("\n").map((line) => line.trim()));
  return normalise(ours)
    .split("\n")
    .filter((line) => line.trim() !== "" && !referenceLines.has(line.trim()));
}

function findCheckout() {
  for (const root of CHECKOUTS) {
    if (existsSync(join(root, "apps", "desktop", "src"))) return root;
  }
  return null;
}

const checkout = findCheckout();
const results = [];

if (checkout === null) {
  // A fresh clone has no reference checkout; the release gate treats this as skipped, not failed.
  const summary = {
    passed: true,
    skipped: true,
    reason: `no reference checkout found in: ${CHECKOUTS.join(", ")}`,
    commit: REFERENCE_COMMIT,
  };
  if (process.argv.includes("--json")) writeFileSync(join(import.meta.dirname, "provenance.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

for (const [ours, theirs] of Object.entries(PORTS)) {
  const ourPath = join(repo, ours);
  const theirPath = join(checkout, theirs);
  if (!existsSync(ourPath)) {
    results.push({ file: ours, reference: theirs, status: "missing", detail: "pi-orb file not found" });
    continue;
  }
  if (!existsSync(theirPath)) {
    results.push({ file: ours, reference: theirs, status: "missing", detail: "reference file not found in checkout" });
    continue;
  }
  const novel = novelLines(readFileSync(ourPath, "utf8"), readFileSync(theirPath, "utf8"));
  const header = readFileSync(ourPath, "utf8");
  const hasProvenance = header.includes(REFERENCE_COMMIT) && /MIT/u.test(header);
  results.push({
    file: ours,
    reference: theirs,
    status: novel.length === 0 ? "unmodified" : "adapted",
    novelLines: novel.length,
    // An adapted file must state its source commit and licence, and say why it differs.
    provenanceHeader: hasProvenance,
    sample: novel.slice(0, 3).map((line) => line.trim().slice(0, 100)),
  });
}

const adapted = results.filter((entry) => entry.status === "adapted");
const missing = results.filter((entry) => entry.status === "missing");
const withoutHeader = results.filter((entry) => entry.status !== "missing" && !entry.provenanceHeader);

const summary = {
  passed: missing.length === 0 && withoutHeader.length === 0,
  skipped: false,
  checkout,
  commit: REFERENCE_COMMIT,
  unmodified: results.filter((entry) => entry.status === "unmodified").length,
  adapted: adapted.length,
  missing: missing.length,
  adaptedWithoutProvenanceHeader: withoutHeader.length,
  files: results,
  note: "`adapted` is legitimate when the difference is recorded in the file header and justified; this report exists so `unmodified` cannot be claimed without being true",
};

if (process.argv.includes("--json")) {
  writeFileSync(join(import.meta.dirname, "provenance.json"), `${JSON.stringify(summary, null, 2)}\n`);
}

console.log(`reference checkout: ${checkout}`);
console.log(`pinned commit     : ${REFERENCE_COMMIT}\n`);
for (const entry of results) {
  const mark = entry.status === "unmodified" ? "SAME" : entry.status === "adapted" ? "DIFF" : "MISS";
  console.log(`${mark}  ${entry.file}`);
  if (entry.status === "adapted") {
    console.log(`      ${String(entry.novelLines)} pi-orb-only lines vs ${entry.reference}`);
    for (const line of entry.sample) console.log(`      + ${line}`);
  } else if (entry.status === "missing") {
    console.log(`      ${entry.detail}`);
  }
}
console.log(`\nunmodified ${summary.unmodified} · adapted ${summary.adapted} · missing ${summary.missing} · adapted-without-provenance ${summary.adaptedWithoutProvenanceHeader}`);
console.log(`passed: ${summary.passed}`);
process.exit(summary.passed ? 0 : 1);
