/**
 * Electron main process for pi-Orb.
 *
 * Responsibilities (doc/pi-orb-development-goals.md §4.1):
 *  - own the window, tray and global wake shortcut,
 *  - own the Orb configuration file,
 *  - proxy every pi-web API/SSE call, because a sandboxed renderer with an
 *    opaque origin cannot call pi-web directly (measured 403, evidence/p0-03),
 *  - never hand credentials or Node APIs to the renderer.
 *
 * This process does not implement any part of the Pi agent loop and never
 * starts, restarts or stops a pi-web service it did not start itself
 * (invariant N4).
 */

import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
  type NativeImage,
} from "electron";
import { join } from "node:path";
import { loadOrbConfig, defaultConfigPath, saveOrbConfig } from "./config-store";
import { validateWorkspace, createWorkspace } from "./workspace";
import { RunGenerations } from "./generations";
import { ShortcutRegistry } from "./shortcut";
import { WakeController } from "./window-toggle";
import { OrbSessionController } from "./orb-session";
import { PiWebClient, PiWebError } from "./pi-web-client";
import { IPC, type OrbSessionEvent, type PiWebStatus, type WorkspaceStatus } from "@shared/ipc";
import { isOrbWorkspace, type OrbConfig } from "@shared/orb-config";

const generations = new RunGenerations();
const shortcuts = new ShortcutRegistry(globalShortcut);

let configPath = "";
let config: OrbConfig;
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let session: OrbSessionController;
let wake: WakeController | null = null;
let lastWorkspaceProblem: string | null = null;
let lastShortcutProblem: string | null = null;
let isQuitting = false;
let piWebState: PiWebStatus = {
  // Filled in once the main process knows the configured base URL.
  baseUrl: "",
  reachable: false,
  problem: null,
};

const piWebBaseUrl = process.env.PI_ORB_PI_WEB_URL ?? "http://127.0.0.1:30141";
const piWebPassword = process.env.PI_ORB_PI_WEB_PASSWORD ?? process.env.PI_WEB_PASSWORD;
const client = new PiWebClient({
  baseUrl: piWebBaseUrl,
  ...(piWebPassword ? { password: piWebPassword } : {}),
});

