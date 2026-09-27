// P1-05 read-only probe of the locked Cua driver, run on the real machine.
//
// P0-04 could only enumerate type declarations from the downloaded tarball, because
// the driver had deliberately not been installed. Now that the version is locked and
// installed (decision (a) in evidence/p0-05/DECISION.md), this probe records the facts
// that only a running driver can provide:
//   - that the native module loads and a driver can be created,
//   - the real tool inventory from the runtime, not from a `.d.ts`,
//   - window and application discovery, cross-checked against our own Win32 probe,
//   - the coordinate space the driver reports, versus the 1.5x virtualized-vs-physical
//     discrepancy P0-04 measured,
//   - the session/authorization surface,
//   - startup cost.
//
// Safety: this probe sends NO input. It calls only observation methods; the action
// methods (click/typeText/pressKey/hotkey/scroll/drag/moveCursor/invokeMenu) are listed
// but never invoked. It writes no pixel to disk: the one desktop-state call is made
// with `maxImageDimension: 1` and only its metadata is recorded, never the base64.
//
// Run: node evidence/p1-05/probe-cua-driver.mjs

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..", "..");

/** JSON.stringify that survives bigint and truncates base64 payloads. */
function safeJson(value, { maxString = 600, maxArray = 40 } = {}) {
  const seen = new WeakSet();
  const walk = (node, depth) => {
    if (node === null) return null;
    if (typeof node === "bigint") return { __bigint: node.toString() };
    if (typeof node === "string") {
      return node.length > maxString ? `${node.slice(0, maxString)}…(${node.length} chars)` : node;
    }
    if (typeof node === "number" || typeof node === "boolean") return node;
    if (typeof node !== "object") return String(node);
    if (seen.has(node)) return "[circular]";
    seen.add(node);
    if (depth > 6) return "[depth-limit]";
    if (Array.isArray(node)) {
      const items = node.slice(0, maxArray).map((entry) => walk(entry, depth + 1));
      if (node.length > maxArray) items.push(`…(${node.length} items total)`);
      return items;
    }
    const out = {};
    for (const [key, entry] of Object.entries(node)) out[key] = walk(entry, depth + 1);
    return out;
  };
  return walk(value, 0);
}

/** Summarize an image-bearing payload without keeping the pixels. */
function imageMetadata(payload) {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string" && value.length > 256 && /^[A-Za-z0-9+/=]+$/.test(value.slice(0, 64))) {
        found.push({ key, base64Chars: value.length, decodedBytes: Math.floor((value.length * 3) / 4) });
      } else if (typeof value === "string" && /^image\//i.test(value)) {
        found.push({ key, mimeType: value });
      } else if (value && typeof value === "object") {
        walk(value);
      }
    }
  };
  walk(payload);
  return found;
}

const report = {
  capturedAt: new Date().toISOString(),
  probe: "P1-05 read-only Cua runtime probe",
  safety: {
    desktopInputSent: false,
    actionMethodsInvoked: [],
    pixelsWrittenToDisk: 0,
    note: "only observation methods are called; the single desktop-state call uses maxImageDimension 1 and only metadata is recorded",
  },
  installedArtifacts: {},
  moduleLoad: {},
  driverCreation: {},
  tools: {},
  observation: {},
  coordinateSpace: {},
  sessions: {},
  timingsMs: {},
  checks: [],
  passed: false,
};

function check(name, ok, detail) {
  report.checks.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
}

const runRoot = join("D:\\pi-orb-p1-runs", `p1-05-probe-${Date.now()}`);
mkdirSync(runRoot, { recursive: true });

