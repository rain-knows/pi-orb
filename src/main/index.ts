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
import { OrbWindowLifecycle } from "./window-lifecycle";
import { OrbSessionController } from "./orb-session";
import { PiWebClient, PiWebError } from "./pi-web-client";
import { Win32TargetWindowReader } from "./target-window";
import { captureTargetWindow } from "./desktop-capture";
import { ScreenshotFlow } from "./screenshot-flow";
import { BridgeServer, createBridgeToken, removeHandshake, writeHandshake } from "./bridge-server";
import { DesktopBroker } from "./desktop-broker";
import { CuaDriverAdapter, type CuaSdkLike, type CuaWindowInfo } from "./cua-adapter";
import {
  IPC,
  type DesktopTaskStatus,
  type DesktopWindowChoice,
  type ImageContent,
  type OrbSessionEvent,
  type PiWebStatus,
  type ScreenshotCaptureResult,
  type ScreenshotResolveResult,
  type ListDesktopWindowsResult,
  type SetDesktopTargetResult,
  type WorkspaceStatus,
} from "@shared/ipc";
import { type CaptureTargetSnapshot } from "@shared/screenshot";
import { isOrbWorkspace, type OrbConfig } from "@shared/orb-config";

const generations = new RunGenerations();
const shortcuts = new ShortcutRegistry(globalShortcut);
const targetWindowReader = new Win32TargetWindowReader();

/**
 * The screenshot consent flow.
 *
 * It is constructed after `session` exists because it sends through it. The telegram
 * of rules — record the target before taking focus, never fall back to a full-screen
 * capture, send only the exact image the user confirmed — lives in ScreenshotFlow,
 * which is driven directly by tests.
 */
let screenshotFlow: ScreenshotFlow;

/**
 * The desktop broker and its driver.
 *
 * The driver is created lazily on first use so a machine without a working driver still
 * starts the orb; the bridge listens from startup so the extension can report its state.
 */
let desktopBroker: DesktopBroker | null = null;
let cuaAdapter: CuaDriverAdapter | null = null;
let bridge: BridgeServer | null = null;

/**
 * The window desktop actions may target.
 *
 * Recorded before the orb can take focus, and changeable only by an explicit user choice. Stored
 * as the full choice (not just pid/title) so the window can show exactly what is selected.
 */
let desktopTarget: DesktopWindowChoice | null = null;

let configPath = "";
let config: OrbConfig;
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let session: OrbSessionController;
let wake: WakeController | null = null;
let lifecycle: OrbWindowLifecycle | null = null;
let lastWorkspaceProblem: string | null = null;
let lastShortcutProblem: string | null = null;
let lastDesktopProblem: string | null = null;
let isQuitting = false;
const piWebBaseUrl = process.env.PI_ORB_PI_WEB_URL ?? "http://127.0.0.1:30141";
const piWebPassword = process.env.PI_ORB_PI_WEB_PASSWORD ?? process.env.PI_WEB_PASSWORD;

/**
 * pi-web connection state.
 *
 * `baseUrl` is known from the moment the process starts, so it is set here rather than left empty
 * until the first probe. Leaving it empty made the first render report an empty URL with no problem,
 * which hid the real state: the window is created before the (slower) desktop startup completes, so
 * a client can read the snapshot before any probe has run.
 */
let piWebState: PiWebStatus = {
  baseUrl: piWebBaseUrl,
  reachable: false,
  problem: null,
};

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
    //
    // Closing goes through the same collapse routine as the wake shortcut and the tray, so the
    // "hiding the orb revokes desktop operations" rule cannot be bypassed by using the window
    // button instead of the shortcut. Two independent hide paths was a real defect: closing the
    // window kept the desktop authority alive.
    if (!isQuitting) {
      event.preventDefault();
      lifecycle?.collapse();
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
      ? (lastWorkspaceProblem ?? lastDesktopProblem)
      : (validation?.message ?? lastWorkspaceProblem ?? lastDesktopProblem),
    shortcut: config.shortcut,
    shortcutRegistered: shortcuts.current?.registered ?? false,
    shortcutProblem: shortcuts.current?.reason ?? lastShortcutProblem,
    generation: generations.current,
    busy: generations.busy,
    sessionId: session?.sessionId ?? null,
    piWeb: { ...piWebState },
    desktopTask: desktopTaskStatus(),
  };
}

