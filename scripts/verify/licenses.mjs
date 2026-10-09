import { createRunDirectory } from './run-directory.mjs';
// P1-07 license inventory.
//
// Collects the license of every production dependency that would ship with pi-orb, plus the
// locked desktop driver packages, and records them with their license text location. The point is
// a release-time artefact that can be audited without re-reading node_modules by hand.
//
// Run: node scripts/verify/licenses.mjs

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, '../..');
const reportDir = createRunDirectory('packaging');
const nodeModules = join(repo, "node_modules");

/** Names that must never appear in a release notice as a redistributed component. */
const FORBIDDEN_LICENSES = [/AGPL/i, /GPL-3/i, /SSPL/i];

/**
 * Walk the production dependency graph from package.json.
 *
 * Only `dependencies` are followed: devDependencies are not shipped, so listing them would
 * overstate what is redistributed. Transitive production dependencies are included because they
 * are shipped too.
 */
function collectProductionGraph() {
  const root = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const seen = new Map();
  const queue = Object.keys(root.dependencies ?? {});

  while (queue.length > 0) {
    const name = queue.shift();
    if (!name || seen.has(name)) continue;
    const packageJsonPath = join(nodeModules, name, "package.json");
    if (!existsSync(packageJsonPath)) {
      seen.set(name, { name, missing: true });
      continue;
    }
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    seen.set(name, {
      name,
      version: pkg.version ?? null,
      license: normalizeLicense(pkg.license ?? pkg.licenses ?? null),
      homepage: typeof pkg.homepage === "string" ? pkg.homepage : null,
      repository:
        typeof pkg.repository === "string"
          ? pkg.repository
          : (pkg.repository?.url ?? null),
    });
    for (const dependency of Object.keys(pkg.dependencies ?? {})) queue.push(dependency);
    // Optional platform packages are what ship the native driver; they matter here.
    for (const dependency of Object.keys(pkg.optionalDependencies ?? {})) queue.push(dependency);
  }

  return [...seen.values()];
}

function normalizeLicense(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((entry) => entry?.type ?? String(entry)).join(" OR ");
  if (typeof value === "object" && typeof value.type === "string") return value.type;
  return JSON.stringify(value);
}

/** Find a license text file for a package, if it ships one. */
function findLicenseFile(packageName) {
  const dir = join(nodeModules, packageName);
  try {
    const entries = readdirSync(dir);
    const match = entries.find((entry) => /^(LICEN[CS]E|COPYING|NOTICE)/i.test(entry));
    if (!match) return null;
    const full = join(dir, match);
    return statSync(full).isFile() ? match : null;
  } catch {
    return null;
  }
}

const graph = collectProductionGraph().map((entry) => ({
  ...entry,
  licenseFile: entry.missing ? null : findLicenseFile(entry.name),
}));

// A declared dependency that is not installed is almost always another platform's optional
// package. That is a different fact from "installed but declares no license", and only the latter
// can affect a release, so the two are reported separately.
const installed = graph.filter((entry) => !entry.missing);
const notInstalled = graph.filter((entry) => entry.missing).map((entry) => entry.name);

const forbiddenHits = installed.filter(
  (entry) => entry.license && FORBIDDEN_LICENSES.some((pattern) => pattern.test(entry.license)),
);

const report = {
  capturedAt: new Date().toISOString(),
  method:
    "walked package.json dependencies (and optionalDependencies, which carry the native driver) transitively; devDependencies are excluded because they are not redistributed",
  productionDependencyCount: graph.length,
  installedCount: installed.length,
  packages: installed.sort((left, right) => String(left.name).localeCompare(String(right.name))),
  notInstalledOnThisPlatform: notInstalled.sort(),
  notInstalledNote:
    "these are declared optional platform packages for other operating systems and architectures; none of them is present on disk, so none ships in a Windows x64 release",
  forbiddenLicenseHits: forbiddenHits,
  packagesWithNoLicenseField: installed.filter((entry) => !entry.license).map((entry) => entry.name),
  packagesWithNoLicenseFile: installed
    .filter((entry) => entry.license && !entry.licenseFile)
    .map((entry) => ({ name: entry.name, license: entry.license })),
};

mkdirSync(reportDir, { recursive: true });
writeFileSync(join(reportDir, "license-inventory.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      productionDependencyCount: report.productionDependencyCount,
      forbiddenLicenseHits: forbiddenHits.map((entry) => `${entry.name}@${entry.version}: ${entry.license}`),
      noLicenseField: report.packagesWithNoLicenseField,
    },
    null,
    2,
  ),
);

process.exit(forbiddenHits.length === 0 ? 0 : 1);
