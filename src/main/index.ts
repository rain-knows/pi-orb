/**
 * Electron main process for pi-orb.
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
  ClipboardItem,
  clipboard,
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
import { ShortcutEdgeGuard } from "./shortcut-edge-guard";
import { DoubleAltDetector } from "./double-alt";
import { WakeController } from "./window-toggle";
import { OrbWindowLifecycle } from "./window-lifecycle";
import { OrbSessionController } from "./orb-session";
import { PiWebClient, PiWebError } from "./pi-web-client";
import { Win32TargetWindowReader } from "./target-window";
import { RecordedTargetStore } from "./recorded-target";
import { captureTargetWindow } from "./desktop-capture";
import { ScreenshotFlow } from "./screenshot-flow";
import { screenshotExportBytes, screenshotExportExtension } from "./screenshot-export";
import { BridgeServer, createBridgeToken, removeHandshake, writeHandshake } from "./bridge-server";
import { DesktopBroker } from "./desktop-broker";
import { ReferenceWindowsDriver, type ReferenceWindowInfo } from "./reference-windows-driver";
import {
  createObservationFrameWindow,
  hideObservationFrame,
  raiseOverlayAboveObservationFrame,
  showObservationFrame,
} from "./observation-frame";
import {
  IPC,
  type DesktopTaskStatus,
  type DesktopWindowChoice,
  type ImageContent,
  type OrbSessionEvent,
  type PiWebStatus,
  type ScreenshotCaptureResult,
  type ScreenshotResolveResult,
  type ScreenshotExportResult,
  type ListDesktopWindowsResult,
  type SetDesktopTargetResult,
  type WorkspaceStatus,
  type FloatingWindowState,
  type ListSessionHistoryResult,
  type OpenSessionHistoryResult,
  type OrbSelectionContext,
} from "@shared/ipc";
import { writeFile } from "node:fs/promises";
import { isOrbWorkspace, type OrbConfig } from "@shared/orb-config";
import { uIOhook } from "uiohook-napi";
import { FLOATING_BALL_WINDOW_SIZE } from "./floating-geometry";
import {
  clampFloatingWindow,
  initialFloatingBounds,
  moveFloatingBall,
  setFloatingExpanded,
  unsnapDockedBall,
} from "./floating-window-controller";
import { startSelectionMonitor, type SelectionMonitor } from "./selection-monitor";

const generations = new RunGenerations();
const shortcuts = new ShortcutRegistry(globalShortcut);
const shortcutEdgeGuard = new ShortcutEdgeGuard(uIOhook);
const doubleAltDetector = new DoubleAltDetector(uIOhook, () => { void triggerDoubleAlt(); });
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
let referenceDriver: ReferenceWindowsDriver | null = null;
let bridge: BridgeServer | null = null;

/**
 * The one record of the window the user was looking at.
 *
 * Written before the orb takes focus and shared by the screenshot path and the desktop tool path, so
 * there is exactly one answer to "which window is the user working with". Re-reading the foreground
 * window later would return the orb itself, because by then the user is interacting with the orb.
 */
const recordedTarget = new RecordedTargetStore({
  readForeground: () => targetWindowReader.read(process.pid),
  isStillValid: (handle, title) => targetWindowReader.isStillValid(handle, title),
  log: (message) => console.log(message),
});

/**
 * The window desktop actions may target.
 *
 * Chosen from the recorded window or by an explicit user selection, and always carrying the driver's
 * own window id: the driver's id space and the Win32 handle space are different, so only the driver's
 * id can be acted on.
 */
let desktopTarget: DesktopWindowChoice | null = null;

/**
 * The target `orb_open_app` moved the task to, when the model switched applications.
 *
 * Kept apart from {@link desktopTarget} so "the window the user recorded" and "the window the model
 * switched to" stay distinguishable: the recorded target is restored as soon as the user picks or
 * records another window, and both are dropped together when desktop authority is revoked. Only an
 * application the user already had running can set this; see
 * `ReferenceWindowsDriver#openApp` and the P2-04 rule in `doc/pi-orb-development-goals.md` §5.
 */
