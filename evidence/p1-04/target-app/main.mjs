// Disposable capture target for P1-04's positive screenshot path. Never shipped.
//
// Purpose: give the screenshot flow a real foreground window whose pixels are known in advance, so
// the capture can be checked against ground truth instead of against the driver's own claim.
//
// Design notes:
//  - The content is a single flat, saturated magenta fill. Any pixel that is not magenta inside the
//    captured image is therefore something that was drawn on top of this window, which is how
//    "the preview does not smuggle in the orb overlay" is decided from evidence rather than assumed.
//  - Two small black markers sit in the corners farthest from where the orb will be, so "the image is
//    not blank" is a separate check from "the image is not the orb".
//  - The title carries a per-run nonce. The capture path refuses a source whose title disagrees with
//    the recorded one, so a unique title makes "this image is this window" verifiable.
//  - The window handle and title are written to a log file for the runner to read. The app performs
//    no input synthesis and writes nothing else.
//
// Launched as `electron.exe <this directory>`; it imports only `electron`, which the runtime provides,
// so it needs no node_modules of its own.

import { app, BrowserWindow, screen } from "electron";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const logPath = process.env.P1_04_TARGET_LOG;
const title = process.env.P1_04_TARGET_TITLE ?? "P1-04 capture target";
const width = Number(process.env.P1_04_TARGET_WIDTH ?? 720);
const height = Number(process.env.P1_04_TARGET_HEIGHT ?? 520);
const x = Number(process.env.P1_04_TARGET_X ?? 320);
const y = Number(process.env.P1_04_TARGET_Y ?? 220);

if (!logPath) throw new Error("P1_04_TARGET_LOG is required");

mkdirSync(dirname(logPath), { recursive: true });
writeFileSync(logPath, "");

const log = (entry) => appendFileSync(logPath, `${JSON.stringify({ at: Date.now(), ...entry })}\n`, "utf8");

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  html,body{margin:0;padding:0;overflow:hidden;background:#ff00ff}
  .marker{position:absolute;width:60px;height:60px;background:#000}
  #top-right{top:0;right:0}
  #bottom-right{bottom:0;right:0}
</style></head>
<body>
  <div class="marker" id="top-right"></div>
  <div class="marker" id="bottom-right"></div>
</body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    title,
    show: true,
    backgroundColor: "#ff00ff",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.focus();

  const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0).toString();
  const bounds = win.getBounds();
  // The physical (screen-pixel) size of the window, computed with Electron's own converter rather
  // than by multiplying by the scale factor here. desktopCapturer reports a window source in physical
  // pixels, so this is the ground truth the captured image has to match; deriving it by hand would
  // bake in exactly the DIP/physical assumption P0-04 showed does not hold on this machine.
  const physicalBounds = screen.dipToScreenRect(win, bounds);
  log({
    kind: "ready",
    hwnd,
    title: win.getTitle(),
    pid: process.pid,
    bounds,
    physicalBounds,
    displayScaleFactor: screen.getDisplayMatching(bounds).scaleFactor,
    expectedFill: "#ff00ff",
  });
});

app.on("window-all-closed", () => app.quit());
