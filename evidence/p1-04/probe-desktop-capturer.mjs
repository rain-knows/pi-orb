// Probe: does an Electron desktopCapturer window source expose the native window
// handle, so a capture can be bound to one exact window instead of a title?
//
// Why this matters for P1-04: the requirement is "capture the window the user was
// looking at, never the orb itself". Matching by title is ambiguous (two windows can
// share a title, and a title changes), so if the native handle is available in the
// source id, identity can be exact.
//
// Read-only: enumerates capture sources and their metadata. It does not capture a
// frame, so no pixel is produced.
//
// Run: node evidence/p1-04/probe-desktop-capturer.mjs

import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..", "..");
const reporterPath = join(import.meta.dirname, "capturer-reporter.mjs");

mkdirSync(import.meta.dirname, { recursive: true });

writeFileSync(
  reporterPath,
  `import { app, desktopCapturer, BrowserWindow } from "electron";
import { writeFileSync } from "node:fs";

app.whenReady().then(async () => {
  // A hidden window is enough: enumerating sources needs no visible window, and a
  // shown window would itself become a capture source and perturb the probe.
  const win = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences: { sandbox: true } });
  await win.loadURL("data:text/html,<title>probe</title>ok");

  const report = { ok: true, sources: [], displays: [] };
  try {
    const sources = await desktopCapturer.getSources({ types: ["window", "screen"], thumbnailSize: { width: 0, height: 0 } });
    report.sources = sources.map((source) => ({
      id: source.id,
      name: source.name,
      displayId: source.display_id ?? null,
      // thumbnailSize was 0x0 so no frame was rendered; record whether an image exists.
      hasThumbnail: Boolean(source.thumbnail && !source.thumbnail.isEmpty()),
      thumbnailSize: source.thumbnail ? source.thumbnail.getSize() : null,
    }));
  } catch (error) {
    report.ok = false;
    report.error = String(error && error.message ? error.message : error);
  }
  try {
    const { screen } = await import("electron");
    report.displays = screen.getAllDisplays().map((display) => ({
      id: display.id,
      bounds: display.bounds,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      rotation: display.rotation,
    }));
  } catch (error) {
    report.displayError = String(error && error.message ? error.message : error);
  }

  writeFileSync(process.env.PROBE_OUT, JSON.stringify(report, null, 2));
  app.exit(0);
});
`,
  "utf8",
);

const outPath = join(import.meta.dirname, "capturer-probe.json");
const electronBinary = join(repo, "node_modules", "electron", "dist", "electron.exe");

// Windows' own list, for cross-checking whether the ids contain the native handles.
let nativeWindows = null;
try {
  const raw = execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Add-Type -Namespace W -Name N -MemberDefinition '[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, System.IntPtr p); public delegate bool EnumWindowsProc(System.IntPtr h, System.IntPtr p); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid); [DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h); [DllImport("user32.dll")] public static extern int GetWindowTextLength(System.IntPtr h); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder t, int c);';
$list = New-Object System.Collections.ArrayList;
$cb = [W.N+EnumWindowsProc]{ param($h,$p)
  if ([W.N]::IsWindowVisible($h)) {
    $len = [W.N]::GetWindowTextLength($h);
    if ($len -gt 0) {
      $sb = New-Object System.Text.StringBuilder ($len+1);
      [void][W.N]::GetWindowText($h, $sb, $sb.Capacity);
      $procId = 0; [void][W.N]::GetWindowThreadProcessId($h, [ref]$procId);
      [void]$list.Add([ordered]@{ handle = $h.ToInt64().ToString(); processId = [int]$procId; title = $sb.ToString() });
    }
  }
  return $true
};
[void][W.N]::EnumWindows($cb, [System.IntPtr]::Zero);
$list | ConvertTo-Json -Compress -Depth 4`,
    ],
    { encoding: "utf8", timeout: 60000 },
  );
  nativeWindows = JSON.parse(raw.trim() || "[]");
} catch (error) {
  nativeWindows = { error: String(error.message).slice(0, 300) };
}

const child = spawn(electronBinary, [reporterPath], {
  cwd: repo,
  env: { ...process.env, PROBE_OUT: outPath },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

await new Promise((done) => {
  child.on("exit", done);
  setTimeout(() => {
    child.kill();
    done();
  }, 60000);
});

let report;
try {
  report = JSON.parse(execFileSync("node", ["-e", `process.stdout.write(require('fs').readFileSync(${JSON.stringify(outPath)}, 'utf8'))`], { encoding: "utf8" }));
} catch (error) {
  report = { ok: false, readError: String(error.message), stderr: stderr.slice(-800) };
}

// Do any window source ids contain a native handle from the OS list?
const windowSources = (report.sources ?? []).filter((source) => source.id.startsWith("window:"));
const handles = Array.isArray(nativeWindows) ? new Set(nativeWindows.map((entry) => String(entry.handle))) : new Set();
const matched = windowSources
  .map((source) => {
    const parts = source.id.split(":");
    return { id: source.id, name: source.name, middle: parts[1] ?? null, middleIsLiveHandle: handles.has(parts[1] ?? "") };
  })
  .filter((entry) => entry.middleIsLiveHandle);

const byName = new Map();
for (const source of windowSources) {
  byName.set(source.name, (byName.get(source.name) ?? 0) + 1);
}
const duplicateNames = [...byName.entries()].filter(([, count]) => count > 1);

const summary = {
  capturedAt: new Date().toISOString(),
  electronVersion: process.env.npm_package_version ? null : null,
  sourceCount: (report.sources ?? []).length,
  windowSourceCount: windowSources.length,
  screenSourceCount: (report.sources ?? []).filter((source) => source.id.startsWith("screen:")).length,
  displayCount: (report.displays ?? []).length,
  displays: report.displays ?? [],
  idFormatExamples: windowSources.slice(0, 6).map((s) => ({ id: s.id, name: s.name })),
  nativeWindowCount: Array.isArray(nativeWindows) ? nativeWindows.length : 0,
  // The decisive question: is the middle id segment a live native window handle?
  idsContainingNativeHandle: matched.length,
  idHandleMatches: matched.slice(0, 6),
  duplicateTitlesAmongWindowSources: duplicateNames.map(([name, count]) => ({ name, count })),
  anyThumbnailPresent: (report.sources ?? []).some((source) => source.hasThumbnail),
  error: report.error ?? report.readError ?? (report.ok ? null : "unknown"),
  rawSourceSample: (report.sources ?? []).slice(0, 4),
  stderrTail: stderr.trim().split(/\r?\n/).slice(-5).join("\n"),
};

writeFileSync(join(import.meta.dirname, "capturer-probe.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
