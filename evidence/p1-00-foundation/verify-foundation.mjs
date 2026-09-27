/**
 * P1 foundation verification.
 *
 * Runs the project's own quality gates and records the result, so "the
 * foundation works" is a reproducible fact rather than a statement.
 *
 * Run: node evidence/p1-00-foundation/verify-foundation.mjs
 *
 * Exits non-zero when any gate fails.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

/** Never inherit NODE_ENV=production: it silently omits devDependencies. */
const env = { ...process.env, NODE_ENV: "development" };

const checks = [];
let failed = false;

function run(name, command, args) {
  const startedAt = Date.now();
  let ok = true;
  let output = "";
  try {
    output = execFileSync(command, args, {
      cwd: repoRoot,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
  } catch (error) {
    ok = false;
    output = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`;
  }
  const durationMs = Date.now() - startedAt;
  checks.push({
    name,
    command: [command, ...args].join(" "),
    ok,
    durationMs,
    // Keep the tail only: full output is large and the tail carries failures.
    outputTail: output.trim().split(/\r?\n/).slice(-25).join("\n"),
  });
  if (!ok) failed = true;
  return ok;
}

const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

run("typecheck", "npx", ["tsc", "--noEmit"]);
run("lint", "npx", ["eslint", "."]);
run("unit tests", "npx", ["vitest", "run"]);
run("production build", "npx", ["electron-vite", "build"]);

// ---------------------------------------------------------------------------
// Build output shape. A sandboxed preload must be loadable CommonJS under the
// exact file name the main process references; a mismatch fails silently at
// runtime (no bridge in the renderer, no error anywhere).
// ---------------------------------------------------------------------------
const expectedArtifacts = [
  "out/main/index.js",
  "out/preload/index.js",
  "out/renderer/index.html",
];
const artifacts = expectedArtifacts.map((relative) => ({
  path: relative,
  exists: existsSync(join(repoRoot, relative)),
}));
if (artifacts.some((artifact) => !artifact.exists)) failed = true;

const preloadSource = existsSync(join(repoRoot, "out/preload/index.js"))
  ? readFileSync(join(repoRoot, "out/preload/index.js"), "utf8")
  : "";
// A CJS Electron preload uses `require("electron")`; an ESM one would use
// `import` from an `.mjs` file. Assert the CJS marker so the format cannot
// silently regress.
const preloadIsCommonJs = /require\(\s*["']electron["']\s*\)/.test(preloadSource);
if (!preloadIsCommonJs) failed = true;

const mainSource = existsSync(join(repoRoot, "out/main/index.js"))
  ? readFileSync(join(repoRoot, "out/main/index.js"), "utf8")
  : "";
const mainReferencesExistingPreload = mainSource.includes("../preload/index.js");
if (!mainReferencesExistingPreload) failed = true;

// ---------------------------------------------------------------------------
// Repository hygiene: the ignore rules must actually exclude generated and
// local-only paths, and must not exclude anything the project needs to version.
// ---------------------------------------------------------------------------
function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

const statusShort = git(["status", "--porcelain"]);
const ignored = git(["status", "--porcelain", "--ignored"])
  .split(/\r?\n/)
  .filter((line) => line.startsWith("!!"))
  .map((line) => line.slice(3).trim());

const mustBeIgnored = ["node_modules/", "out/"];
const ignoreCoverage = mustBeIgnored.map((entry) => ({
  entry,
  ignored: ignored.includes(entry),
}));
if (ignoreCoverage.some((entry) => !entry.ignored)) failed = true;

// Tracked/untracked output must never include build output or dependencies.
const statusEntries = statusShort
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0)
  .map((line) => line.slice(3).trim());
const leakingEntries = statusEntries.filter(
  (entry) => entry.startsWith("node_modules/") || entry.startsWith("out/"),
);
if (leakingEntries.length > 0) failed = true;

// The project-level .pi configuration must remain versionable: only per-run goal
// state and local overrides are ignored.
const piSettingsTrackedOrUntracked = statusEntries.includes(".pi/");
const piGoalStateIgnored = ignored.some((entry) => entry.startsWith(".pi/goals"));

// ---------------------------------------------------------------------------
// Non-destructive guarantee: pi-web and its six pre-existing changed files must
// be byte-identical to the P0-01 baseline.
// ---------------------------------------------------------------------------
let baseline = null;
try {
  const output = execFileSync("node", ["evidence/p0-01/verify-baseline.mjs"], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
  baseline = JSON.parse(output);
} catch (error) {
  baseline = { passed: false, error: `${error.stdout ?? ""}${error.stderr ?? ""}` };
}
if (!baseline?.passed) failed = true;

// ---------------------------------------------------------------------------
// Evidence kept in the repository must stay text-only: no captured pixels and no
// redistributed native binaries.
// ---------------------------------------------------------------------------
const evidenceDir = join(repoRoot, "evidence");
const binaryExtensions = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".dll", ".node", ".exe", ".tgz"];
const binaryEvidence = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (binaryExtensions.some((extension) => entry.name.toLowerCase().endsWith(extension))) {
      binaryEvidence.push(full.slice(repoRoot.length + 1));
    }
  }
})(evidenceDir);
if (binaryEvidence.length > 0) failed = true;

const result = {
  capturedAt: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  packageVersion: packageJson.version,
  pinned: packageJson.devDependencies,
  runtimePinned: packageJson.dependencies,
  checks,
  buildArtifacts: { expected: artifacts, preloadIsCommonJs, mainReferencesExistingPreload },
  repositoryHygiene: {
    statusEntries,
    ignoreCoverage,
    leakingEntries,
    piSettingsPresent: piSettingsTrackedOrUntracked,
    piGoalStateIgnored,
    ignoredPaths: ignored,
  },
  nonDestructive: baseline,
  binaryEvidence,
  passed: !failed,
};

mkdirSync(here, { recursive: true });
writeFileSync(join(here, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ passed: result.passed, checks: checks.map((c) => `${c.name}: ${c.ok}`) }, null, 2));
process.exit(failed ? 1 : 0);
