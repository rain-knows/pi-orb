import { app, desktopCapturer, BrowserWindow } from "electron";
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