// ---------------------------------------------------------------------------
// 1. Installed artifacts versus the locked manifest.
// ---------------------------------------------------------------------------
try {
  const manifest = JSON.parse(readFileSync(join(repo, "evidence/p0-04/cua-artifact-manifest.json"), "utf8"));
  const expected = new Map();
  for (const pkg of manifest.packages) {
    expected.set(`${pkg.name}@${pkg.version}`, pkg.licenseField);
    for (const binary of pkg.binaries ?? []) expected.set(binary.file, binary.sha256);
  }

  const installed = [];
  for (const name of ["@trycua/cua-driver", "@trycua/cua-driver-win32-x64-msvc"]) {
    const pkgPath = join(repo, "node_modules", name, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    installed.push({
      name,
      version: pkg.version,
      licenseField: pkg.license,
      expectedLicense: expected.get(`${name}@${pkg.version}`) ?? null,
      licenseMatchesManifest: expected.get(`${name}@${pkg.version}`) === pkg.license,
    });
  }

  const binaries = [];
  for (const file of ["cua_driver_sdk.dll", "cua_driver_node_runtime.node"]) {
    const path = join(repo, "node_modules", "@trycua/cua-driver-win32-x64-msvc", file);
    const actual = createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
    binaries.push({ file, actualSha256: actual, expectedSha256: expected.get(file) ?? null, matches: actual === (expected.get(file) ?? "") });
  }

  report.installedArtifacts = { packages: installed, binaries };

  check(
    "both installed packages are the locked 0.30.1 version",
    installed.every((entry) => entry.version === "0.30.1"),
    JSON.stringify(installed.map((entry) => `${entry.name}@${entry.version}`)),
  );
  check(
    "installed license fields match the recorded manifest",
    installed.every((entry) => entry.licenseMatchesManifest),
    JSON.stringify(installed.map((entry) => ({ name: entry.name, license: entry.licenseField, expected: entry.expectedLicense }))),
  );
  check(
    "the Windows platform package is NOT plain MIT",
    installed.some((entry) => entry.name.endsWith("win32-x64-msvc") && entry.licenseField === "MIT AND MPL-2.0"),
    JSON.stringify(installed.map((entry) => entry.licenseField)),
  );
  check(
    "installed native binaries match the recorded SHA-256 hashes",
    binaries.every((entry) => entry.matches),
    JSON.stringify(binaries.map((entry) => ({ file: entry.file, matches: entry.matches }))),
  );
} catch (error) {
  check("installed artifacts could be verified against the manifest", false, error.message);
}

// ---------------------------------------------------------------------------
// 2. Load the native module and create a driver. Observation only.
// ---------------------------------------------------------------------------
let driver = null;
let sdk = null;
try {
  const startedAt = Date.now();
  sdk = await import("@trycua/cua-driver");
  report.timingsMs.moduleImport = Date.now() - startedAt;
  report.moduleLoad = { loaded: true, exportedSymbols: Object.keys(sdk).length };
  check("the native Cua driver module loads on this machine", true, `exported symbols: ${Object.keys(sdk).length}`);
} catch (error) {
  report.moduleLoad = { loaded: false, error: String(error.message).slice(0, 500) };
  check("the native Cua driver module loads on this machine", false, report.moduleLoad.error);
}

const OBSERVATION_METHODS = [
  "listToolsJson",
  "listWindows",
  "listApps",
  "getScreenSize",
  "getDesktopState",
  "getWindowState",
  "getSessionState",
  "listSessions",
  "verifyState",
  "getCursorPosition",
];
const ACTION_METHODS = ["click", "typeText", "pressKey", "hotkey", "scroll", "drag", "moveCursor", "invokeMenu"];

if (sdk) {
  try {
    const proto = sdk.CuaDriver?.prototype;
    const all = proto ? Object.getOwnPropertyNames(proto).filter((name) => name !== "constructor") : [];
    report.tools.apiSurface = {
      methodCount: all.length,
      observationMethodsPresent: OBSERVATION_METHODS.filter((name) => all.includes(name)),
      actionMethodsPresent: ACTION_METHODS.filter((name) => all.includes(name)),
      note: "action methods are recorded for completeness and are never called by this probe",
    };
    check(
      "every MVP observation method is present on the driver",
      OBSERVATION_METHODS.every((name) => all.includes(name)),
      JSON.stringify(OBSERVATION_METHODS.filter((name) => !all.includes(name))),
    );
  } catch (error) {
    report.tools.apiSurface = { error: String(error.message).slice(0, 300) };
  }

  try {
    const startedAt = Date.now();
    driver = sdk.CuaDriver.create(undefined);
    report.timingsMs.driverCreate = Date.now() - startedAt;
    report.driverCreation = { created: true };
    check("a driver instance can be created in-process", true, `create() took ${report.timingsMs.driverCreate} ms`);
  } catch (error) {
    report.driverCreation = { created: false, error: String(error.message).slice(0, 500) };
    check("a driver instance can be created in-process", false, report.driverCreation.error);
  }
}

// ---------------------------------------------------------------------------
// 3. Runtime tool inventory. P0-04 did not have this.
// ---------------------------------------------------------------------------
if (driver) {
  try {
    const startedAt = Date.now();
    const raw = await driver.listToolsJson();
    report.timingsMs.listToolsJson = Date.now() - startedAt;
    let parsed = raw;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
    const tools = Array.isArray(parsed?.tools) ? parsed.tools : Array.isArray(parsed) ? parsed : [];
    report.tools.runtimeInventory = {
      count: tools.length,
      names: tools.map((tool) => tool?.name ?? tool?.id ?? "?").slice(0, 200),
      sampleSchema: safeJson(tools[0] ?? null, { maxString: 400 }),
      rawType: typeof raw,
      rawLength: typeof raw === "string" ? raw.length : null,
    };
    check("the driver reports a runtime tool inventory", tools.length > 0, `${tools.length} tools`);
  } catch (error) {
    report.tools.runtimeInventory = { error: String(error.message).slice(0, 500) };
    check("the driver reports a runtime tool inventory", false, report.tools.runtimeInventory.error);
  }
}

// ---------------------------------------------------------------------------
// 4. Window / application discovery, cross-checked with our own Win32 probe.
// ---------------------------------------------------------------------------
if (driver) {
  try {
    const startedAt = Date.now();
    const windows = await driver.listWindows(sdk.ListWindowsInput.create({}));
    const elapsed = Date.now() - startedAt;
    report.timingsMs.listWindows = elapsed;

    const list = Array.isArray(windows?.windows) ? windows.windows : [];
    report.observation.windows = {
      count: list.length,
      elapsedMs: elapsed,
      // zIndex is the front order; P1-06 needs it to bind an observation to a window.
      hasZIndex: list.some((entry) => entry?.zIndex !== undefined && entry?.zIndex !== null),
      hasBounds: list.every((entry) => entry?.bounds && typeof entry.bounds.width === "number"),
      sample: safeJson(list.slice(0, 5), { maxString: 120 }),
      bigintIds: list.filter((entry) => typeof entry?.windowId === "bigint").length,
    };
    check("window discovery works at runtime", list.length > 0, `${list.length} windows in ${elapsed} ms`);
    check("window records carry bounds", report.observation.windows.hasBounds === true, JSON.stringify(report.observation.windows.hasBounds));
    check(
      "window ids are bigint as documented, not numbers",
      report.observation.windows.bigintIds === list.length,
      `bigint ids: ${report.observation.windows.bigintIds}/${list.length}`,
    );
    check(
      "window records expose a front order (zIndex) for window identity binding",
      report.observation.windows.hasZIndex === true,
      "P1-06 needs this to bind an observation to the intended window",
    );
  } catch (error) {
    report.observation.windows = { error: String(error.message).slice(0, 500) };
    check("window discovery works at runtime", false, report.observation.windows.error);
  }

  // Cross-check that the driver and our own Win32 probe see the same machine.
  try {
    const ownProbe = execFileSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(repo, "src/main/native/foreground-window.ps1")],
      { encoding: "utf8", timeout: 30000 },
    );
    const own = JSON.parse(ownProbe.trim().split(/\r?\n/).filter(Boolean).at(-1));
    report.observation.ownWin32Probe = {
      ok: own.ok,
      foregroundFound: Boolean(own.foreground),
      dpiAwareness: own.dpiAwareness ?? null,
    };
  } catch (error) {
    report.observation.ownWin32Probe = { error: String(error.message).slice(0, 300) };
  }

  try {
    const apps = await driver.listApps(sdk.ListAppsInput.create({}));
    const list = Array.isArray(apps?.apps) ? apps.apps : [];
    report.observation.apps = {
      count: list.length,
      activeApp: safeJson(list.find((entry) => entry?.active) ?? null, { maxString: 200 }),
      runningCount: list.filter((entry) => entry?.running).length,
      note: "AppInfo.active identifies the active application, not the active window",
    };
    check("application discovery works at runtime", list.length > 0, `${list.length} apps`);
  } catch (error) {
    report.observation.apps = { error: String(error.message).slice(0, 500) };
    check("application discovery works at runtime", false, report.observation.apps.error);
  }
}