/**
 * Report desktop task state, defaulting to "not authorized" when no broker exists.
 *
 * The default matters: a missing broker must read as "the orb may not touch the desktop",
 * never as "unknown, so probably fine".
 */
function desktopTaskStatus(): DesktopTaskStatus {
  if (!desktopBroker) {
    return {
      authorized: false,
      taskId: null,
      scope: null,
      actionsUsed: 0,
      actionLimit: 0,
      expiresAt: null,
      stopped: false,
      stoppedReason: null,
      bridgeReady: bridge !== null,
      target: desktopTarget,
    };
  }
  return { ...desktopBroker.status(), bridgeReady: bridge !== null, target: desktopTarget };
}

/**
 * Start the desktop broker, its driver and the bridge the Pi extension talks to.
 *
 * The driver is created here rather than at module load so a driver failure is a reported
 * state instead of a startup crash. A failure to start the driver leaves the bridge listening
 * with no capability, which is the safe direction: the extension still reports "unavailable".
 */
async function startDesktop(): Promise<void> {
  try {
    const sdk = (await import("@trycua/cua-driver")) as unknown as CuaSdkLike;
    cuaAdapter = new CuaDriverAdapter({
      sdk,
      ownProcessId: process.pid,
      onMappingUsed: (mapping) => console.log(`[pi-orb] desktop coordinate mapping: ${JSON.stringify(mapping)}`),
      // The adapter refuses to guess a target, so this is the only source of one.
      resolveRecordedTarget: () =>
        desktopTarget ? { pid: desktopTarget.pid, title: desktopTarget.title } : undefined,
    });
    cuaAdapter.create();
  } catch (error) {
    console.warn(`[pi-orb] desktop driver unavailable: ${describeError(error)}`);
    cuaAdapter = null;
  }

  if (!cuaAdapter) return;

  desktopBroker = new DesktopBroker({
    driver: cuaAdapter,
    isLive: (sessionId, generation) =>
      generations.current === generation && session?.sessionId === sessionId,
    log: (entry) => {
      // Structured, desensitized: action kind and reason only, never typed text or pixels.
      console.log(`[pi-orb] desktop ${JSON.stringify(entry)}`);
    },
  });
}

/**
 * Start the bridge and publish its handshake.
 *
 * The handshake lands in the Orb userData directory, which is the same place the
 * configuration lives, so the extension finds it without any environment variable. That
 * matters because the extension runs inside pi-web's process, whose environment this project
 * cannot set.
 */
async function startBridge(): Promise<void> {
  const token = createBridgeToken();
  const handshake = writeHandshake(
    app.getPath("userData"),
    token,
    config.orbWorkspace ?? "",
    process.pid,
  );
  bridge = new BridgeServer({
    pipePath: handshake.pipePath,
    token,
    executor: {
      observe: async (input) => {
        const broker = requireBroker();
        return broker.observe(session?.sessionId ?? "", generations.current, input.windowId);
      },
      act: async (action) => {
        const broker = requireBroker();
        return broker.act(action, session?.sessionId ?? "", generations.current);
      },
      status: () => desktopTaskStatus(),
      revoke: () => desktopBroker?.revoke(),
      accepts: (sessionId, generation) =>
        generations.current === generation && session?.sessionId === sessionId,
    },
    log: (entry) => console.log(`[pi-orb] bridge ${JSON.stringify(entry)}`),
  });
  try {
    await bridge.listen();
    console.log(`[pi-orb] bridge listening on ${handshake.pipePath}`);
  } catch (error) {
    console.warn(`[pi-orb] bridge could not listen: ${describeError(error)}`);
    bridge = null;
  }
}

