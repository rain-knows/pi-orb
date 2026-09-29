// P1-07 release gate.
//
// The executable gate for a pi-orb release. It answers the questions the development goals attach to
// P1-07 (§7.1, §7.2) plus the non-destructive contract, so "v0.1 is ready" is a reproducible fact
// rather than a statement:
//
//   - the project's own quality gates pass (typecheck, lint, tests, build);
//   - the non-destructive baseline still holds: pi-web's HEAD and its pre-existing user changes are
//     untouched;
//   - the release contains no credential, no personal screenshot and no key material;
//   - the ignore rules still exclude generated artefacts, local state and binaries;
//   - the license inventory contains no AGPL/GPL-3/SSPL component and every shipped component's
//     license is recorded;
//   - the version, the changelog and the support matrix agree with each other;
//   - the supported-version record and the unverified claims are present rather than implied.
//
// It never treats a mock as a substitute for a native check: the native acceptance records are
// required to exist and are referenced, and their unverified items are surfaced here so a release
// cannot quietly drop them.
//
// Run: node evidence/p1-07/run-release-gate.mjs

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..", "..");
const env = { ...process.env, NODE_ENV: "development" };

const gate = {
  capturedAt: new Date().toISOString(),
  projectVersion: null,
  checks: [],
  passed: false,
};

/**
 * Record one gate result.
 *
 * `skipped` marks a check that could not be performed in this environment (for example the pi-web
 * baseline, which needs a developer-local checkout). A skipped check does not fail the gate, but it
 * is counted and printed separately so a reader can never mistake "not checked here" for "passed".
 */
function check(name, ok, detail, options = {}) {
  const skipped = options.skipped === true;
  gate.checks.push({ name, ok: Boolean(ok), detail, ...(skipped ? { skipped: true } : {}) });
  return Boolean(ok);
}

function run(name, command, args, options = {}) {
  const started = Date.now();
  try {
    const output = execFileSync(command, args, {
      cwd: repo,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      maxBuffer: 32 * 1024 * 1024,
    });
    check(name, true, `${Date.now() - started} ms`);
    return { ok: true, output };
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    check(name, false, `${(output || error.message).trim().split(/\r?\n/).slice(-8).join(" | ")}`);
    return { ok: false, output };
  }
}

const packageJson = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
gate.projectVersion = packageJson.version;

// ---------------------------------------------------------------------------
// 1. Quality gates.
// ---------------------------------------------------------------------------
run("typecheck passes", "npx", ["tsc", "--noEmit"]);
run("lint passes", "npx", ["eslint", "."]);
run("unit tests pass", "npx", ["vitest", "run"]);
run("production build succeeds", "npx", ["electron-vite", "build"]);

// ---------------------------------------------------------------------------
// 2. Non-destructive baseline: pi-web untouched.
//
// The comparison runs against a developer-local pi-web checkout. Where none exists (another
// contributor, a CI runner) it is reported as *skipped with a reason* and shown in the output, never
// counted as a satisfied check — "we could not look" and "we looked and it was fine" are different
// facts, and a release gate that conflates them is worse than one without the check.
// ---------------------------------------------------------------------------
try {
  const output = execFileSync("node", ["evidence/p0-01/verify-baseline.mjs"], {
    cwd: repo,
    env,
    encoding: "utf8",
  });
  const baseline = JSON.parse(output);
  if (baseline.skipped === true) {
    check(
      "pi-web HEAD and its six pre-existing user changes are untouched",
      true,
      `skipped: ${String(baseline.reason)}`,
      { skipped: true },
    );
  } else {
    check(
      "pi-web HEAD and its six pre-existing user changes are untouched",
      baseline.passed === true,
      `headUnchanged=${String(baseline.headUnchanged)} files=${String(baseline.checkedCount)} failures=${JSON.stringify(baseline.failures ?? [])}`,
    );
  }
} catch (error) {
  check(
    "pi-web HEAD and its six pre-existing user changes are untouched",
    false,
    String(error.stdout ?? error.message).slice(0, 300),
  );
}