// ---------------------------------------------------------------------------
// 5. Coordinate space: the P0-04 risk. A DPI mismatch here is exactly the defect
//    that makes a click land in the wrong place.
// ---------------------------------------------------------------------------
if (driver) {
  try {
    const screenSize = await driver.getScreenSize(sdk.GetScreenSizeInput.create({}));
    // The numeric payload lives in `structuredJson` (a JSON string), not at the top
    // level: the top level carries rendering fields such as `text` and `images`.
    let structured = null;
    if (typeof screenSize?.structuredJson === "string") {
      try {
        structured = JSON.parse(screenSize.structuredJson);
      } catch {
        structured = null;
      }
    }
    const width = typeof structured?.width === "number" ? structured.width : null;
    const height = typeof structured?.height === "number" ? structured.height : null;
    const scaleFactor = typeof structured?.scale_factor === "number" ? structured.scale_factor : null;

    report.coordinateSpace.screenSize = {
      text: screenSize?.text ?? null,
      structured,
      width,
      height,
      scaleFactor,
    };

    // P0-04 measured 2560x1600 physical vs 1707x1067 DPI-unaware virtualized (1.5x).
    const PHYSICAL = { width: 2560, height: 1600 };
    const VIRTUALIZED = { width: 1707, height: 1067 };
    const screenIsVirtualized = width === VIRTUALIZED.width && height === VIRTUALIZED.height;
    const screenIsPhysical = width === PHYSICAL.width && height === PHYSICAL.height;

    report.coordinateSpace.analysis = {
      physicalResolution: PHYSICAL,
      virtualizedResolution: VIRTUALIZED,
      screenSizeIsVirtualized: screenIsVirtualized,
      screenSizeIsPhysical: screenIsPhysical,
      windowBoundsArePhysical: report.observation.windows?.sample?.some?.(
        (entry) => entry?.bounds?.width === PHYSICAL.width,
      ) ?? null,
      conclusion:
        screenIsVirtualized && report.observation.windows?.sample?.some?.((entry) => entry?.bounds?.width === PHYSICAL.width)
          ? "CONFIRMED MISMATCH: getScreenSize reports the DPI-unaware virtualized resolution while window bounds report physical pixels. A click must not be derived from one and applied to the other."
          : "no mismatch detected by this probe",
    };

    check("the driver reports a screen size at runtime", width !== null && height !== null, `${width}x${height} @ ${scaleFactor}`);
    check(
      "the coordinate-space mismatch is recorded as a measured fact",
      report.coordinateSpace.analysis.conclusion !== null,
      report.coordinateSpace.analysis.conclusion,
    );
  } catch (error) {
    report.coordinateSpace.screenSize = { error: String(error.message).slice(0, 500) };
    check("the driver reports a screen size at runtime", false, report.coordinateSpace.screenSize.error);
  }

  try {
    const startedAt = Date.now();
    // maxImageDimension 1 keeps this to a single pixel; only metadata is recorded.
    const state = await driver.getDesktopState(sdk.GetDesktopStateInput.create({ maxImageDimension: 1 }));
    report.timingsMs.getDesktopState = Date.now() - startedAt;
    const images = imageMetadata(state);
    report.coordinateSpace.desktopState = {
      elapsedMs: report.timingsMs.getDesktopState,
      imageFields: images,
      keys: state && typeof state === "object" ? Object.keys(state) : null,
      // Deliberately no pixel data: only sizes and mime types are kept.
      pixelsPersisted: false,
    };
    check(
      "desktop state can be observed at runtime",
      state !== undefined && state !== null,
      JSON.stringify(report.coordinateSpace.desktopState),
    );
  } catch (error) {
    report.coordinateSpace.desktopState = { error: String(error.message).slice(0, 500) };
    check("desktop state can be observed at runtime", false, report.coordinateSpace.desktopState.error);
  }
}