function requireBroker(): DesktopBroker {
  if (!desktopBroker) {
    throw new Error("The desktop driver is unavailable, so desktop actions cannot run.");
  }
  return desktopBroker;
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
  // Every collapse route — the wake shortcut, the window's close button and the tray menu — goes
  // through this one lifecycle object. Two independent hide paths was a real defect: closing the
  // window (or using the tray menu) kept the desktop authority alive.
  lifecycle = new OrbWindowLifecycle(
    {
      hide: () => {
        if (!win.isDestroyed()) win.hide();
      },
      isDestroyed: () => win.isDestroyed(),
    },
    {
      revokeDesktopTask: () => desktopBroker?.revoke(),
      discardPendingCapture: () => screenshotFlow?.discard(),
    },
    (message) => console.log(message),
  );

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
      lifecycle?.collapse();
    },
  });
}

/**
 * Torn down every outstanding desktop capability, in one place.
 *
 * There is exactly one revocation path so a new caller cannot invent a partial one. It revokes the
 * task authorization and drops any unconfirmed screenshot, and it is idempotent.
 */
function revokeDesktopOperations(reason: string): void {
  const hadAuthority = desktopBroker?.status().authorized === true;
  const hadCapture = screenshotFlow?.pending !== null && screenshotFlow?.pending !== undefined;
  desktopBroker?.revoke();
  screenshotFlow?.discard();
  if (hadAuthority || hadCapture) {
    console.log(`[pi-orb] desktop operations revoked: ${reason}`);
  }
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("pi-Orb");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show orb", click: () => window?.show() },
      // Goes through the same collapse routine as the shortcut and the window button, so the tray
      // cannot hide the orb while leaving desktop authority alive.
      { label: "Hide orb", click: () => lifecycle?.collapse() },
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

  ipcMain.handle(IPC.collapseOrb, () => {
    // The window's own collapse control. It goes through the lifecycle object, so hiding from the
    // window revokes desktop operations just like the shortcut and the tray.
    lifecycle?.collapse();
    return desktopTaskStatus();
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
      // previous workspace must not continue under the new one. An unconfirmed
      // screenshot and any desktop authorization belong to the previous run and must not
      // survive it either.
      revokeDesktopOperations("the workspace changed");
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
      await session.prompt(parsed.text, parsed.images);
    } catch (error) {
      // The turn never started, so release the lock here; a turn that does start
      // keeps it until it ends (see emit()).
      generations.release(parsed.generation);
      throw new Error(describeError(error));
    }
  });

  /**
   * Capture the window recorded before the orb took focus, for preview only.
   *
   * Nothing is sent here. The image is held in the main process until the user
   * confirms that specific capture.
   */
  ipcMain.handle(
    IPC.captureScreenshot,
    async (_event, request: unknown): Promise<ScreenshotCaptureResult> => {
      const parsed = parseCaptureRequest(request);
      if (!parsed) return { ok: false, message: "Malformed capture request." };
      const check = generations.check(parsed.generation);
      if (!check.ok) return { ok: false, message: describeGenerationFailure(check.reason) };
      return screenshotFlow.start(parsed.text);
    },
  );

  ipcMain.handle(
    IPC.resolveScreenshot,
    async (_event, request: unknown): Promise<ScreenshotResolveResult> => {
      const parsed = parseResolveRequest(request);
      if (!parsed) return { ok: false, sent: false, message: "Malformed screenshot decision." };
      const check = generations.check(parsed.generation);
      if (!check.ok) {
        return { ok: false, sent: false, message: describeGenerationFailure(check.reason) };
      }
      if (!generations.tryAcquire(parsed.generation)) {
        return { ok: false, sent: false, message: "Orb is busy with another task." };
      }
      // The send is synchronous from here: the flow either sends the confirmed image
      // or reports why it did not. Either way the task lock is released on failure.
      const result = await screenshotFlow.resolve(parsed.observationId, parsed.confirmed);
      if (!result.sent) generations.release(parsed.generation);
      return result;
    },
  );

  ipcMain.handle(IPC.discardScreenshot, () => {
    screenshotFlow.discard();
    return true;
  });
  ipcMain.handle(IPC.getDesktopTaskStatus, () => desktopTaskStatus());

  ipcMain.handle(IPC.listDesktopWindows, async (): Promise<ListDesktopWindowsResult> => {
    if (!cuaAdapter) {
      return { ok: false, message: "The desktop driver is unavailable, so windows cannot be listed." };
    }
    const windows = await cuaAdapter.listWindows(process.pid);
    return {
      ok: true,
      windows: windows.map((window) => toWindowChoice(window)),
    };
  });

  /**
   * Record which window desktop actions may target.
   *
   * Only windows the driver actually reports are accepted, so the choice cannot name a window
   * that does not exist. Changing the target also revokes any current authorization: the previous
   * approval was for the previous window and must not carry over to a different one.
   */
  ipcMain.handle(IPC.setDesktopTarget, async (_event, windowId: unknown): Promise<SetDesktopTargetResult> => {
    if (typeof windowId !== "string" || windowId.length === 0) {
      return { ok: false, message: "No window was chosen." };
    }
    if (!cuaAdapter) {
      return { ok: false, message: "The desktop driver is unavailable, so a target cannot be set." };
    }
    const windows = await cuaAdapter.listWindows(process.pid);
    const match = windows.find((window) => String(window.windowId) === windowId);
    if (!match) {
      return { ok: false, message: "That window is no longer available." };
    }
    if (desktopTarget && desktopTarget.windowId !== windowId) {
      // Authority is bound to a window, so changing the window cannot keep it.
      desktopBroker?.revoke();
    }
    desktopTarget = toWindowChoice(match);
    return { ok: true, target: desktopTarget };
  });

  /**
   * Grant a desktop task after an explicit user decision in the window.
   *
   * This is the only path that creates authority, and it requires the caller to say what the
   * task is for. The grant is bound to the live session and generation, so it cannot outlive
   * the run it was approved for.
   */
  ipcMain.handle(IPC.authorizeDesktopTask, (_event, request: unknown) => {
    const parsed = parseAuthorizeRequest(request);
    if (!parsed) {
      lastDesktopProblem = "A desktop task needs a scope describing what it is for.";
      return desktopTaskStatus();
    }
    if (!desktopBroker || !session?.sessionId) {
      lastDesktopProblem =
        "The desktop driver or the Orb session is not available, so a task cannot be authorized.";
      return desktopTaskStatus();
    }
    if (generations.current !== parsed.generation) {
      lastDesktopProblem = "This request belongs to an earlier run and was refused.";
      return desktopTaskStatus();
    }
    lastDesktopProblem = null;
    desktopBroker.authorize({
      sessionId: session.sessionId,
      generation: parsed.generation,
      scope: parsed.scope,
    });
    return desktopTaskStatus();
  });

  ipcMain.handle(IPC.revokeDesktopTask, () => {
    // The user's explicit emergency stop: one call drops the task authority and any
    // unconfirmed screenshot, so nothing is left able to touch the desktop.
    revokeDesktopOperations("the user stopped desktop operations");
    lastDesktopProblem = null;
    return desktopTaskStatus();
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
): { generation: number; text: string; images: readonly ImageContent[] | undefined } | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const generation = record.generation;
  if (typeof generation !== "number" || !Number.isInteger(generation)) return null;
  const text = typeof record.text === "string" ? record.text : "";
  const images = parseImages(record.images);
  return { generation, text, images };
}