let openAppTarget: ReferenceWindowInfo | null = null;

let configPath = "";
let config: OrbConfig;
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let observationFrame: BrowserWindow | null = null;
let session: OrbSessionController;
let wake: WakeController | null = null;
let lifecycle: OrbWindowLifecycle | null = null;
let lastWorkspaceProblem: string | null = null;
let lastShortcutProblem: string | null = null;
let lastDesktopProblem: string | null = null;
let selectionMonitor: SelectionMonitor | undefined;
let selectionContext: OrbSelectionContext | null = null;
let isQuitting = false;
const piWebBaseUrl = process.env.PI_ORB_PI_WEB_URL ?? "http://127.0.0.1:30141";
const piWebPassword = process.env.PI_ORB_PI_WEB_PASSWORD;

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
    // A completed or failed turn cannot retain desktop authority. Revoke before releasing the
    // generation lock so the next turn always starts without a stale target or active action.
    revokeDesktopOperations(event.type === "idle" ? "the turn completed" : "the turn failed");
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
  const initial = initialFloatingBounds();
  const savedBallBounds = config.window.width <= 96 && config.window.height <= 96;
  const win = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    ...(savedBallBounds && config.window.x !== null ? { x: config.window.x } : { x: initial.x }),
    ...(savedBallBounds && config.window.y !== null ? { y: config.window.y } : { y: initial.y }),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: config.window.alwaysOnTop,
    skipTaskbar: true,
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
    // The reference shell persists the ball position, not the transient panel bounds. Dock tabs
    // are also transient and intentionally snap back to the last visible ball on restart.
    if (bounds.width !== FLOATING_BALL_WINDOW_SIZE || bounds.height !== FLOATING_BALL_WINDOW_SIZE) return;
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

/** Best-effort visible label for the process that owns a native text selection. */
function selectionSourceLabel(pid: number | null): string | null {
  if (pid === null) return null;
  try {
    const match = referenceDriver?.listWindows().find((candidate) => candidate.pid === pid);
    if (match) return match.title || match.appName || `Process ${pid}`;
  } catch {
    // Source labels are advisory and must never make selection capture fail.
  }
  return `Process ${pid}`;
}

async function startNativeSelectionMonitor(): Promise<void> {
  if (!config.orbWorkspace || !validateWorkspace(config.orbWorkspace).ok) return;
  selectionMonitor = await startSelectionMonitor({
    onSelection: (event) => {
      selectionContext = {
        text: event.text,
        pid: event.pid,
        sourceLabel: selectionSourceLabel(event.pid),
        bounds: event.bounds,
        capturedAt: Date.now(),
      };
      if (window && !window.isDestroyed()) {
        window.webContents.send(IPC.selectionContext, selectionContext);
      }
    },
  });
  selectionMonitor?.setExcludePids([process.pid]);
}