// ---------------------------------------------------------------------------
// 3. No secrets, no personal pixels, no key material in what ships.
// ---------------------------------------------------------------------------
const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".ps1", ".yml", ".yaml"]);
const secretPatterns = [
  { name: "private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "OpenAI-style API key", pattern: /\bsk-[A-Za-z0-9]{20,}/ },
  { name: "Anthropic-style API key", pattern: /\bsk-ant-[A-Za-z0-9-]{20,}/ },
  { name: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
];

const shipRoots = ["src", "pi-package", "tests", "doc", "evidence", "scripts"];
const shipFiles = [];
for (const root of shipRoots) {
  const absolute = join(repo, root);
  if (!existsSync(absolute)) continue;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else shipFiles.push(full);
    }
  };
  walk(absolute);
}
for (const file of ["README.md", "CHANGELOG.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "package.json"]) {
  const full = join(repo, file);
  if (existsSync(full)) shipFiles.push(full);
}

const secretHits = [];
const binaryHits = [];
const binaryExtensions = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".dll", ".node", ".exe", ".tgz", ".key", ".pem", ".pfx"];
// Product UI assets are allowed only by exact path. Test screenshots and native binaries remain rejected.
const approvedProductAssets = new Set(["src/renderer/orb-avatar.png"]);
for (const file of shipFiles) {
  const name = file.toLowerCase();
  if (binaryExtensions.some((extension) => name.endsWith(extension))) {
    const relativePath = relative(repo, file).split("\\").join("/");
    if (!approvedProductAssets.has(relativePath)) binaryHits.push(relativePath);
    continue;
  }
  if (!textExtensions.has(name.slice(name.lastIndexOf("."))) && !name.endsWith("license")) continue;
  const content = readFileSync(file, "utf8");
  for (const { name: patternName, pattern } of secretPatterns) {
    if (pattern.test(content)) secretHits.push(`${relative(repo, file)}: ${patternName}`);
  }
}

check("no credential or key material is present in the shipped tree", secretHits.length === 0, JSON.stringify(secretHits.slice(0, 10)));
check(
  "no unapproved screenshot, native binary or archive is committed",
  binaryHits.length === 0,
  JSON.stringify(binaryHits.slice(0, 10)),
);
check(
  "the credential files that must never be committed are absent",
  !existsSync(join(repo, "auth.json")) && !existsSync(join(repo, ".env")),
  "auth.json and .env must not exist in the repository",
);

// ---------------------------------------------------------------------------
// 4. Ignore rules still exclude what must not ship.
// ---------------------------------------------------------------------------
try {
  const ignored = execFileSync("git", ["status", "--porcelain", "--ignored"], { cwd: repo, encoding: "utf8" })
    .split(/\r?\n/)
    .filter((line) => line.startsWith("!!"))
    .map((line) => line.slice(3).trim());
  const mustIgnore = ["node_modules/", "out/"];
  const missing = mustIgnore.filter((entry) => !ignored.includes(entry));
  check("the release ignore rules exclude dependencies and build output", missing.length === 0, JSON.stringify({ missing, ignored: ignored.slice(0, 12) }));

  const tracked = execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" })
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3).trim());
  const leaking = tracked.filter((entry) => entry.startsWith("node_modules/") || entry.startsWith("out/"));
  check("no build output or dependency directory is staged for release", leaking.length === 0, JSON.stringify(leaking));
} catch (error) {
  check("the release ignore rules exclude dependencies and build output", false, String(error.message).slice(0, 200));
}

// ---------------------------------------------------------------------------
// 5. License inventory.
// ---------------------------------------------------------------------------
try {
  const inventoryPath = join(repo, "evidence/p1-07/license-inventory.json");
  if (!existsSync(inventoryPath)) {
    check("the license inventory is present and auditable", false, "evidence/p1-07/license-inventory.json is missing; run collect-licenses.mjs");
  } else {
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
    check(
      "the license inventory records every installed production dependency",
      typeof inventory.installedCount === "number" && inventory.installedCount > 0 && Array.isArray(inventory.packages),
      `${inventory.installedCount} installed components`,
    );
    check(
      "no AGPL, GPL-3 or SSPL component is present",
      Array.isArray(inventory.forbiddenLicenseHits) && inventory.forbiddenLicenseHits.length === 0,
      JSON.stringify(inventory.forbiddenLicenseHits ?? []),
    );
    check(
      "every installed production dependency declares a license",
      Array.isArray(inventory.packagesWithNoLicenseField) && inventory.packagesWithNoLicenseField.length === 0,
      JSON.stringify(inventory.packagesWithNoLicenseField ?? []),
    );
    check(
      "the MPL-2.0 components are named with their source location",
      existsSync(join(repo, "THIRD_PARTY_NOTICES.md")) &&
        /MPL-2\.0/.test(readFileSync(join(repo, "THIRD_PARTY_NOTICES.md"), "utf8")) &&
        /uniffi-bindgen-react-native/.test(readFileSync(join(repo, "THIRD_PARTY_NOTICES.md"), "utf8")),
      "THIRD_PARTY_NOTICES.md must name the MPL components and how to obtain their source",
    );
  }
} catch (error) {
  check("the license inventory is present and auditable", false, String(error.message).slice(0, 200));
}