function parseCaptureRequest(
  value: unknown,
): { generation: number; text: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const generation = record.generation;
  if (typeof generation !== "number" || !Number.isInteger(generation)) return null;
  return { generation, text: typeof record.text === "string" ? record.text : "" };
}

/**
 * Parse a task authorization request.
 *
 * A blank scope is refused rather than defaulted: the user's approval has to say what it is
 * for, and the scope is what the window shows back to them.
 */
function parseAuthorizeRequest(value: unknown): { generation: number; scope: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const generation = record.generation;
  if (typeof generation !== "number" || !Number.isInteger(generation)) return null;
  const scope = typeof record.scope === "string" ? record.scope.trim() : "";
  if (scope.length === 0) return null;
  return { generation, scope };
}

function parseResolveRequest(
  value: unknown,
): { generation: number; observationId: string; confirmed: boolean } | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const generation = record.generation;
  const observationId = record.observationId;
  if (typeof generation !== "number" || !Number.isInteger(generation)) return null;
  if (typeof observationId !== "string" || observationId.length === 0) return null;
  return { generation, observationId, confirmed: record.confirmed === true };
}

/**
 * Accept only well-formed image blocks.
 *
 * The renderer is not a trusted boundary: it may be compromised, and a malformed
 * image would be rejected by pi-web only after the request was made. Rejecting here
 * keeps the failure local and prevents a path where the shape, rather than the
 * confirmation, decides what gets sent.
 */