function clearSelectionContext(): void {
  selectionContext = null;
  if (window && !window.isDestroyed()) window.webContents.send(IPC.selectionContext, null);
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
    const [{ createProductionWindowsOps }, { createWindowsDesktopBackend }] = await Promise.all([
      import("./reference-windows/windows-native"),
      import("./reference-windows/windows"),
    ]);
    const ops = createProductionWindowsOps();
    referenceDriver = new ReferenceWindowsDriver({
      ops,
      backend: createWindowsDesktopBackend(ops),
      ownProcessId: process.pid,
      resolveRecordedTarget: () => {
        if (openAppTarget) {
          return {
            handle: String(openAppTarget.windowId),
            pid: openAppTarget.pid,
            title: openAppTarget.title,
          };
        }
        if (desktopTarget) {
          return {
            handle: desktopTarget.windowId,
            pid: desktopTarget.pid,
            title: desktopTarget.title,
          };
        }
        const target = recordedTarget.snapshot?.target;
        return target
          ? { handle: target.handle, pid: target.processId, title: target.title }
          : undefined;
      },
      onTargetChanged: (target) => {
        // Reported, not silent: the panel shows the window the next action will land on, and the
        // user can revoke. `openAppTarget` outranks the recorded window until the user picks one.
        openAppTarget = target;
        desktopTarget = toWindowChoice(target);
        console.log(
          `[pi-orb] desktop target moved to "${target.title}" (${target.appName}) by an open-app action`,
        );
      },
      withGuiTurn: async <T>(run: () => Promise<T>): Promise<T> => {
        const current = window;
        if (!current || current.isDestroyed()) return run();
        const wasVisible = current.isVisible();
        current.setIgnoreMouseEvents(true, { forward: true });
        if (wasVisible) current.hide();
        // Bracket the desktop action with the observation ribbon: the orb is hidden for the duration,
        // and the ribbon is what tells the user which window the grant currently covers. It is shown
        // here rather than around each action because every desktop operation already funnels through
        // this turn, which is also the boundary the reference uses.
        showObservationFrameForTarget();
        try {
          return await run();
        } finally {
          hideObservationFrame(observationFrame ?? undefined);
          if (!current.isDestroyed()) {
            current.setIgnoreMouseEvents(false);
            if (wasVisible) current.showInactive();
            // The ribbon's `showInactive` can restack same-level panels, so the orb's higher level is
            // re-asserted after it comes back rather than only at creation.
            raiseOverlayAboveObservationFrame(current);
          }
        }
      },
    });
  } catch (error) {
    console.warn(`[pi-orb] desktop driver unavailable: ${describeError(error)}`);
    referenceDriver = null;
  }

  if (!referenceDriver) return;

  desktopBroker = new DesktopBroker({
    driver: referenceDriver,
    isLive: (sessionId, generation) =>
      generations.current === generation && session?.sessionId === sessionId,
    log: (entry) => {
      // Structured, desensitized: action kind and reason only, never typed text or pixels.
      console.log(`[pi-orb] desktop ${JSON.stringify(entry)}`);
    },
  });
}

/**
 * The bridge token for this run.
 *
 * Kept so the handshake can be rewritten with a new generation without rotating the token: the token
 * authenticates the run, the generation bounds the authority, and only the latter changes mid-run.
 */
let bridgeToken: string | null = null;

/**
 * Publish the bridge handshake with the current run generation.
 *
 * The extension reads this file to learn the pipe, the token and the generation. It has to be
 * rewritten whenever the generation changes, otherwise the extension would keep sending the previous
 * generation and every desktop request would be refused as stale — the tools would silently never
 * work.
 */