check(
  "the project ships its own license text",
  existsSync(join(repo, "LICENSE")) && /MIT License/.test(readFileSync(join(repo, "LICENSE"), "utf8")),
  "package.json declares MIT, so a LICENSE file must exist",
);

// ---------------------------------------------------------------------------
// 6. Version maintenance: version, changelog and support matrix agree.
// ---------------------------------------------------------------------------
const changelog = readFileSync(join(repo, "CHANGELOG.md"), "utf8");
check(
  "the changelog records the current version as unreleased or released",
  changelog.includes("## [Unreleased]") || changelog.includes(`## [${packageJson.version}]`),
  `version ${packageJson.version}`,
);

const supportMatrix = readFileSync(join(repo, "doc/support-matrix.md"), "utf8");
check(
  "the support matrix records the project version",
  supportMatrix.includes(packageJson.version),
  `looked for ${packageJson.version}`,
);
check(
  "the support matrix records the reference desktop backend commit",
  supportMatrix.includes("72f1d738458a223696685a909e806b683eff5885"),
  "the reference backend commit must appear in the support record",
);
check(
  "the support matrix distinguishes verified from unverified combinations",
  /未验证/.test(supportMatrix) && /已验证/.test(supportMatrix),
  "a matrix that lists only verified rows would hide the gaps",
);

// The changelog must describe the same pinned set, or a release could claim a version the code does
// not use.
const pinned = { ...packageJson.dependencies, ...packageJson.devDependencies };
check(
  "the removed Cua driver is absent from the production dependency graph",
  !Object.prototype.hasOwnProperty.call(pinned, "@trycua/cua-driver"),
  String(pinned["@trycua/cua-driver"] ?? "absent"),
);
check(
  "Electron is pinned to the version the native checks used",
  pinned.electron === "44.4.5",
  String(pinned.electron),
);
check(
  "the Pi SDK is pinned to the version the pi-web baseline uses",
  pinned["@earendil-works/pi-coding-agent"] === "0.87.1",
  String(pinned["@earendil-works/pi-coding-agent"]),
);

// ---------------------------------------------------------------------------
// 7. Native acceptance records must exist, and their gaps must be carried forward.
// ---------------------------------------------------------------------------
const requiredEvidence = [
  { path: "evidence/p1-03/result.json", what: "wake shortcut registration on the real OS" },
  { path: "evidence/p1-04/result.json", what: "screenshot authorization and refusal paths" },
  { path: "evidence/p1-05/input-verification.json", what: "real-machine input acceptance" },
  { path: "evidence/p1-06/loop-verification.json", what: "desktop tool loop" },
  { path: "evidence/p1-06/tool-exposure.json", what: "Orb tool exposure" },
  { path: "evidence/p2-04/README.md", what: "P2-04 action scope and unverified image-return boundary" },
  { path: "evidence/p1-07/lifecycle-regression.json", what: "collapse, stop and generation lifecycle" },
  { path: "evidence/p1-07/license-inventory.json", what: "third-party license inventory" },
  { path: "evidence/p1-07/CONTRACT-MATRIX.md", what: "N1-N8 and §7.1 contract cross-check" },
];
const missingEvidence = requiredEvidence.filter((entry) => !existsSync(join(repo, entry.path))).map((entry) => entry.path);
check(
  "every native acceptance record exists",
  missingEvidence.length === 0,
  JSON.stringify(missingEvidence),
);

// The unverified items have to be visible in the release records, not only in a conversation.
const unverifiedRecords = [
  { path: "evidence/p1-05/README.md", fragment: "明确未验证" },
  { path: "evidence/p1-06/README.md", fragment: "明确未验证" },
];
const missingUnverified = unverifiedRecords.filter(
  (entry) => !existsSync(join(repo, entry.path)) || !readFileSync(join(repo, entry.path), "utf8").includes(entry.fragment),
);
check(
  "the native acceptance records keep their unverified items",
  missingUnverified.length === 0,
  JSON.stringify(missingUnverified.map((entry) => entry.path)),
);

