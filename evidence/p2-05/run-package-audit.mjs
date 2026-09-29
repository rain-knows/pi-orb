// P2-05 packaged-artifact audit.
//
// P2-05 ships a Windows distribution, so "the installer builds" is not the acceptance: the
// question is what is inside it. This audit answers four things about the built app:
//
//   1. the product is actually in there (built main/preload/renderer, the native helper script);
//   2. the license obligations travel with the artifact (LICENSE, THIRD_PARTY_NOTICES.md);
//   3. nothing that must not ship does: no repository source, no tests, no evidence, no
//      credentials or key material, no other platform's binaries, no build toolchain leftovers;
//   4. the native modules that pi-orb hard-depends on are present *unpacked*, because a `.node`
//      loaded from inside an asar archive is not a loadable image on Windows.
//
// It reads the package, it does not rebuild it. Run `npm run package:win:dir` first (or use
// `run-p2-05.mjs`, which builds and then audits).
//
// Run: node evidence/p2-05/run-package-audit.mjs

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { extractFile, listPackage } from "@electron/asar";

const evidenceDir = import.meta.dirname;
const repo = resolve(evidenceDir, "..", "..");
const packageJson = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
const appRoot = join(repo, "release", packageJson.version, "win-unpacked");
const resources = join(appRoot, "resources");
const asarPath = join(resources, "app.asar");
const unpackedRoot = join(resources, "app.asar.unpacked");
const executable = join(appRoot, "pi-orb.exe");

const audit = {
  capturedAt: new Date().toISOString(),
  version: packageJson.version,
  appRoot: relative(repo, appRoot).split("\\").join("/"),
  entries: null,
  unpacked: null,
  sizes: null,
  checks: [],
  passed: false,
};

function check(name, ok, detail) {
  audit.checks.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
}