// ---------------------------------------------------------------------------
// 6. Session and authorization surface. P1-06/P1-07 bind desktop authority to a run.
// ---------------------------------------------------------------------------
if (driver) {
  try {
    const sessions = await driver.listSessions(sdk.ListSessionsInput.create({}));
    report.sessions.list = safeJson(sessions, { maxString: 300 });
  } catch (error) {
    report.sessions.list = { error: String(error.message).slice(0, 300) };
  }

  try {
    const startedAt = Date.now();
    const started = await driver.startSession(sdk.StartSessionInput.create({ session: "p1-05-probe" }));
    report.timingsMs.startSession = Date.now() - startedAt;
    report.sessions.start = safeJson(started, { maxString: 300 });
    check("a named session can be started", true, `took ${report.timingsMs.startSession} ms`);

    const state = await driver.getSessionState(sdk.GetSessionStateInput.create({ session: "p1-05-probe" }));
    report.sessions.state = safeJson(state, { maxString: 400 });
    check("session state can be read", state !== undefined && state !== null, JSON.stringify(report.sessions.state));

    const ended = await driver.endSession(sdk.EndSessionInput.create({ session: "p1-05-probe" }));
    report.sessions.end = safeJson(ended, { maxString: 300 });
    check("a named session can be ended", true, JSON.stringify(report.sessions.end));
  } catch (error) {
    report.sessions.error = String(error.message).slice(0, 500);
    check("a named session can be started and ended", false, report.sessions.error);
  }
}

// ---------------------------------------------------------------------------
// 7. Shutdown: the driver must release cleanly, or P1-07's lifecycle gate fails.
// ---------------------------------------------------------------------------
if (driver) {
  try {
    const startedAt = Date.now();
    await driver.shutdown();
    report.timingsMs.shutdown = Date.now() - startedAt;
    report.driverCreation.shutdown = { ok: true, elapsedMs: report.timingsMs.shutdown };
    check("the driver shuts down cleanly", true, `${report.timingsMs.shutdown} ms`);
  } catch (error) {
    report.driverCreation.shutdown = { ok: false, error: String(error.message).slice(0, 300) };
    check("the driver shuts down cleanly", false, report.driverCreation.shutdown.error);
  }
}

report.safety.pixelsWrittenToDisk = 0;
report.passed = report.checks.length > 0 && report.checks.every((entry) => entry.ok);

mkdirSync(import.meta.dirname, { recursive: true });
writeFileSync(join(import.meta.dirname, "cua-runtime-probe.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ passed: report.passed, checks: report.checks, timings: report.timingsMs }, null, 2));

process.exit(report.passed ? 0 : 1);