function parseImages(value: unknown): readonly ImageContent[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const images: ImageContent[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (record.type !== "image") continue;
    if (typeof record.data !== "string" || typeof record.mimeType !== "string") continue;
    if (!record.mimeType.startsWith("image/")) continue;
    images.push({ type: "image", data: record.data, mimeType: record.mimeType });
  }
  return images.length > 0 ? images : undefined;
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
  // Shutdown must not leave an image waiting to be sent, nor a task grant a later run could inherit.
  revokeDesktopOperations("the shell is quitting");
  void bridge?.close();
  void cuaAdapter?.shutdown();
  removeHandshake(app.getPath("userData"));
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
  screenshotFlow = new ScreenshotFlow({
    readTarget: async (): Promise<CaptureTargetSnapshot | null> => {
      const target = await targetWindowReader.read(process.pid);
      return target ? { target, recordedAt: Date.now() } : null;
    },
    isStillForeground: (handle) => targetWindowReader.isStillForeground(handle),
    capture: (target) => captureTargetWindow(target),
    send: (text, images) => session.prompt(text, images),
  });
  const generation = generations.begin();
  session.beginGeneration(generation);

  registerIpc();
  createTray();
  window = createWindow();
  attachWakeController(window);
  registerShortcut();

  // The connection probe runs first: the window is already created, so its first snapshot must
  // carry a real answer rather than "unknown". Desktop startup is slower (it loads a native driver
  // and shells out for the recorded target) and is not needed for the first render.
  await refreshPiWebState();

  // Started so the extension can reach the shell as soon as a session exists, and so a driver
  // problem is reported rather than crashing startup.
  await startDesktop();
  await startBridge();

  // Record the window the user was looking at, before the orb can take focus. The same identity
  // then gates every desktop observation and action.
  await recordDesktopTarget();
});

/**
 * Record the current foreground window as the desktop target.
 *
 * Uses the same Win32 reader as the screenshot path, so there is one definition of "the window
 * the user was looking at" and one place that refuses to fall back to something else.
 */
async function recordDesktopTarget(): Promise<void> {
  try {
    const target = await targetWindowReader.read(process.pid);
    if (!target) {
      console.log("[pi-orb] no foreground window was available to record as the desktop target");
      return;
    }
    // Match the recorded window against the driver's own list so the stored choice carries the
    // driver's id: the two id spaces differ, and only the driver's id can be acted on.
    if (!cuaAdapter) return;
    const windows = await cuaAdapter.listWindows(process.pid);
    const match = windows.find(
      (window) => window.pid === target.processId && window.title === target.title,
    );
    if (match) {
      desktopTarget = toWindowChoice(match);
      console.log(`[pi-orb] desktop target recorded: pid ${target.processId} "${target.title}"`);
    } else {
      console.log(
        `[pi-orb] the foreground window (pid ${target.processId}) is not in the driver's window list; no target recorded`,
      );
    }
  } catch (error) {
    console.warn(`[pi-orb] could not record a desktop target: ${describeError(error)}`);
  }
}

/** Convert a driver window record into the shape the window shows the user. */
function toWindowChoice(window: CuaWindowInfo): DesktopWindowChoice {
  return {
    windowId: String(window.windowId),
    pid: window.pid ?? -1,
    appName: window.appName,
    title: window.title,
    bounds: window.bounds,
    zIndex: window.zIndex === undefined ? null : String(window.zIndex),
    isRecorded:
      desktopTarget !== null &&
      desktopTarget.pid === window.pid &&
      desktopTarget.title === window.title,
  };
}

app.on("window-all-closed", () => {
  // The orb is a tray application; closing the window keeps it running.
});

app.on("before-quit", () => {
  isQuitting = true;
  shortcuts.releaseAll();
  revokeDesktopOperations("the shell is quitting");
  void bridge?.close();
  void cuaAdapter?.shutdown();
  removeHandshake(app.getPath("userData"));
  session?.dispose();
});