// ---------------------------------------------------------------------------
// 8. Release hygiene: the packaging script and its inputs exist and are wired.
// ---------------------------------------------------------------------------
check(
  "the .gitignore excludes local agent goal state while keeping project .pi configuration versionable",
  (() => {
    const ignore = readFileSync(join(repo, ".gitignore"), "utf8");
    return /\.pi\/goals\//.test(ignore) && !/^\.pi\/$/m.test(ignore);
  })(),
  "ignoring all of .pi would make future project configuration unversionable",
);

const readme = readFileSync(join(repo, "README.md"), "utf8");
check(
  "the README states the status truthfully",
  /P1/.test(readme) && /unverified/i.test(readme),
  "a release README must not present unverified capability as working",
);
check(
  "the README points at the reference playbook that governs reuse",
  readme.includes("doc/reference-playbook.md"),
  "the reuse-first entry point must be reachable from the README",
);

// The reference playbook is the reuse-first entry point: it must record the pinned reference commit,
// and the agent instructions must record where the local checkout lives and point at the playbook.
// Without this an agent could start work without ever locating the reference source.
const playbookPath = join(repo, "doc/reference-playbook.md");
const playbook = existsSync(playbookPath) ? readFileSync(playbookPath, "utf8") : "";
check(
  "the reference playbook exists and pins the reference commit",
  playbook.includes("72f1d738458a223696685a909e806b683eff5885"),
  "doc/reference-playbook.md must name the pinned reference commit",
);
check(
  "the reference playbook keeps the reuse index, the port procedure and the pre-commit checklist",
  ["方面", "取材优先级", "常见开发任务的作业流程", "提交前检查清单"].every((fragment) =>
    playbook.includes(fragment),
  ),
  "dropping a section would turn the playbook into prose instead of a working index",
);
const agentInstructions = readFileSync(join(repo, "AGENTS.md"), "utf8");
check(
  "the agent instructions record the local reference checkout and the playbook entry point",
  agentInstructions.includes("D:\\pi-orb-ref\\deepseek-harness-orb") &&
    agentInstructions.includes("doc/reference-playbook.md"),
  "AGENTS.md must name the durable checkout location and the playbook",
);

// P2-05 packaging. A distribution config is not a release artefact by itself, but three of its
// properties are load-bearing: native modules must be unpacked or the packaged app cannot load
// koffi (proved by deleting the unpacked binary — the desktop call then fails), the install must
// stay per-user and non-elevating, and the shipped binary must be the one the evidence describes
// rather than a fresh from-source rebuild.
const builderConfigPath = join(repo, "electron-builder.config.mjs");
const builderConfig = existsSync(builderConfigPath) ? readFileSync(builderConfigPath, "utf8") : "";
check(
  "the packaging configuration exists and derives from the reference config",
  builderConfig.includes("72f1d738458a223696685a909e806b683eff5885") &&
    builderConfig.includes("electron-builder-config.mjs"),
  "electron-builder.config.mjs must record the reference file and commit it follows",
);
check(
  "the packaging keeps native modules outside the archive",
  /asarUnpack:\s*\[[^\]]*\*\*\/\*\.\{node,dll,exe\}/.test(builderConfig),
  "without the unpack glob the packaged app cannot load koffi",
);
check(
  "the packaging stays per-user, non-elevating and unsigned-only",
  /perMachine:\s*false/.test(builderConfig) &&
    /allowElevation:\s*false/.test(builderConfig) &&
    /publish:\s*null/.test(builderConfig),
  "an installer that elevates or publishes is a different, unreviewed release shape",
);
check(
  "the packaging does not rebuild the native modules it ships",
  /npmRebuild:\s*false/.test(builderConfig),
  "a from-source rebuild would replace the binaries every native evidence run used",
);
check(
  "the packaging trims third-party build residue",
  builderConfig.includes("node_modules/koffi/src/**") && builderConfig.includes("node_modules/uiohook-napi/libuiohook/**"),
  "electron-builder's smart unpack would otherwise ship C++ sources and foreign-platform binaries",
);
check(
  "the built package output is not versioned",
  /^release\/$/m.test(readFileSync(join(repo, ".gitignore"), "utf8")),
  "installers and unpacked trees must stay out of the repository",
);