function emit(event: OrbSessionEvent): void {
  if (event.type === "idle" || event.type === "error") {
    // The turn is over. The single-task lock must not outlive it, or the orb would
    // refuse every later message for the rest of the run.
    //
    // Released against the controller's own generation, not `generations.current`:
    // a turn that ends after a workspace switch must not free the new run's lock.
    generations.release(session.generation);
  }
  if (window && !window.isDestroyed()) {
    window.webContents.send(IPC.sessionEvent, event);
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: config.window.width,
    height: config.window.height,
    ...(config.window.x !== null ? { x: config.window.x } : {}),
    ...(config.window.y !== null ? { y: config.window.y } : {}),
    show: false,
    frame: false,
    resizable: true,
    alwaysOnTop: config.window.alwaysOnTop,
    skipTaskbar: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  win.once("ready-to-show", () => win.show());
  win.on("close", (event) => {
    // Collapsing is not quitting: hide the window and keep the session alive.
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  // Remember where the user put the orb. Writes are debounced so dragging does not
  // rewrite the configuration on every pixel.
  const saveBounds = debounce(() => {
    if (win.isDestroyed()) return;
    const bounds = win.getBounds();
    config = { ...config, window: { ...config.window, ...bounds } };
    try {
      saveOrbConfig(configPath, config);
    } catch (error) {
      console.warn(`[pi-orb] could not save window bounds: ${describeError(error)}`);
    }
  }, 500);
  win.on("moved", saveBounds);
  win.on("resized", saveBounds);

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void win.loadURL(rendererUrl);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}

function currentStatus(): WorkspaceStatus {
  const validation = config.orbWorkspace ? validateWorkspace(config.orbWorkspace) : null;
  const usable = Boolean(validation?.ok);
  return {
    configured: usable,
    workspace: usable ? validation?.resolved ?? null : config.orbWorkspace,
    // A rejection of a new selection must be reported even when the previously
    // committed workspace is still perfectly usable; otherwise picking a bad
    // directory looks like nothing happened at all.
    problem: usable
      ? lastWorkspaceProblem
      : (validation?.message ?? lastWorkspaceProblem),
    shortcut: config.shortcut,
    shortcutRegistered: shortcuts.current?.registered ?? false,
    shortcutProblem: shortcuts.current?.reason ?? lastShortcutProblem,
    generation: generations.current,
    busy: generations.busy,
    sessionId: session?.sessionId ?? null,
    piWeb: { ...piWebState },
  };
}

/**
 * Connect to pi-web and record the outcome in the status snapshot.
 *
 * Probes reachability before authenticating, so "nothing is listening" and
 * "authentication failed" produce different, actionable messages. Never starts,
 * restarts or stops the service: pi-Orb connects to an existing pi-web and
 * reports when there is none (invariant N4).
 */
async function refreshPiWebState(): Promise<void> {
  if (!(await client.probeService())) {
    piWebState = {
      baseUrl: client.baseUrl,
      reachable: false,
      problem: `No pi-web service answered at ${client.baseUrl}. Start it yourself; Orb will not start, restart or stop it.`,
    };
    return;
  }
  try {
    await client.authenticate();
  } catch (error) {
    piWebState = {
      baseUrl: client.baseUrl,
      reachable: false,
      problem: describeError(error),
    };
    return;
  }
  piWebState = { baseUrl: client.baseUrl, reachable: true, problem: null };
}

function registerShortcut(): void {
  const result = shortcuts.apply(config.shortcut, () => void wake?.trigger("shortcut"));
  if (!result.registered) {
    console.warn(`[pi-orb] wake shortcut not registered: ${result.reason}`);
  }
}

/**
 * Wake or collapse the window.
 *
 * Routed through `WakeController` so the same rules apply to the shortcut and the
 * tray, and so an auto-repeating held shortcut cannot flip the window repeatedly.
 * Waking only changes visibility: it never starts a screenshot, an upload or a
 * session.
 */
function toggleWindow(source: "shortcut" | "tray"): void {
  wake?.trigger(source);
}

function attachWakeController(win: BrowserWindow): void {
  wake = new WakeController({
    getState: () => ({
      destroyed: win.isDestroyed(),
      visible: win.isVisible(),
      minimized: win.isMinimized(),
      focused: win.isFocused(),
    }),
    wake: () => {
      if (win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    },
    collapse: () => {
      if (win.isDestroyed()) return;
      win.hide();
    },
  });
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("pi-Orb");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show orb", click: () => window?.show() },
      { label: "Hide orb", click: () => window?.hide() },
      { type: "separator" },
      { label: "Quit", click: () => quit() },
    ]),
  );
  tray.on("click", () => toggleWindow("tray"));
}

/** A 16x16 solid icon, drawn in code so no binary asset is committed. */
function createTrayIcon(): NativeImage {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    buffer[i * 4 + 0] = 0x4c;
    buffer[i * 4 + 1] = 0x8b;
    buffer[i * 4 + 2] = 0xf5;
    buffer[i * 4 + 3] = 0xff;
  }
  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function registerIpc(): void {
  ipcMain.handle(IPC.getStatus, () => currentStatus());

  // Re-probe on demand so the user can start pi-web and refresh without
  // restarting the shell.
  ipcMain.handle(IPC.refreshConnection, async () => {
    await refreshPiWebState();
    return currentStatus();
  });

  ipcMain.handle(IPC.setShortcut, (_event, candidate: unknown) => {
    if (typeof candidate !== "string") {
      lastShortcutProblem = "No shortcut was provided.";
      return currentStatus();
    }
    const previous = config.shortcut;
    const result = shortcuts.apply(candidate, () => void wake?.trigger("shortcut"));
    if (!result.registered) {
      // Do not persist a shortcut that does not work, and put the previous one back
      // so the orb stays reachable. The reason still reaches the user through the
      // status snapshot.
      lastShortcutProblem = result.reason;
      shortcuts.apply(previous, () => void wake?.trigger("shortcut"));
      return currentStatus();
    }
    lastShortcutProblem = null;
    // Persist the canonical form that was actually registered, not the raw input.
    config = { ...config, shortcut: result.accelerator };
    saveOrbConfig(configPath, config);
    return currentStatus();
  });

  ipcMain.handle(IPC.validateWorkspace, (_event, candidate: unknown) => {
    if (typeof candidate !== "string") {
      return { ok: false, message: "No directory was provided.", resolved: null };
    }
    const validation = validateWorkspace(candidate);
    return {
      ok: validation.ok,
      message: validation.message,
      resolved: validation.resolved,
    };
  });

  ipcMain.handle(IPC.chooseWorkspace, async () => {
    if (!window) return { ok: false, message: "No window available.", resolved: null };
    const result = await dialog.showOpenDialog(window, {
      title: "Select the Orb workspace",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      // Cancelling writes nothing, by design (doc P1-01).
      return { ok: false, message: "", resolved: null };
    }
    const validation = validateWorkspace(result.filePaths[0] ?? null);
    return {
      ok: validation.ok,
      message: validation.message,
      resolved: validation.resolved,
    };
  });

  ipcMain.handle(
    IPC.setWorkspace,
    async (_event, candidate: unknown, createConfirmed: unknown) => {
      if (typeof candidate !== "string" || candidate.trim().length === 0) {
        // Cancelling is not a failure, but any earlier rejection is stale now.
        lastWorkspaceProblem = null;
        return currentStatus();
      }
      let validation = validateWorkspace(candidate);
      if (!validation.ok && validation.code === "not-found" && createConfirmed === true) {
        const created = createWorkspace(candidate, true);
        if (!created.ok) {
          lastWorkspaceProblem = created.message;
          return currentStatus();
        }
        validation = created.validation ?? validation;
      }
      if (!validation.ok || !validation.resolved) {
        // Keep the existing workspace; report why the new one was refused.
        lastWorkspaceProblem = validation.message;
        return currentStatus();
      }

      lastWorkspaceProblem = null;
      config = { ...config, orbWorkspace: validation.resolved };
      saveOrbConfig(configPath, config);
      // A workspace change binds a fresh run: any in-flight work from the
      // previous workspace must not continue under the new one.
      const generation = generations.begin();
      session.beginGeneration(generation);
      try {
        await session.ensureSession(validation.resolved);
      } catch (error) {
        emit({ type: "error", message: describeError(error) });
      }
      return currentStatus();
    },
  );

  ipcMain.handle(IPC.ensureSession, async () => {
    const validation = config.orbWorkspace ? validateWorkspace(config.orbWorkspace) : null;
    if (!validation?.ok || !validation.resolved) {
      throw new Error("Select a usable Orb workspace first.");
    }
    if (!isOrbWorkspace(validation.resolved, config.orbWorkspace)) {
      throw new Error("The configured workspace no longer matches its resolved path.");
    }
    try {
      return await session.ensureSession(validation.resolved);
    } catch (error) {
      throw new Error(describeError(error));
    }
  });

  ipcMain.handle(IPC.sendPrompt, async (_event, request: unknown) => {
    const parsed = parseGenerationRequest(request);
    if (!parsed) throw new Error("Malformed prompt request.");
    const check = generations.check(parsed.generation);
    if (!check.ok) throw new Error(describeGenerationFailure(check.reason));
    if (!generations.tryAcquire(parsed.generation)) {
      throw new Error("Orb is busy with another task.");
    }
    try {
      await session.prompt(parsed.text);
    } catch (error) {
      // The turn never started, so release the lock here; a turn that does start
      // keeps it until it ends (see emit()).
      generations.release(parsed.generation);
      throw new Error(describeError(error));
    }
  });

  ipcMain.handle(IPC.abort, async (_event, request: unknown) => {
    const parsed = parseGenerationRequest(request);
    if (!parsed) throw new Error("Malformed abort request.");
    const check = generations.check(parsed.generation);
    if (!check.ok) throw new Error(describeGenerationFailure(check.reason));
    try {
      await session.abort();
    } finally {
      // Stopping ends the turn, so the task lock must be released here too; the
      // stream does not reliably emit an idle event for an aborted turn.
      generations.release(parsed.generation);
    }
  });
}

function parseGenerationRequest(
  value: unknown,
): { generation: number; text: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const generation = record.generation;
  if (typeof generation !== "number" || !Number.isInteger(generation)) return null;
  const text = typeof record.text === "string" ? record.text : "";
  return { generation, text };
}

function describeGenerationFailure(reason: "no-run" | "stale-generation" | "malformed"): string {
  switch (reason) {
    case "no-run":
      return "Orb is not running.";
    case "stale-generation":
      return "This request belongs to an earlier Orb run and was refused.";
    default:
      return "Malformed request.";
  }
}

function describeError(error: unknown): string {
  if (error instanceof PiWebError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/** Trailing-edge debounce. Returns a function that can be called repeatedly. */
function debounce(action: () => void, delayMs: number): () => void {
  let timer: NodeJS.Timeout | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      action();
    }, delayMs);
  };
}

function quit(): void {
  isQuitting = true;
  shortcuts.releaseAll();
  session.dispose();
  generations.end();
  app.quit();
}

void app.whenReady().then(async () => {
  configPath = defaultConfigPath(app.getPath("userData"));
  const loaded = loadOrbConfig(configPath);
  config = loaded.config;
  if (loaded.error) {
    lastWorkspaceProblem = loaded.error;
    console.warn(`[pi-orb] ${loaded.error}`);
  }

  session = new OrbSessionController({
    client,
    emit: (event) => emit(event),
  });
  const generation = generations.begin();
  session.beginGeneration(generation);

  registerIpc();
  createTray();
  window = createWindow();
  attachWakeController(window);
  registerShortcut();

  await refreshPiWebState();
});

app.on("window-all-closed", () => {
  // The orb is a tray application; closing the window keeps it running.
});

app.on("before-quit", () => {
  isQuitting = true;
  shortcuts.releaseAll();
  session?.dispose();
});