function publishHandshake(): void {
  if (!bridgeToken) return;
  try {
    writeHandshake(
      app.getPath("userData"),
      bridgeToken,
      config.orbWorkspace ?? "",
      process.pid,
      generations.current,
    );
  } catch (error) {
    console.warn(`[pi-orb] could not publish the bridge handshake: ${describeError(error)}`);
  }
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
  bridgeToken = token;
  publishHandshake();
  const handshake = writeHandshake(
    app.getPath("userData"),
    token,
    config.orbWorkspace ?? "",
    process.pid,
    generations.current,
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
      /**
       * Admit only the live run's session and generation, and say which of the two failed.
       *
       * The Orb session is created lazily, so before it exists there is no session the shell can
       * accept. Reporting that as `stale-generation` would tell the user their run is stale when the
       * real situation is that no Orb session has been started yet.
       */
      accepts: (sessionId, generation) => {
        if (!session?.sessionId || session.sessionId !== sessionId) {
          return { ok: false, reason: "unknown-session" as const };
        }
        if (generations.current !== generation) {
          return { ok: false, reason: "stale-generation" as const };
        }
        return { ok: true };
      },
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
 * restarts or stops the service: pi-orb connects to an existing pi-web and
 * reports when there is none (invariant N4).
 */
async function refreshPiWebState(): Promise<void> {
  if (!(await client.probeService())) {
    piWebState = {
      baseUrl: client.baseUrl,
      reachable: false,
      problem: `No pi-web service answered at ${client.baseUrl}. Start it yourself; Orb will not start, restart or stop it.`,
    };
    markDisconnected();
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
    markDisconnected();
    return;
  }
  if (piWebState.reachable === false) {
    // A reconnect must not silently resume a desktop task that was granted for a session that died
    // while the connection was down.
    desktopBroker?.revoke();
  }
  piWebState = { baseUrl: client.baseUrl, reachable: true, problem: null };
}

/**
 * Handle a lost or unusable pi-web connection.
 *
 * The contract (doc/pi-orb-development-goals.md §6.1, P1-07) is that a disconnect revokes desktop
 * authority: the task was approved for a session in a run that no longer exists, so keeping the
 * grant would let a later connection continue acting on an approval nobody can see. The session
 * binding is dropped too, so the next session is a new one rather than a reused id.
 */
function markDisconnected(): void {
  const hadAuthority = desktopBroker?.status().authorized === true;
  if (hadAuthority) {
    revokeDesktopOperations("the pi-web connection was lost");
  }
}

function registerShortcut(): void {
  if (!shortcutEdgeGuard.enabled) {
    lastShortcutProblem = shortcutEdgeGuard.error ?? "Keyboard edge detection is unavailable.";
    shortcuts.release();
    console.warn(`[pi-orb] ${lastShortcutProblem}`);
    return;
  }
  const result = shortcuts.apply(config.shortcut, onShortcutTrigger);
  if (!result.registered) {
    console.warn(`[pi-orb] wake shortcut not registered: ${result.reason}`);
  } else {
    shortcutEdgeGuard.configure(result.accelerator);
    if (shortcutEdgeGuard.error) {
      shortcuts.release();
      lastShortcutProblem = shortcutEdgeGuard.error;
      console.warn(`[pi-orb] ${shortcutEdgeGuard.error}`);
      return;
    }
    lastShortcutProblem = null;
  }
}

function onShortcutTrigger(): void {
  if (shortcutEdgeGuard.accept()) void wake?.trigger("shortcut");
}

/**
 * Double Alt is a gesture, not a second upload path: record the target before the Orb takes focus,
 * then ask the renderer to open the existing one-shot screenshot preview.
 */
async function triggerDoubleAlt(): Promise<void> {
  await showOrb();
  if (window && !window.isDestroyed()) window.webContents.send(IPC.doubleAltGesture);
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
        // Hiding is a lifecycle transition, so collapse the BrowserWindow before it becomes
        // invisible. This keeps wake-up geometry at the reference 96x96 ball instead of retaining
        // a transparent 344x444 panel around the next ball.
        if (!win.isDestroyed()) setFloatingExpanded(win, false);
        if (!win.isDestroyed()) win.hide();
      },
      isDestroyed: () => win.isDestroyed(),
    },
    {
      revokeDesktopTask: () => desktopBroker?.revoke(),
      discardPendingCapture: () => screenshotFlow?.discard(),
      // Collapse is the route users actually take, so the record must be dropped here too. The
      // revocation routine below documents this exact rule for a collapse, but only the tray, the
      // shortcut and the window button reach this object, and it previously left the record in place.
      clearRecordedTarget: () => recordedTarget.clear(),
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
    wake: async () => {
      if (win.isDestroyed()) return;
      // Record the target BEFORE showing the window. Once the orb takes focus the window the user
      // was looking at is no longer the foreground window, so a recording taken afterwards would
      // capture the orb itself. This ordering is the whole reason the wake path is where the record
      // is written.
      const outcome = await recordedTarget.record();
      if (outcome.ok) {
        // Keep the desktop target consistent with the same record, so the screenshot path and the
        // desktop tool path cannot disagree about which window the user means.
        await syncDesktopTargetFromRecord();
      }
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
  // The record of "the window the user was looking at" also stops being current here: after a
  // collapse the user is no longer working with that window, so keeping it would let a later capture
  // silently reuse a window the user has moved on from. A fresh wake records a fresh target.
  recordedTarget.clear();
  desktopTarget = null;
  openAppTarget = null;
  // The ribbon marks where the grant applies, so it goes away in the same breath as the grant. This
  // is the single revoke exit (collapse, stop, turn end, disconnect), which is why the ribbon is
  // hidden here rather than at each caller.
  hideObservationFrame(observationFrame ?? undefined);
  if (hadAuthority || hadCapture) {
    console.log(`[pi-orb] desktop operations revoked: ${reason}`);
  }
}

/**
 * Draw the observation ribbon around the window the next desktop action will land on.
 *
 * Best effort by design: a ribbon that cannot be placed must never fail the action it is only
 * annotating. It is skipped entirely when no target is recorded (nothing to mark) or when its bounds
 * are empty, because a zero-area ribbon would read as a grant over nothing.
 */
function showObservationFrameForTarget(): void {
  const bounds = referenceDriver?.targetBounds();
  if (!bounds || bounds.width < 2 || bounds.height < 2) return;
  try {
    observationFrame ??= createObservationFrameWindow();
    if (observationFrame.isDestroyed()) {
      observationFrame = createObservationFrameWindow();
    }
    if (observationFrame.webContents.getURL() === "") {
      void observationFrame.loadFile(join(__dirname, "../renderer/observation-frame.html"));
    }
    showObservationFrame(observationFrame, bounds);
  } catch (error) {
    console.warn(`[pi-orb] observation frame unavailable: ${describeError(error)}`);
  }
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("pi-orb");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      // "Show" is an explicit wake, not a toggle: a menu item labelled Show must never hide a focused
      // orb. It records the target before showing for the same reason the shortcut does.
      { label: "Show orb", click: () => void showOrb() },
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
  ipcMain.handle(IPC.getSelectionContext, () => selectionContext);
  ipcMain.handle(IPC.clearSelectionContext, () => {
    clearSelectionContext();
    return true;
  });

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
    if (!shortcutEdgeGuard.enabled) {
      lastShortcutProblem = shortcutEdgeGuard.error ?? "Keyboard edge detection is unavailable.";
      return currentStatus();
    }
    const previous = config.shortcut;
    const result = shortcuts.apply(candidate, onShortcutTrigger);
    if (!result.registered) {
      // Do not persist a shortcut that does not work, and put the previous one back
      // so the orb stays reachable. The reason still reaches the user through the
      // status snapshot.
      lastShortcutProblem = result.reason;
      const restored = shortcuts.apply(previous, onShortcutTrigger);
      if (restored.registered) shortcutEdgeGuard.configure(restored.accelerator);
      return currentStatus();
    }
    lastShortcutProblem = null;
    shortcutEdgeGuard.configure(result.accelerator);
    if (shortcutEdgeGuard.error) {
      shortcuts.release();
      lastShortcutProblem = shortcutEdgeGuard.error;
      console.warn(`[pi-orb] ${shortcutEdgeGuard.error}`);
      return currentStatus();
    }
    // Persist the canonical form that was actually registered, not the raw input.
    config = { ...config, shortcut: result.accelerator };
    saveOrbConfig(configPath, config);
    return currentStatus();
  });

  ipcMain.handle(IPC.setFloatingExpanded, (_event, expanded: unknown): FloatingWindowState => {
    if (typeof expanded !== "boolean" || !window || window.isDestroyed()) {
      return { expanded: false, horizontal: "right", vertical: "down", docked: undefined };
    }
    const state = setFloatingExpanded(window, expanded);
    return state;
  });
  ipcMain.handle(IPC.moveFloatingBall, (_event, x: unknown, y: unknown): FloatingWindowState => {
    if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y) || !window || window.isDestroyed()) {
      throw new Error("Malformed floating ball position.");
    }
    return moveFloatingBall(window, x, y);
  });
  // Both dock operations now resolve after their slide completes, so the renderer's returned state
  // describes the settled window rather than a position the animation is still passing through.
  ipcMain.handle(IPC.clampFloatingBall, async (): Promise<FloatingWindowState> => {
    if (!window || window.isDestroyed()) return { expanded: false, horizontal: "right", vertical: "down", docked: undefined };
    return clampFloatingWindow(window);
  });
  ipcMain.handle(IPC.unsnapFloatingBall, async (): Promise<FloatingWindowState> => {
    if (!window || window.isDestroyed()) return { expanded: false, horizontal: "right", vertical: "down", docked: undefined };
    return unsnapDockedBall(window);
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
      clearSelectionContext();
      if (!selectionMonitor) await startNativeSelectionMonitor();
      const generation = generations.begin();
      session.beginGeneration(generation);
      // The extension must learn the new generation, or its next request would be refused as stale.
      publishHandshake();
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

  ipcMain.handle(IPC.newConversation, async () => {
    const validation = config.orbWorkspace ? validateWorkspace(config.orbWorkspace) : null;
    if (!validation?.ok || !validation.resolved) {
      throw new Error("Select a usable Orb workspace first.");
    }
    if (!isOrbWorkspace(validation.resolved, config.orbWorkspace)) {
      throw new Error("The configured workspace no longer matches its resolved path.");
    }
    if (generations.busy || session.running) {
      throw new Error("Finish or stop the current conversation before starting a new one.");
    }
    revokeDesktopOperations("a new conversation started");
    clearSelectionContext();
    try {
      return await session.newConversation(validation.resolved);
    } catch (error) {
      throw new Error(describeError(error));
    }
  });

  ipcMain.handle(IPC.listSessionHistory, async (): Promise<ListSessionHistoryResult> => {
    const validation = config.orbWorkspace ? validateWorkspace(config.orbWorkspace) : null;
    if (!validation?.ok || !validation.resolved) return { ok: false, message: "Select a usable Orb workspace first." };
    try {
      const sessions = await client.listSessions();
      return {
        ok: true,
        sessions: sessions
          .filter((item) => isOrbWorkspace(item.cwd, validation.resolved))
          .map((item) => ({
            sessionId: item.id,
            name: item.name ?? null,
            modified: item.modified,
            firstMessage: item.firstMessage,
            messageCount: item.messageCount,
          })),
      };
    } catch (error) {
      return { ok: false, message: describeError(error) };
    }
  });

  ipcMain.handle(IPC.openSessionHistory, async (_event, sessionId: unknown): Promise<OpenSessionHistoryResult> => {
    if (typeof sessionId !== "string" || sessionId.length === 0) return { ok: false, message: "Malformed session id." };
    const validation = config.orbWorkspace ? validateWorkspace(config.orbWorkspace) : null;
    if (!validation?.ok || !validation.resolved) return { ok: false, message: "Select a usable Orb workspace first." };
    if (generations.busy || session.running) return { ok: false, message: "Finish or stop the current conversation before opening history." };
    try {
      const snapshot = await client.getSessionHistory(sessionId);
      if (!isOrbWorkspace(snapshot.cwd, validation.resolved)) return { ok: false, message: "That session is outside the Orb workspace." };
      revokeDesktopOperations("a history session was opened");
      await session.openExistingSession(validation.resolved, sessionId);
      return { ok: true, sessionId, messages: snapshot.messages };
    } catch (error) {
      return { ok: false, message: describeError(error) };
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

  ipcMain.handle(
    IPC.exportScreenshot,
    async (_event, request: unknown): Promise<ScreenshotExportResult> => {
      const parsed = parseExportRequest(request);
      if (!parsed) return { ok: false, canceled: false, message: "Malformed screenshot export request." };
      const check = generations.check(parsed.generation);
      if (!check.ok) return { ok: false, canceled: false, message: describeGenerationFailure(check.reason) };
      const pending = screenshotFlow.pending;
      if (!pending || pending.observationId !== parsed.observationId) {
        return { ok: false, canceled: false, message: "That screenshot is no longer waiting in the preview." };
      }
      const extension = screenshotExportExtension(pending.image.mimeType);
      if (!extension) return { ok: false, canceled: false, message: "This screenshot format cannot be exported." };
      const result = await dialog.showSaveDialog({
        title: "Save screenshot",
        defaultPath: join(app.getPath("desktop"), `pi-orb-${Date.now()}.${extension}`),
        filters: [{ name: "Screenshot", extensions: [extension] }],
      });
      if (result.canceled || !result.filePath) {
        return { ok: false, canceled: true, message: "Screenshot export cancelled." };
      }
      try {
        const bytes = screenshotExportBytes(pending.image);
        await writeFile(result.filePath, bytes, { flag: "wx" });
        let clipboardCopied = false;
        try {
          const clipboardBytes = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(clipboardBytes).set(bytes);
          await clipboard.write([
            new ClipboardItem({
              [pending.image.mimeType]: new Blob([clipboardBytes], { type: pending.image.mimeType }),
            }),
          ]);
          clipboardCopied = true;
        } catch {
          // Saving is still useful when the OS clipboard is unavailable.
        }
        return { ok: true, path: result.filePath, clipboard: clipboardCopied };
      } catch (error) {
        return { ok: false, canceled: false, message: describeError(error) };
      }
    },
  );

  ipcMain.handle(IPC.discardScreenshot, () => {
    screenshotFlow.discard();
    return true;
  });
  ipcMain.handle(IPC.getDesktopTaskStatus, () => desktopTaskStatus());

  ipcMain.handle(IPC.listDesktopWindows, async (): Promise<ListDesktopWindowsResult> => {
    if (!referenceDriver) {
      return { ok: false, message: "The desktop driver is unavailable, so windows cannot be listed." };
    }
    const windows = referenceDriver.listWindows();
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
    if (!referenceDriver) {
      return { ok: false, message: "The desktop driver is unavailable, so a target cannot be set." };
    }
    const windows = referenceDriver.listWindows();
    const match = windows.find((window) => String(window.windowId) === windowId);
    if (!match) {
      return { ok: false, message: "That window is no longer available." };
    }
    if (desktopTarget && desktopTarget.windowId !== windowId) {
      // Authority is bound to a window, so changing the window cannot keep it.
      desktopBroker?.revoke();
    }
    // An explicit user choice supersedes whatever an open-app action had switched to.
    openAppTarget = null;
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
    // Revoke before awaiting pi-web's cooperative abort. A provider may take time to unwind, but
    // native desktop input must stop immediately when the user presses Stop.
    revokeDesktopOperations("the user stopped the running turn");
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

function parseExportRequest(
  value: unknown,
): { generation: number; observationId: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const generation = record.generation;
  const observationId = record.observationId;
  if (typeof generation !== "number" || !Number.isInteger(generation)) return null;
  if (typeof observationId !== "string" || observationId.length === 0) return null;
  return { generation, observationId };
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
  selectionMonitor?.stop();
  selectionMonitor = undefined;
  clearSelectionContext();
  doubleAltDetector.stop();
  shortcutEdgeGuard.stop();
  shortcuts.releaseAll();
  // Shutdown must not leave an image waiting to be sent, nor a task grant a later run could inherit.
  revokeDesktopOperations("the shell is quitting");
  if (observationFrame && !observationFrame.isDestroyed()) observationFrame.destroy();
  void bridge?.close();
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
    // The flow consumes the record taken before the orb took focus. It deliberately does not read
    // the foreground window: at this point the orb holds focus, so a fresh lookup would always
    // return the orb and the positive capture path could never run.
    recordedTarget,
    capture: (target) => captureTargetWindow(target),
    send: (text, images) => session.prompt(text, images),
  });
  const generation = generations.begin();
  session.beginGeneration(generation);

  registerIpc();
  createTray();
  window = createWindow();
  await startNativeSelectionMonitor();
  attachWakeController(window);
  if (!shortcutEdgeGuard.start()) {
    console.warn(`[pi-orb] ${shortcutEdgeGuard.error ?? "Keyboard edge detection is unavailable."}`);
  } else {
    doubleAltDetector.start();
  }
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
 * Show the orb, recording the target window first.
 *
 * Used by the tray menu, where a label that says "Show" must not toggle. Recording before showing is
 * the same ordering rule the wake shortcut follows, because once the orb is in front the window the
 * user was looking at cannot be read any more.
 */
async function showOrb(): Promise<void> {
  if (!window || window.isDestroyed()) return;
  const outcome = await recordedTarget.record();
  if (outcome.ok) await syncDesktopTargetFromRecord();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/**
 * Align the desktop tool target with the recorded window.
 *
 * The driver's window list is the only source of a usable window id, so the recorded window is
 * matched into it by (process id, title). When the recorded window is not in the list, the target is
 * cleared rather than retaining a stale driver id that may now refer to a different window.
 */
async function syncDesktopTargetFromRecord(): Promise<void> {
  const snapshot = recordedTarget.snapshot;
  if (!snapshot || !referenceDriver) return;
  // A window the user records is the user's choice, so it replaces an open-app switch.
  openAppTarget = null;
  const windows = referenceDriver.listWindows();
  const match = windows.find(
    (window) => window.pid === snapshot.target.processId && window.title === snapshot.target.title,
  );
  if (match) {
    desktopTarget = toWindowChoice(match);
  } else {
    desktopTarget = null;
    console.log(
      `[pi-orb] the recorded window (pid ${snapshot.target.processId}) is not in the driver's window list; the desktop target was cleared`,
    );
  }
}

/**
 * Record the current foreground window as the target, outside a wake.
 *
 * Used at startup so the app has a target even if the user never wakes it with the shortcut, and by
 * the window picker when the user changes their mind. Every path goes through the same store, so
 * "the recorded window" has one meaning.
 */
async function recordDesktopTarget(): Promise<void> {
  const outcome = await recordedTarget.record();
  if (!outcome.ok) {
    console.log("[pi-orb] no foreground window was available to record as the desktop target");
    return;
  }
  await syncDesktopTargetFromRecord();
}

/** Convert a driver window record into the shape the window shows the user. */
function toWindowChoice(window: ReferenceWindowInfo): DesktopWindowChoice {
  const recorded = recordedTarget.snapshot?.target;
  return {
    windowId: String(window.windowId),
    pid: window.pid ?? -1,
    appName: window.appName,
    title: window.title,
    bounds: window.bounds,
    zIndex: window.zIndex === undefined ? null : String(window.zIndex),
    // "Recorded" keeps its exact meaning — the window the user recorded before the Orb took
    // focus. A window the model switched to carries the target without being recorded, so the
    // picker must not claim the user chose it.
    isRecorded:
      recorded !== undefined &&
      recorded.processId === window.pid &&
      recorded.title === window.title,
  };
}

app.on("window-all-closed", () => {
  // The orb is a tray application; closing the window keeps it running.
});

app.on("before-quit", () => {
  isQuitting = true;
  selectionMonitor?.stop();
  selectionMonitor = undefined;
  clearSelectionContext();
  doubleAltDetector.stop();
  shortcuts.releaseAll();
  revokeDesktopOperations("the shell is quitting");
  void bridge?.close();
  removeHandshake(app.getPath("userData"));
  session?.dispose();
});