// Continuous integration. A workflow that names the wrong commands, drops the release gate, or
// quietly stops reproducing the documented local gates is worse than no workflow, because the green
// badge would then stand for something nobody can reproduce.
const ciPath = join(repo, ".github/workflows/ci.yml");
const ci = existsSync(ciPath) ? readFileSync(ciPath, "utf8") : "";
check(
  "continuous integration exists and runs the documented gates",
  ["npm run typecheck", "npm run lint", "npm test", "run-release-gate.mjs"].every((command) => ci.includes(command)),
  "the workflow must run the same gates a contributor runs locally",
);
check(
  "continuous integration is scoped to read-only permissions and does not persist credentials",
  /permissions:\s*\n\s*contents:\s*read/.test(ci) && /persist-credentials:\s*false/.test(ci),
  "a pull-request workflow needs no write token and must not leave one in the checkout",
);
check(
  "continuous integration does not promise a platform the product does not support",
  /runs-on:\s*windows-latest/.test(ci),
  "Windows is the only supported platform, so a Linux run would not verify the shipped product",
);

// Contributor-facing documents. A public project needs a stated contribution contract and a stated
// security boundary; both are also where the non-destructive rules and the "not a sandbox" limits are
// written down for someone who has not read the goals document.
const contributing = existsSync(join(repo, "CONTRIBUTING.md")) ? readFileSync(join(repo, "CONTRIBUTING.md"), "utf8") : "";
const contributingZh = existsSync(join(repo, "CONTRIBUTING.zh.md")) ? readFileSync(join(repo, "CONTRIBUTING.zh.md"), "utf8") : "";
check(
  "the contribution contract exists and points contributors at the reuse rules",
  contributing.includes("reference-playbook.md") && contributing.includes("support-matrix.md"),
  "a contributor must be sent to the playbook and the single support source before writing code",
);
check(
  "the contribution contract keeps the no-weakened-assertions rule and the unverified rule",
  /weaken an assertion/i.test(contributing) && /unverified/i.test(contributing),
  "these two rules are what keep the evidence honest",
);
check(
  "the contribution contract is available in the repository's primary documentation language",
  contributingZh.length > 0 && contributingZh.includes("reference-playbook.md"),
  "the project's own docs are Chinese-first, so the guide is bilingual like the reference project's",
);
const security = existsSync(join(repo, "SECURITY.md")) ? readFileSync(join(repo, "SECURITY.md"), "utf8") : "";
check(
  "the security policy states the boundary rather than only a contact route",
  /not a filesystem sandbox/i.test(security) && /untrusted input/i.test(security) && /advisories\/new/.test(security),
  "a policy that only says 'email us' would hide the limits the product actually has",
);
check(
  "the security policy lists the wrong-target and stuck-key classes as in scope",
  /different window or application/i.test(security) && /left held/i.test(security),
  "these are the two defect classes this product exists to avoid",
);