/** Every file below `dir`, as forward-slash paths relative to `dir`; `[]` when `dir` is absent. */
function walk(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const absolute = join(dir, dirent.name);
    if (dirent.isDirectory()) {
      for (const nested of walk(absolute)) found.push(`${dirent.name}/${nested}`);
    } else if (dirent.isFile()) {
      found.push(dirent.name);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// 1. The build exists at all. A missing artifact must be a failure, not a skip.
// ---------------------------------------------------------------------------
check(
  "the unpacked Windows build exists",
  existsSync(executable) && existsSync(asarPath),
  existsSync(executable) ? relative(repo, executable).split("\\").join("/") : "run `npm run package:win:dir` first",
);

if (!existsSync(asarPath)) {
  audit.passed = false;
  writeFileSync(join(evidenceDir, "package-audit.json"), `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ passed: false, checks: audit.checks }, null, 2));
  process.exit(1);
}

// `listPackage` reports archive paths with the host separator and without a leading slash.
const entries = listPackage(asarPath, { isPack: false }).map((entry) =>
  entry.replace(/^[/\\]/u, "").split("\\").join("/"),
);
audit.entries = { count: entries.length, sample: entries.slice(0, 20) };
const unpackedFiles = walk(unpackedRoot);
audit.unpacked = unpackedFiles;

function hasEntry(predicate) {
  return entries.some(predicate);
}

// ---------------------------------------------------------------------------
// 2. The product is inside the archive, at the paths the main process resolves at runtime.
//    `out/main/native/foreground-window.ps1` is called out because a missing copy of that file
//    was a real defect in this project: the window recorder failed with "no foreground window",
//    which looks like an environment fact rather than a packaging mistake.
// ---------------------------------------------------------------------------
for (const required of [
  "package.json",
  "out/main/index.js",
  "out/main/native/foreground-window.ps1",
  "out/preload/index.js",
  "out/renderer/index.html",
]) {
  check(`the archive contains ${required}`, entries.includes(required), required);
}

check(
  "the archive contains the built renderer assets",
  hasEntry((entry) => entry.startsWith("out/renderer/assets/")),
  entries.filter((entry) => entry.startsWith("out/renderer/assets/")).join(", ") || "none",
);

// ---------------------------------------------------------------------------
// 3. Nothing that must not ship. Repository source, tests, evidence, documents and any key
//    material or local credential file are all exclusion rules, not oversights.
// ---------------------------------------------------------------------------
const forbiddenPrefixes = ["src/", "tests/", "evidence/", "doc/", "pi-package/", "release/", ".tmp/"];
for (const prefix of forbiddenPrefixes) {
  const hits = entries.filter((entry) => entry.startsWith(prefix));
  check(`the archive ships no ${prefix} files`, hits.length === 0, hits.slice(0, 5).join(", ") || "none");
}

const secretPattern = /(auth\.json|\.env($|\.)|-----BEGIN [A-Z ]*PRIVATE KEY-----|\.pem$|\.pfx$)/iu;
const secretHits = entries.filter((entry) => secretPattern.test(entry));
check("the archive ships no credential or key material", secretHits.length === 0, secretHits.join(", ") || "none");

// ---------------------------------------------------------------------------
// 4. Native modules: present, unpacked, and only for this platform. The reference project applies
//    its own runtime file policy to the same packages; the build configuration is expected to keep
//    C++ sources, vendored headers, documentation and foreign-platform binaries out.
// ---------------------------------------------------------------------------
for (const native of [
  "node_modules/koffi/build/koffi/win32_x64/koffi.node",
  "node_modules/uiohook-napi/prebuilds/win32-x64/uiohook-napi.node",
]) {
  check(`the required native binary is unpacked: ${native}`, unpackedFiles.includes(native), native);
}

const foreignBinaries = unpackedFiles.filter(
  (entry) => entry.endsWith(".node") && !/win32-x64|win32_x64/u.test(entry),
);
check(
  "no other platform's native binary ships",
  foreignBinaries.length === 0,
  foreignBinaries.slice(0, 5).join(", ") || "none",
);

const toolchainLeftovers = unpackedFiles.filter(
  (entry) => /(koffi\.(lib|exp)|\/src\/|\/vendor\/|\/doc\/|\/libuiohook\/|\/doc\/)/u.test(entry),
);
check(
  "no build toolchain, vendored sources or package documentation ship",
  toolchainLeftovers.length === 0,
  toolchainLeftovers.slice(0, 5).join(", ") || "none",
);

// ---------------------------------------------------------------------------
// 5. The shipped manifests: version agreement and the license notices as real files on disk, not
//    only in the repository.
// ---------------------------------------------------------------------------
for (const notice of ["LICENSE", "THIRD_PARTY_NOTICES.md", "CHANGELOG.md"]) {
  const absolute = join(resources, notice);
  check(`the packaged resources carry ${notice}`, existsSync(absolute), existsSync(absolute) ? `${statSync(absolute).size} bytes` : "missing");
}

const shippedManifest = JSON.parse(extractFile(asarPath, "package.json").toString("utf8"));
check(
  "the shipped manifest carries the project version",
  shippedManifest.version === packageJson.version,
  `${shippedManifest.version} vs ${packageJson.version}`,
);
check(
  "the shipped manifest names no repository-only entry point",
  shippedManifest.main === "out/main/index.js",
  String(shippedManifest.main),
);

// A credential that reached the archive would be invisible in a file listing, so scan the text
// entries that pi-orb builds itself.
const textEntries = entries.filter((entry) => /^(out\/|package\.json$)/u.test(entry) && /\.(js|json|html|css|ps1)$/u.test(entry));
const leaks = [];
for (const entry of textEntries) {
  // Extract through the archive's own separator convention.
  const text = extractFile(asarPath, entry.split("/").join("\\")).toString("utf8");
  for (const pattern of [/([A-Za-z]:\\Users\\[^"'\\\s]+)/u, /PI_ORB_PI_WEB_PASSWORD\s*[:=]\s*\S/u, /\bsk-[A-Za-z0-9]{16,}/u]) {
    const match = pattern.exec(text);
    if (match) leaks.push(`${entry}: ${match[0].slice(0, 40)}`);
  }
}
check("no built file embeds a local user path or a credential", leaks.length === 0, leaks.slice(0, 5).join(", ") || `scanned ${textEntries.length} files`);

// ---------------------------------------------------------------------------
// 6. Size record. Not a pass/fail gate — it is the fact a reviewer checks when the artifact
//    suddenly doubles because a package stopped being trimmed.
// ---------------------------------------------------------------------------
const unpackedBytes = unpackedFiles.reduce((total, entry) => total + statSync(join(unpackedRoot, entry)).size, 0);
audit.sizes = {
  executableBytes: statSync(executable).size,
  asarBytes: statSync(asarPath).size,
  unpackedNativeBytes: unpackedBytes,
  archiveEntryCount: entries.length,
};

audit.passed = audit.checks.every((entry) => entry.ok);
writeFileSync(join(evidenceDir, "package-audit.json"), `${JSON.stringify(audit, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      passed: audit.passed,
      sizes: audit.sizes,
      failed: audit.checks.filter((entry) => !entry.ok),
      passedCount: audit.checks.filter((entry) => entry.ok).length,
    },
    null,
    2,
  ),
);

process.exit(audit.passed ? 0 : 1);
