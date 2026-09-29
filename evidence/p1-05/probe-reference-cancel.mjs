// Disposable real-backend cancellation probe.
// It aborts a native long press against the self-reporting target and checks the target log,
// rather than treating the backend promise rejection as proof that the button was released.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = resolve(import.meta.dirname, "..", "..");
const runRoot = join("D:\\pi-orb-p1-runs", `p1-05-reference-cancel-${Date.now()}`);
const logPath = join(runRoot, "target.jsonl");
const geometryPath = join(runRoot, "geometry.json");
const targetApp = join(repo, "evidence", "p1-05", "target-app");
const electronBinary = join(repo, "node_modules", "electron", "dist", "electron.exe");
const chunks = join(repo, "out", "main", "chunks");

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const result = { capturedAt: new Date().toISOString(), runRoot, checks: [], passed: false };
const check = (name, ok, detail) => result.checks.push({ name, ok: Boolean(ok), detail });

let target = null;
try {
  mkdirSync(runRoot, { recursive: true });
  target = spawn(electronBinary, [targetApp], {
    cwd: repo,
    env: { ...process.env, P1_05_TARGET_LOG: logPath, P1_05_TARGET_GEOMETRY: geometryPath },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  target.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  for (let attempt = 0; attempt < 60 && !existsSync(geometryPath); attempt += 1) await sleep(250);
  if (!existsSync(geometryPath)) throw new Error(`target did not start: ${stderr.slice(-500)}`);

  const windowsFile = readdirSync(chunks).find((name) => /^windows-[^n].*\.js$/u.test(name));
  if (!windowsFile) throw new Error("built Windows backend chunk not found; run npm run build first");
  const { createWindowsDesktopBackend } = await import(pathToFileURL(join(chunks, windowsFile)).href);
  const opsModule = await import(pathToFileURL(join(chunks, readdirSync(chunks).find((name) => /^windows-native-.*\.js$/u.test(name)))).href);
  const ops = opsModule.createProductionWindowsOps();
  let targetFact = null;
  for (let attempt = 0; attempt < 30 && !targetFact?.visible; attempt += 1) {
    targetFact = ops.listWindows().windows.find((window) => window.title === "P1-05 input target") ?? null;
    if (!targetFact?.visible) await sleep(100);
  }
  if (!targetFact) throw new Error("target window was not enumerated by the native backend");
  if (!targetFact.visible) throw new Error("target window is not visible on the interactive desktop; unlock Windows and rerun");
  const backend = createWindowsDesktopBackend(ops);
  check("native backend enumerated the disposable target", Boolean(targetFact), JSON.stringify(targetFact));
  check("native backend focused the disposable target", ops.focusWindow(targetFact.hwnd), String(targetFact.hwnd));
  const screens = await backend.listScreens();
  const screen = screens[0];
  if (!screen) throw new Error("native backend returned no target screen");

  const controller = new AbortController();
  const action = backend.longPress({
    screen,
    position: [500, 500],
    durationSeconds: 1,
  }, controller.signal);
  setTimeout(() => controller.abort(new Error("intentional cancellation")), 180);
  await action.then(
    () => { throw new Error("long press unexpectedly completed"); },
    (error) => check("native backend reports cancellation", String(error).includes("intentional cancellation"), String(error)),
  );
  await sleep(500);

  const events = readFileSync(logPath, "utf8").trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  const downs = events.filter((event) => event.kind === "mouse-down");
  const ups = events.filter((event) => event.kind === "mouse-up");
  check("target received the held mouse-down", downs.length >= 1, JSON.stringify(downs));
  check("target received a matching mouse-up after cancellation", ups.length >= downs.length, JSON.stringify({ downs: downs.length, ups: ups.length }));
  result.events = { downs: downs.length, ups: ups.length };
  result.passed = result.checks.every((entry) => entry.ok);
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
} finally {
  if (target && target.exitCode === null) target.kill();
  await sleep(250);
  writeFileSync(join(repo, "evidence", "p1-05", "reference-cancel.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  rmSync(runRoot, { recursive: true, force: true });
}

console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