// Preview release path. A published binary is the most public thing this project produces, so the
// workflow that writes it is held to four properties: it is a deliberate act, it re-verifies the
// artifact it publishes instead of trusting the author's committed records, it publishes as a
// prerelease because the gate for a complete v0.1 is not satisfied, and it cannot drop the
// unverified list from the notes.
const releasePath = join(repo, ".github/workflows/release-preview.yml");
const release = existsSync(releasePath) ? readFileSync(releasePath, "utf8") : "";
check(
  "the release workflow exists and is manually triggered",
  release.includes("workflow_dispatch"),
  "a release is a decision; it must not happen automatically on every push",
);
check(
  "the release workflow re-verifies the artifact on the release machine",
  release.includes("run-p2-05.mjs") && release.includes("package-audit") && release.includes("packaged-smoke"),
  "the committed P2-05 records describe the author's machine, not the published build",
);
check(
  "the release workflow publishes a prerelease and cannot drop the unverified list",
  /--prerelease/.test(release) && /未验证/.test(release) && /single source of truth/.test(release),
  "the notes must say this is not a complete v0.1 and point at the list that says what is missing",
);
check(
  "the release workflow gates on the release gate and requires an explicit unsigned confirmation",
  release.includes("run-release-gate.mjs") && /confirm_unsigned/.test(release),
  "never publish from a tree that fails its own gate, and publishing an unsigned binary must be deliberate",
);
const releaseDocPath = join(repo, "doc/release-process.md");
check(
  "the release process is documented where a maintainer will find it",
  existsSync(releaseDocPath) &&
    /重新验证/.test(readFileSync(releaseDocPath, "utf8")) &&
    /未签名/.test(readFileSync(releaseDocPath, "utf8")),
  "the reasoning for re-verifying on the release machine and the unsigned status must be written down",
);
check(
  "the packaging scripts run the build before packing",
  /"package:win":\s*"npm run build && electron-builder/.test(readFileSync(join(repo, "package.json"), "utf8")) &&
    /"package:win:dir":\s*"npm run build && electron-builder/.test(readFileSync(join(repo, "package.json"), "utf8")),
  "packing a stale out/ directory would ship code that was never built",
);
const p2_05Required = [
  "evidence/p2-05/README.md",
  "evidence/p2-05/run-p2-05.mjs",
  "evidence/p2-05/package-audit.json",
  "evidence/p2-05/packaged-smoke.json",
  "doc/p2-05-distribution.md",
];
const missingP2_05 = p2_05Required.filter((path) => !existsSync(join(repo, path)));
check("the P2-05 distribution records exist", missingP2_05.length === 0, JSON.stringify(missingP2_05));
const packageAudit = existsSync(join(repo, "evidence/p2-05/package-audit.json"))
  ? JSON.parse(readFileSync(join(repo, "evidence/p2-05/package-audit.json"), "utf8"))
  : null;
check(
  "the recorded packaged-artifact audit passed and carries its native-binary checks",
  packageAudit?.passed === true &&
    (packageAudit.checks ?? []).some((entry) => entry.name.includes("koffi.node") && entry.ok),
  JSON.stringify({ passed: packageAudit?.passed, checks: packageAudit?.checks?.length ?? 0 }),
);
const packagedSmoke = existsSync(join(repo, "evidence/p2-05/packaged-smoke.json"))
  ? JSON.parse(readFileSync(join(repo, "evidence/p2-05/packaged-smoke.json"), "utf8"))
  : null;
check(
  "the recorded packaged-application probe passed and still lists real windows",
  packagedSmoke?.passed === true &&
    (packagedSmoke.checks ?? []).some((entry) => entry.name.includes("lists real windows") && entry.ok),
  JSON.stringify({ passed: packagedSmoke?.passed, checks: packagedSmoke?.checks?.length ?? 0 }),
);
const manual = readFileSync(join(repo, "doc/manual-acceptance.md"), "utf8");
check(
  "the installer steps that cannot be automated are recorded as manual",
  manual.includes("E 组") && /未验证/.test(manual),
  "clean-machine install, uninstall and SmartScreen must stay manual and unverified",
);

// The contract cross-check has to exist and has to keep its unverified rows, so a release cannot
// drop the N1-N8 comparison or the §7.1 coverage table to look complete.
const contractMatrixPath = join(repo, "evidence/p1-07/CONTRACT-MATRIX.md");
if (existsSync(contractMatrixPath)) {
  const matrix = readFileSync(contractMatrixPath, "utf8");
  const invariantRows = ["N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8"].filter((name) =>
    new RegExp(`\\*\\*${name}\\*\\*`).test(matrix),
  );
  check(
    "the contract matrix covers every non-destructive invariant N1-N8",
    invariantRows.length === 8,
    JSON.stringify(invariantRows),
  );
  check(
    "the contract matrix keeps its partially-verified and unverified rows visible",
    /\*\*部分\*\*/.test(matrix) && /未验证/.test(matrix),
    "a matrix listing only passes would hide the gaps",
  );
  check(
    "the contract matrix covers the §7.1 test classes",
    ["普通 Web 非破坏性", "cwd 与模式", "生命周期", "工具选择", "图像", "原生输入", "快捷键", "进程与认证", "打包／卸载"].every(
      (name) => matrix.includes(name),
    ),
    "every §7.1 test class must be accounted for",
  );
} else {
  check("the contract matrix covers every non-destructive invariant N1-N8", false, "CONTRACT-MATRIX.md is missing");
  check("the contract matrix keeps its partially-verified and unverified rows visible", false, "CONTRACT-MATRIX.md is missing");
  check("the contract matrix covers the §7.1 test classes", false, "CONTRACT-MATRIX.md is missing");
}

