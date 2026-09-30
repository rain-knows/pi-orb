import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Documentation carries evidence results as counts — "content audit 25/25", "the packaged probe
 * 15/15", "release gate 63/63". Those counts rot: every probe that gained a check left the prose
 * behind, and the p2-05 line still said 10/10 several rounds after the probe reached 15/15. Nothing
 * compared them, exactly like the pinned constants in `playbook-constants.test.ts`.
 *
 * This suite reads each recorded result JSON and asserts that the documents which quote it quote the
 * current numbers. A count is a claim about a verifiable artifact, so it gets checked like one. The
 * check runs only when the record exists, so a fresh clone (where probes have not run yet) reports
 * the gap rather than failing on files that were never generated.
 *
 * The first version of this check searched for the *recorded* denominator (`\d+/15`) and therefore
 * passed against the very drift it existed for: the stale text read `10/10`, which contains no `15`
 * at all. It now scans the number that follows each claim's own phrase, and a test below pins that
 * case so the guard cannot quietly regress to the weaker form.
 */

const repo = join(import.meta.dirname, "..");

function readJson<T>(relative: string): T | null {
  const path = join(repo, relative);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** Count passing and total checks in a probe record. */
function tally(relative: string): string | null {
  const record = readJson<{ passed?: boolean; checks?: readonly { ok: boolean }[] }>(relative);
  if (record?.checks === undefined) return null;
  return `${record.checks.filter((check) => check.ok).length}/${record.checks.length}`;
}

/** The release gate records a summary rather than a check list. */
function gateTally(): string | null {
  const record = readJson<{ summary?: { passed: number; skipped?: number; failed: number } }>(
    "evidence/p1-07/release-gate.json",
  );
  const summary = record?.summary;
  if (summary === undefined) return null;
  return `${summary.passed}/${summary.passed + summary.failed}`;
}

const audit = tally("evidence/p2-05/package-audit.json");
const probe = tally("evidence/p2-05/packaged-smoke.json");
const gate = gateTally();

const documents: readonly { path: string; label: string }[] = [
  { path: "README.md", label: "README" },
  { path: "doc/support-matrix.md", label: "support matrix" },
  { path: "doc/manual-acceptance.md", label: "manual acceptance" },
  { path: "doc/pi-orb-development-goals.md", label: "development goals" },
  { path: "doc/pi-orb-reuse-assessment.md", label: "reuse assessment" },
  { path: "evidence/README.md", label: "evidence index" },
  { path: "evidence/p2-05/README.md", label: "p2-05 evidence" },
  { path: "doc/p2-01-reference-reuse.md", label: "p2-01 record" },
];

/** Which claim each document is expected to carry, and the recorded value for it. */
const claims: readonly { kind: string; value: string | null; marker: RegExp; numberPattern: RegExp }[] = [
  {
    kind: "artifact audit",
    value: audit,
    // Phrases the documents use when quoting this probe.
    marker: /内容审计|artifact audit/iu,
    numberPattern: /(\d+)\s*\/\s*(\d+)/gu,
  },
  {
    kind: "packaged probe",
    value: probe,
    marker: /启动探测|packaged probe/iu,
    numberPattern: /(\d+)\s*\/\s*(\d+)/gu,
  },
];

describe("documented evidence counts match the recorded results", () => {
  it("has a recorded result for the counts the documents quote", () => {
    // Without a record there is nothing to be consistent with; the release gate requires the
    // records to exist, so this only guards the case where one was deleted.
    expect({ audit, probe, gate }).toMatchObject({
      audit: expect.stringMatching(/^\d+\/\d+$/u),
      probe: expect.stringMatching(/^\d+\/\d+$/u),
      gate: expect.stringMatching(/^\d+\/\d+$/u),
    });
  });

  it.each(documents)("$label quotes the current value for every count it states", ({ path, label }) => {
    const text = readFileSync(join(repo, path), "utf8");
    const stale: string[] = [];
    for (const claim of claims) {
      if (claim.value === null || !claim.marker.test(text)) continue;
      // Every `n/m` that sits next to this claim's phrase must equal the recorded value. Scanning
      // only for the *recorded* total would miss a stale pair like `10/10` after the real total
      // moved to 15 — which is exactly the drift being guarded against.
      const marker = claim.marker.source;
      const near = new RegExp(String.raw`(?:${marker})[^。\n]{0,80}?(\d+)\s*\/\s*(\d+)`, "giu");
      for (const match of text.matchAll(near)) {
        const found = `${match[1]}/${match[2]}`;
        if (found !== claim.value) stale.push(`${label}: ${claim.kind} states ${found}, recorded ${claim.value}`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("catches a stale pair even when the total changed", () => {
    // Guards the guard: the first version of this check only looked for the recorded denominator,
    // so it passed against the very drift it existed for.
    const near = /(?:启动探测|packaged probe)[^。\n]{0,80}?(\d+)\s*\/\s*(\d+)/giu;
    const stale = "产物内容审计 25/25、打包产物启动探测 10/10（含一次真实桌面窗口枚举";
    const found = [...stale.matchAll(near)].map((match) => `${match[1]}/${match[2]}`);
    expect(found).toEqual(["10/10"]);
    expect(found.every((value) => value === probe)).toBe(false);
  });

  it("keeps the P2-05 evidence README's own headings current", () => {
    // These headings restate the probe tallies, and they were the first thing to drift.
    const readme = readFileSync(join(repo, "evidence/p2-05/README.md"), "utf8");
    if (audit !== null) expect(readme).toContain(`package-audit.json\`（${audit} 通过）`);
    if (probe !== null) expect(readme).toContain(`packaged-smoke.json\`（${probe} 通过）`);
  });
});