// ---------------------------------------------------------------------------
// 9. Uninstall safety: the product's write surface must be confined to its own data directory and
//    the workspace the user explicitly confirmed. Nothing may write into pi-web, its node_modules,
//    or a workspace the user did not choose.
// ---------------------------------------------------------------------------
const productSources = [];
for (const root of ["src/main", "pi-package/extensions"]) {
  const absolute = join(repo, root);
  if (!existsSync(absolute)) continue;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.[cm]?ts$/.test(entry.name)) productSources.push(full);
    }
  };
  walk(absolute);
}

// Write calls are the only way to change anything on disk, so they are what the audit inspects.
const writeCallPattern = /\b(writeFileSync|mkdirSync|renameSync|rmSync|unlinkSync|appendFileSync|createWriteStream)\s*\(/g;
const writeCalls = [];
for (const file of productSources) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(writeCallPattern)) {
    const line = content.slice(0, match.index).split(/\r?\n/).length;
    writeCalls.push({ file: relative(repo, file), line, call: match[1], text: content.split(/\r?\n/)[line - 1].trim() });
  }
}

// The store owns the resolved path, so writes there are inside the Orb data directory by
// construction. The workspace creation is the one user-directed write.
const allowedWriteFiles = new Set([
  "src/main/config-store.ts",
  "src/main/bridge-server.ts",
  "src/main/workspace.ts",
]);

// `relative` yields backslashes on Windows, so paths are normalized before comparison: comparing
// a backslash path against a forward-slash allowlist silently reported every file as unexpected.
const toPosix = (path) => path.split(/\\/).join("/");
const unexpectedWriteFiles = [...new Set(writeCalls.map((entry) => toPosix(entry.file)))].filter(
  (file) => !allowedWriteFiles.has(file),
);
check(
  "product writes only happen in the modules that own the Orb data directory and the chosen workspace",
  unexpectedWriteFiles.length === 0,
  JSON.stringify({ writeFiles: [...new Set(writeCalls.map((entry) => toPosix(entry.file)))], unexpected: unexpectedWriteFiles }),
);

// No write call may target a pi-web path. A string mentioning pi-web in a comment is fine; a write
// whose argument names one is not.
const piWebWriteCalls = writeCalls.filter((entry) => /pi-web|node_modules/i.test(entry.text));
check(
  "no product write targets pi-web or a node_modules path",
  piWebWriteCalls.length === 0,
  JSON.stringify(piWebWriteCalls),
);

check(
  "the workspace is only created after explicit confirmation",
  /function createWorkspace\(\s*candidate: string,\s*confirmed: boolean/.test(
    readFileSync(join(repo, "src/main/workspace.ts"), "utf8"),
  ) && /if \(!confirmed\)/.test(readFileSync(join(repo, "src/main/workspace.ts"), "utf8")),
  "workspace creation must be gated on a confirmation flag",
);

gate.writeSurface = {
  writeCallCount: writeCalls.length,
  files: [...new Set(writeCalls.map((entry) => toPosix(entry.file)))].sort(),
  note: "the Orb data directory is Electron userData; the workspace is created only after an explicit user confirmation, so uninstalling leaves the workspace, pi-web and pi-web's node_modules untouched",
};

gate.passed = gate.checks.every((entry) => entry.ok);
gate.summary = {
  passed: gate.checks.filter((entry) => entry.ok && entry.skipped !== true).length,
  skipped: gate.checks.filter((entry) => entry.skipped === true).length,
  failed: gate.checks.filter((entry) => !entry.ok).length,
  version: packageJson.version,
  note: "this gate checks what can be automated; the manual steps for the unverified capability are recorded in the corresponding evidence README files. `skipped` counts checks that could not run in this environment and are explicitly NOT counted as passed",
};

mkdirSync(import.meta.dirname, { recursive: true });
writeFileSync(join(import.meta.dirname, "release-gate.json"), `${JSON.stringify(gate, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      passed: gate.passed,
      summary: gate.summary,
      failed: gate.checks.filter((entry) => !entry.ok),
      skipped: gate.checks.filter((entry) => entry.skipped === true).map((entry) => `${entry.name} — ${entry.detail}`),
    },
    null,
    2,
  ),
);

process.exit(gate.passed ? 0 : 1);
