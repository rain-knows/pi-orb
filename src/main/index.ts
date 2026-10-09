/**
 * Electron main process for pi-orb.
 *
 * Responsibilities (doc/product-contract.md):
 *  - own the window, tray and global wake shortcut,
 *  - own the Orb configuration file,
 *  - proxy every pi-web API/SSE call, because a sandboxed renderer with an
 *    opaque origin cannot call pi-web directly (measured 403, doc/process-boundaries.md),
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
  powerMonitor,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
  shell,
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
import { CodeAgentManager } from "./code-agent-manager";
import { codeAgentRegistryPath } from "../shared/code-agent";
import { PiWebClient, PiWebError } from "./pi-web-client";
import { Win32TargetWindowReader } from "./target-window";
import { RecordedTargetStore } from "./recorded-target";
import { captureTargetWindow } from "./desktop-capture";
import { ScreenshotFlow } from "./screenshot-flow";
import { screenshotExportBytes, screenshotExportExtension } from "./screenshot-export";
import { BridgeServer, createBridgeToken, removeHandshake, writeHandshake } from "./bridge-server";
import { DesktopBroker } from "./desktop-broker";
import { ReferenceWindowsDriver } from "./reference-windows-driver";
import { applyFloatingOverlayGuard, resetFloatingOverlayGuard, OVERLAY_GUARD_INPUT_APPLY_MS } from "./floating-overlay-guard";
import { delay } from "./reference-windows/wait";
import {
  createObservationFrameWindow,
  hideObservationFrame,
  raiseOverlayAboveObservationFrame,
  showObservationFrame,
} from "./observation-frame";
import { showShellMenu, type ShellMenuRequest } from "./shell-menu";
import { ObservationFramePreference } from "./observation-frame-preference";
import {
  IPC,
  type DesktopTaskStatus,
  type ImageContent,
  type OrbSessionEvent,
  type PiWebStatus,
  type ScreenshotCaptureResult,
  type ScreenshotResolveResult,
  type ScreenshotExportResult,
  type OrbAccessLevel,
  type WorkspaceStatus,
  type FloatingWindowState,
  type ListSessionHistoryResult,
  type OpenSessionHistoryResult,
  type OrbSelectionContext,
  type ListModelsResult,
  type SetModelResult,
} from "@shared/ipc";
import { writeFile } from "node:fs/promises";
import { isOrbWorkspace, type OrbConfig } from "@shared/orb-config";
import { uIOhook } from "uiohook-napi";
import { FLOATING_BALL_WINDOW_SIZE } from "./floating-geometry";
import {
  clampFloatingWindow,
  initialFloatingBounds,
  pressFloatingBall, beginFloatingDrag, moveFloatingDrag, endFloatingDrag, setFloatingAgentStrip,
  setFloatingExpanded,
  unsnapDockedBall,
} from "./floating-window-controller";
import { startSelectionMonitor, type SelectionMonitor } from "./selection-monitor";
import { preparePersonalStartup, probePersonalPiWeb, removeBundledPlugin } from "./personal-startup";
import { mkdirSync, readFileSync } from "node:fs";

// Electron's Chromium switch does not by itself relocate main-process configuration/handshake.
// Make an explicit profile override consistent before the lock or installer cleanup uses it.
const profileDirectory = app.commandLine.getSwitchValue("user-data-dir");
if (profileDirectory) {
  mkdirSync(profileDirectory, { recursive: true });
  app.setPath("userData", profileDirectory);
}

// Installer cleanup never owns a window or bridge.
if (process.argv.includes("--remove-bundled-plugin")) {
  try {
    removeBundledPlugin(app.getPath("userData"), join(process.resourcesPath, "pi-plugin"));
    app.exit(0);
  } catch { app.exit(1); }
}
// A secondary instance must exit before hooks or handshake ownership, including quit cleanup.
if (!app.requestSingleInstanceLock()) app.exit(0);
let wakeAfterStartup = false;
app.on("second-instance", () => {
  if (!window || window.isDestroyed()) wakeAfterStartup = true;
  else void showOrb();
});

const generations = new RunGenerations();
const shortcuts = new ShortcutRegistry(globalShortcut);
const shortcutEdgeGuard = new ShortcutEdgeGuard(uIOhook);
const doubleAltDetector = new DoubleAltDetector(uIOhook, () => { void triggerDoubleAlt(); });
const targetWindowReader = new Win32TargetWindowReader();

/**
 * The screenshot consent flow.
 *
 * It is constructed after `session` exists because it sends through it. The telegram
 * of rules — select a non-Orb target when requested, never fall back to a full-screen
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
 * The window shown in the explicit screenshot review flow.
 *
 * Explicit screenshot preview selects the current topmost non-Orb window when requested.
 */
const recordedTarget = new RecordedTargetStore({
  readForeground: async () => referenceDriver?.captureTarget() ?? null,
  isStillValid: (handle, title) => targetWindowReader.isStillValid(handle, title),
  log: (message) => console.log(message),
});

let configPath = "";
let config: OrbConfig;
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let observationFrame: BrowserWindow | null = null;
let observationFramePreference: ObservationFramePreference;
let session: OrbSessionController;
let codeAgents: CodeAgentManager | null = null;
/** Caller title cache ported from mini-yifan/dsh-orb-cordis@aa79308e47265b7d4a774edb688de2bbd7dce66e,
 * packages/host/src/orb.ts (MIT). Pi's public session summaries replace dsh history records. */
let callerTitles: { at: number; byId: Map<string, string> } | undefined;
let callerTitlesTask: Promise<void> | undefined;
function refreshCallerTitles(): void {
  if (callerTitles !== undefined && Date.now() - callerTitles.at < 10_000) return;
  callerTitlesTask ??= client.listSessions().then(rows => {
    const byId = new Map<string, string>();
    for (const row of rows) {
      const title = row.name?.trim() || row.firstMessage.trim().slice(0, 80);
      if (title) byId.set(row.id, title);
    }
    callerTitles = { at: Date.now(), byId };
  }).catch(error => console.error("[pi-orb] bookmark titles", describeError(error)))
    .finally(() => { callerTitlesTask = undefined; });
}
let wake: WakeController | null = null;
let lifecycle: OrbWindowLifecycle | null = null;
let lastWorkspaceProblem: string | null = null;
let lastShortcutProblem: string | null = null;
let lastDesktopProblem: string | null = null;
// The reference Orb ships with Full Access selected. Apply it once to each new Orb session;
// Stop and hide revoke it. An explicit reopen or new session selects Full Access again.
let defaultAccessPending = true;
let accessRevision = 0;

function grantDefaultAccess(sessionId: string, generation: number): void {
  if (!defaultAccessPending || !desktopBroker || generations.current !== generation || session.sessionId !== sessionId) return;
  desktopBroker.authorize({ sessionId, generation, level: "full-access" });
  publishHandshake();
  defaultAccessPending = false;
  lastDesktopProblem = null;
}
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
  if (event.type === "idle" || event.type === "error") hideObservationFrame(observationFrame ?? undefined);
  if (event.type === "idle") {
    // The full prompt queue has drained. A turn ending between queued prompts is not idle.
    // Release the prompt lock only; session-level desktop Access is intentionally preserved.
    //
    // Released against the controller's own generation, not `generations.current`:
    // a turn that ends after a workspace switch must not free the new run's lock.
    generations.release(session.generation);
    if (session.sessionId && event.stopReason !== "aborted") void codeAgents?.deliverPending(session.sessionId);
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
    icon: createTrayIcon(),
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
 * Report the current session Access state, defaulting to "not authorized" when no broker exists.
 *
 * The default matters: a missing broker must read as "the orb may not touch the desktop",
 * never as "unknown, so probably fine".
 */
function desktopTaskStatus(): DesktopTaskStatus {
  if (!desktopBroker) {
    return {
      authorized: false,
      level: null,
      sessionId: null,
      generation: null,
      stopped: false,
      stoppedReason: null,
      bridgeReady: bridge !== null,
    };
  }
  return { ...desktopBroker.status(), bridgeReady: bridge !== null };
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
      onTargetChanged: () => showObservationFrameForTarget(),
      withGuiTurn: async <T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
        const current = window;
        if (!current || current.isDestroyed()) return run();
        // Reference cloak keeps the transcript visible and excludes it from GDI captures.
        // Counts pair overlapping turns; a capture finishing cannot restore hit testing during HID.
        applyFloatingOverlayGuard(current, "input", "begin");
        try {
          await delay(OVERLAY_GUARD_INPUT_APPLY_MS, signal ?? new AbortController().signal);
          showObservationFrameForTarget();
          return await run();
        } finally {
          if (!current.isDestroyed()) {
            applyFloatingOverlayGuard(current, "input", "end");
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
      if (entry.event === "authorize" || entry.event === "revoke") emit({ type: "access", status: desktopTaskStatus() });
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
      session?.sessionId ?? null,
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
    session?.sessionId ?? null,
  );
  bridge = new BridgeServer({
    pipePath: handshake.pipePath,
    token,
    executor: {
      observe: async (input) => {
        const broker = requireBroker();
        return broker.observe(input.sessionId, input.generation, input.signal);
      },
      act: async (action, sessionId, generation, signal) => {
        const broker = requireBroker();
        return broker.act(action, sessionId, generation, signal);
      },
      codeAgent: async (command, args, sessionId, _generation, signal) => {
        if (!codeAgents || !session.workspace) throw new Error("Code agent sessions are unavailable.");
        if (command === "status") return codeAgents.status(sessionId);
        if (command === "stop") {
          const id = (args as { session_id?: unknown })?.session_id;
          if (typeof id !== "string" || !id.trim()) throw new Error("code_agent_stop requires session_id.");
          return codeAgents.stop(sessionId, id);
        }
        const access = requireBroker().status();
        if (!access.authorized || access.sessionId !== sessionId || !access.level) throw new Error("Code agent dispatch requires the calling session's Access grant.");
        return codeAgents.dispatch(sessionId, session.workspace, access.level, args, signal);
      },
      status: () => desktopTaskStatus(),
      revoke: () => revokeDesktopOperations("the bridge revoked Access"),
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
      problem: `未连接到 ${client.baseUrl}。请检查 Pi Web 服务或重新打开 Orb；启动日志位于 Orb 用户数据目录。`,
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
  if (piWebState.reachable === false && desktopBroker) {
    // A reconnect must not silently resume a desktop task that was granted for a session that died
    // while the connection was down.
    revokeDesktopOperations("the pi-web connection was re-established");
  }
  piWebState = { baseUrl: client.baseUrl, reachable: true, problem: null };
}

/**
 * Handle a lost or unusable pi-web connection.
 *
 * The contract (doc/product-contract.md, P1-07) is that a disconnect revokes desktop
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
 * Double Alt opens the same one-shot screenshot preview as the menu action.
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
      revokeOrbAccess: () => revokeDesktopOperations("the orb was hidden"),
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
      // The reposition-then-show sequence is shared with `showOrb` rather than repeated here: the two
      // paths had already diverged once on exactly this step (neither clamped), and a second copy is
      // how the next divergence would start.
      await presentOrb(win);
    },
    collapse: () => {
      lifecycle?.collapse();
    },
  });
}

/**
 * Recover the keyboard-edge state after the OS stops delivering key-up events.
 *
 * P2-02 requires that locking the screen or sleeping leaves no key stuck, and both keyboard features
 * depend on a key-up that a lock or sleep can prevent from ever arriving:
 *
 *  - `ShortcutEdgeGuard` latches on a global-shortcut callback and unlatches on key-up, so a lock with
 *    the wake key held would leave the shortcut permanently dead;
 *  - `DoubleAltDetector` tracks Alt-down from key events for the same reason, so the gesture would
 *    stop firing until that Alt happened to be pressed and released again.
 *
 * The reference project has no global shortcut, no double-Alt gesture and no lock/sleep listeners, so
 * there is nothing to port here; `doc/reference-playbook.md` §5.5 records this as pi-orb's own
 * capability, which is why it carries its own acceptance requirement rather than inherited behaviour.
 *
 * Bound to both the lock and the resume edge rather than only one: a lock without a suspend, and a
 * suspend without a lock, are both ordinary, and recovering on either is harmless when the state was
 * already clean.
 */
function attachKeyboardEdgeRecovery(): void {
  const recover = (reason: string): void => {
    shortcutEdgeGuard.releaseLatchedHold();
    doubleAltDetector.recoverFromLostKeyUp();
    console.log(`[pi-orb] keyboard edge state cleared (${reason})`);
  };
  powerMonitor.on("lock-screen", () => recover("lock-screen"));
  powerMonitor.on("suspend", () => recover("suspend"));
  powerMonitor.on("resume", () => recover("resume"));
  powerMonitor.on("unlock-screen", () => recover("unlock-screen"));
}

/**
 * Torn down every outstanding desktop capability, in one place.
 *
 * There is exactly one revocation path so a new caller cannot invent a partial one. It revokes the
 * session desktop Access and drops any unconfirmed screenshot, and it is idempotent.
 */
function revokeDesktopOperations(reason: string): void {
  accessRevision++;
  defaultAccessPending = false;
  const hadAuthority = desktopBroker?.status().authorized === true;
  const hadCapture = screenshotFlow?.pending !== null && screenshotFlow?.pending !== undefined;
  desktopBroker?.revoke();
  screenshotFlow?.discard();
  // The next screenshot request selects a fresh target; no snapshot survives revocation.
  recordedTarget.clear();
  // The ribbon marks the last desktop observation, so it goes away with the grant. Turn idle does
  // not call this path; hide, Stop, disconnect, session/workspace changes and quit do.
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
function showObservationFrameForTarget(bounds = referenceDriver?.targetBounds()): void {
  if (!observationFramePreference.enabled) { hideObservationFrame(observationFrame ?? undefined); return; }
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
      // orb.
      { label: "显示悬浮球", click: () => void showOrb() },
      { label: "切换工作区…", click: () => { void showOrb().then(() => window?.webContents.send(IPC.shellMenuAction, "workspace")); } },
      // Goes through the same collapse routine as the shortcut and the window button, so the tray
      // cannot hide the orb while leaving desktop authority alive.
      { label: "隐藏悬浮球", click: () => lifecycle?.collapse() },
      { type: "separator" },
      { label: "退出", click: () => quit() },
    ]),
  );
  tray.on("click", () => toggleWindow("tray"));
}

/** The same reference-derived Pi icon used by the installer and Windows shortcuts. */
function createTrayIcon(): NativeImage {
  return nativeImage.createFromBuffer(readFileSync(join(__dirname, "icon.png"))).resize({ width: 32, height: 32 });
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

  /**
   * Show the shell's context menu.
   *
   * The renderer reports the focused field's `editFlags`, because those are the only place Chromium
   * exposes "is there a selection to copy" and "does the clipboard hold anything pasteable" — the
   * main process cannot ask for them directly. They are coerced to booleans here so a malformed or
   * missing field disables an item rather than throwing inside the menu.
   */
  ipcMain.handle(IPC.shellMenu, (event, candidate: unknown) => {
    const current = window;
    if (!current || current.isDestroyed()) return false;
    // Only the shell may open a menu over the shell; any other sender has no business drawing chrome
    // in this window.
    if (event.sender !== current.webContents) return false;
    const request = (typeof candidate === "object" && candidate !== null ? candidate : {}) as Partial<ShellMenuRequest>;
    showShellMenu(
      current,
      {
        isEditable: request.isEditable === true,
        canCut: request.canCut === true,
        canCopy: request.canCopy === true,
        canPaste: request.canPaste === true,
        canSelectAll: request.canSelectAll === true,
        hasSelectionContext: selectionContext !== null,
      },
      {
        onModel: () => current.webContents.send(IPC.shellMenuAction, "model"),
        onScreenshot: () => current.webContents.send(IPC.shellMenuAction, "screenshot"),
        onShortcut: () => current.webContents.send(IPC.shellMenuAction, "shortcut"),
        onWorkspace: () => current.webContents.send(IPC.shellMenuAction, "workspace"),
        observationFrameEnabled: observationFramePreference.enabled,
        onObservationFrame: () => {
          observationFramePreference.setEnabled(!observationFramePreference.enabled);
          if (!observationFramePreference.enabled) hideObservationFrame(observationFrame ?? undefined);
        },
        onCollapse: () => lifecycle?.collapse(),
        onQuit: () => quit(),
        onClearSelectionContext: () => {
          clearSelectionContext();
          current.webContents.send(IPC.selectionContext, null);
        },
      },
    );
    return true;
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
      return { expanded: false, horizontal: "right", vertical: "down", docked: undefined, strip: 0 };
    }
    const state = setFloatingExpanded(window, expanded);
    return state;
  });
  ipcMain.on(IPC.dragPress, event => { if (window && !window.isDestroyed() && event.sender === window.webContents) pressFloatingBall(window); });
  ipcMain.on(IPC.dragBegin, event => { if (window && !window.isDestroyed() && event.sender === window.webContents) beginFloatingDrag(window); });
  ipcMain.on(IPC.dragMove, (event, canDock: unknown) => { if (window && !window.isDestroyed() && event.sender === window.webContents) moveFloatingDrag(window, canDock === true); });
  ipcMain.handle(IPC.dragEnd, (event, canDock: unknown) => {
    if (!window || window.isDestroyed() || event.sender !== window.webContents) throw new Error("Orb window unavailable.");
    return endFloatingDrag(window, canDock === true);
  });
  ipcMain.handle(IPC.agentBookmarks, async event => {
    if (!window || window.isDestroyed() || event.sender !== window.webContents || !codeAgents) return [];
    const items = await codeAgents.bookmarks();
    if (items.length > 0) refreshCallerTitles();
    if (session.sessionId && !session.running) void codeAgents.deliverPending(session.sessionId);
    if (!window || window.isDestroyed()) return [];
    const state = setFloatingAgentStrip(window, items.length > 0 ? 208 : 0);
    window.webContents.send(IPC.floatingState, state);
    return items.map(item => ({ ...item, callerTitle: callerTitles?.byId.get(item.callerId) ?? "" }));
  });
  ipcMain.handle(IPC.openAgent, async (event, id: unknown) => {
    if (!window || window.isDestroyed() || event.sender !== window.webContents || typeof id !== "string" || !codeAgents) throw new Error("Orb bookmark unavailable.");
    if (!(await codeAgents.bookmarks()).some(item => item.sessionId === id)) throw new Error("Unknown Code agent bookmark.");
    const url = new URL(client.baseUrl);
    url.searchParams.set("session", id);
    await shell.openExternal(url.toString());
    codeAgents.markRead(id);
  });
  // Both dock operations now resolve after their slide completes, so the renderer's returned state
  // describes the settled window rather than a position the animation is still passing through.
  ipcMain.handle(IPC.unsnapFloatingBall, async (): Promise<FloatingWindowState> => {
    if (!window || window.isDestroyed()) return { expanded: false, horizontal: "right", vertical: "down", docked: undefined, strip: 0 };
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
      title: "选择 Orb 工作区",
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
      if (isOrbWorkspace(validation.resolved, config.orbWorkspace)) return currentStatus();
      // A workspace change binds a fresh run: any in-flight work from the
      // previous workspace must not continue under the new one. An unconfirmed
      // screenshot and any desktop authorization belong to the previous run and must not
      // survive it either.
      revokeDesktopOperations("the workspace changed");
      // Abort the old provider/queue before dropping its stream; changing cwd cannot orphan a turn.
      try { if (session.running || session.pendingQuestionId) await session.abort(); }
      catch (error) { lastWorkspaceProblem = `旧会话未能停止：${describeError(error)}`; return currentStatus(); }
      const nextConfig = { ...config, orbWorkspace: validation.resolved };
      saveOrbConfig(configPath, nextConfig);
      config = nextConfig;
      defaultAccessPending = true;
      clearSelectionContext();
      if (!selectionMonitor) await startNativeSelectionMonitor();
      const generation = generations.begin();
      session.beginGeneration(generation);
      // The extension must learn the new generation, or its next request would be refused as stale.
      publishHandshake();
      try {
        const sessionId = await session.ensureSession(validation.resolved);
        grantDefaultAccess(sessionId, generation);
      } catch (error) {
        emit({ type: "error", message: describeError(error) });
      }
      return currentStatus();
    },
  );

  ipcMain.handle(IPC.ensureSession, async () => {
    const generation = generations.current;
    const validation = config.orbWorkspace ? validateWorkspace(config.orbWorkspace) : null;
    if (!validation?.ok || !validation.resolved) {
      throw new Error("Select a usable Orb workspace first.");
    }
    if (!isOrbWorkspace(validation.resolved, config.orbWorkspace)) {
      throw new Error("The configured workspace no longer matches its resolved path.");
    }
    try {
      const sessionId = await session.ensureSession(validation.resolved);
      grantDefaultAccess(sessionId, generation);
      return sessionId;
    } catch (error) {
      throw new Error(describeError(error));
    }
  });

  ipcMain.handle(IPC.listModels, async (): Promise<ListModelsResult> => {
    const validation = config.orbWorkspace ? validateWorkspace(config.orbWorkspace) : null;
    if (!validation?.ok || !validation.resolved) return { ok: false, message: "Select a usable Orb workspace first." };
    if (!isOrbWorkspace(validation.resolved, config.orbWorkspace)) return { ok: false, message: "The Orb workspace changed." };
    try {
      const sessionId = await session.ensureSession(validation.resolved);
      const [models, state] = await Promise.all([client.listModels(validation.resolved), client.getState(sessionId)]);
      return {
        ok: true,
        models,
        selected: state.provider && state.modelId ? { provider: state.provider, id: state.modelId } : null,
      };
    } catch (error) {
      return { ok: false, message: describeError(error) };
    }
  });

  ipcMain.handle(IPC.setModel, async (_event, request: unknown): Promise<SetModelResult> => {
    if (typeof request !== "object" || request === null) return { ok: false, message: "Malformed model selection." };
    const data = request as Record<string, unknown>;
    if (typeof data.generation !== "number" || typeof data.provider !== "string" || typeof data.id !== "string") {
      return { ok: false, message: "Malformed model selection." };
    }
    const check = generations.check(data.generation);
    if (!check.ok) return { ok: false, message: describeGenerationFailure(check.reason) };
    if (generations.busy || session.running) return { ok: false, message: "Stop the current reply before changing models." };
    const validation = config.orbWorkspace ? validateWorkspace(config.orbWorkspace) : null;
    if (!validation?.ok || !validation.resolved) return { ok: false, message: "Select a usable Orb workspace first." };
    try {
      const models = await client.listModels(validation.resolved);
      if (!models.some((item) => item.provider === data.provider && item.id === data.id)) {
        return { ok: false, message: "That model is not available in the Orb workspace." };
      }
      const sessionId = await session.ensureSession(validation.resolved);
      const selected = await client.setModel(sessionId, data.provider, data.id);
      if (!selected.provider || !selected.modelId) throw new Error("Pi Web did not confirm the selected model.");
      return { ok: true, selected: { provider: selected.provider, id: selected.modelId } };
    } catch (error) {
      return { ok: false, message: describeError(error) };
    }
  });

  ipcMain.handle(IPC.respondQuestion, async (_event, request: unknown) => {
    if (typeof request !== "object" || request === null) throw new Error("Malformed question response.");
    const data = request as Record<string, unknown>;
    if (typeof data.generation !== "number" || typeof data.id !== "string") throw new Error("Malformed question response.");
    const check = generations.check(data.generation);
    if (!check.ok) throw new Error(describeGenerationFailure(check.reason));
    if (session.pendingQuestionId !== data.id) throw new Error("The question is no longer active.");
    if (data.cancelled === true) await session.respondToQuestion({ id: data.id, cancelled: true });
    else if (typeof data.confirmed === "boolean") await session.respondToQuestion({ id: data.id, confirmed: data.confirmed });
    else if (typeof data.value === "string") await session.respondToQuestion({ id: data.id, value: data.value });
    else throw new Error("Malformed question response.");
  });

  ipcMain.handle(IPC.newConversation, async () => {
    const generation = generations.current;
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
      const sessionId = await session.newConversation(validation.resolved);
      defaultAccessPending = true;
      grantDefaultAccess(sessionId, generation);
      return sessionId;
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
    const generation = generations.current;
    if (typeof sessionId !== "string" || sessionId.length === 0) return { ok: false, message: "Malformed session id." };
    const validation = config.orbWorkspace ? validateWorkspace(config.orbWorkspace) : null;
    if (!validation?.ok || !validation.resolved) return { ok: false, message: "Select a usable Orb workspace first." };
    if (generations.busy || session.running) return { ok: false, message: "Finish or stop the current conversation before opening history." };
    try {
      const snapshot = await client.getSessionHistory(sessionId);
      if (!isOrbWorkspace(snapshot.cwd, validation.resolved)) return { ok: false, message: "That session is outside the Orb workspace." };
      revokeDesktopOperations("a history session was opened");
      await session.openExistingSession(validation.resolved, sessionId);
      defaultAccessPending = true;
      grantDefaultAccess(sessionId, generation);
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
    const wasBusy = generations.busy;
    if (wasBusy && !session.running) {
      throw new Error("Orb is busy with another task.");
    }
    if (!wasBusy && !generations.tryAcquire(parsed.generation)) {
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
   * Select the topmost non-Orb window at request time and capture it for preview.
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
      // Select the current topmost non-Orb application at the user's screenshot request.
      // This uses the reference Win32 window walk, so opening Orb by mouse or tray works too.
      await recordedTarget.record();
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
  /* Target windows are resolved from the current foreground observation. */

  ipcMain.handle(IPC.setOrbAccess, (_event, request: unknown) => {
    const parsed = parseAccessRequest(request);
    if (!parsed) {
      lastDesktopProblem = "Choose Read Only, Workspace Write or Full Access.";
      return desktopTaskStatus();
    }
    if (!desktopBroker) {
      lastDesktopProblem = "The desktop driver is unavailable.";
      return desktopTaskStatus();
    }
    if (generations.current !== parsed.generation) {
      lastDesktopProblem = "This request belongs to an earlier run and was refused.";
      return desktopTaskStatus();
    }
    if (!config.orbWorkspace || !validateWorkspace(config.orbWorkspace).ok) {
      lastDesktopProblem = "Choose a usable Orb workspace before enabling desktop access.";
      return desktopTaskStatus();
    }
    lastDesktopProblem = null;
    const requestedRevision = accessRevision;
    return session.ensureSession(config.orbWorkspace).then((sessionId) => {
      if (accessRevision !== requestedRevision || generations.current !== parsed.generation || session.sessionId !== sessionId || !window?.isVisible()) return desktopTaskStatus();
      desktopBroker?.authorize({ sessionId, generation: parsed.generation, level: parsed.level });
      defaultAccessPending = false;
      return desktopTaskStatus();
    });
  });

  ipcMain.handle(IPC.revokeOrbAccess, () => {
    // The user's explicit emergency stop: one call drops the task authority and any
    // unconfirmed screenshot, so nothing is left able to touch the desktop.
    revokeDesktopOperations("the user stopped desktop operations");
    lastDesktopProblem = null;
    return desktopTaskStatus();
  });

  ipcMain.handle(IPC.getOrbAccess, () => desktopTaskStatus());

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

/** Parse the selected Access tier. */
function parseAccessRequest(value: unknown): { generation: number; level: OrbAccessLevel } | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const generation = record.generation;
  if (typeof generation !== "number" || !Number.isInteger(generation)) return null;
  const level = record.level;
  if (level !== "read-only" && level !== "workspace-write" && level !== "full-access") return null;
  return { generation, level };
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
  if (window && !window.isDestroyed()) resetFloatingOverlayGuard(window);
  if (observationFrame && !observationFrame.isDestroyed()) observationFrame.destroy();
  void bridge?.close();
  removeHandshake(app.getPath("userData"));
  session.dispose();
  generations.end();
  app.quit();
}

void app.whenReady().then(async () => {
  configPath = defaultConfigPath(app.getPath("userData"));
  observationFramePreference = new ObservationFramePreference(join(app.getPath("userData"), "observation-frame.json"));
  const loaded = loadOrbConfig(configPath);
  config = loaded.config;
  if (loaded.error) {
    lastWorkspaceProblem = loaded.error;
    console.warn(`[pi-orb] ${loaded.error}`);
  }

  // Explicit-config dev/evidence sessions remain isolated from personal installation.
  if (app.isPackaged && !process.env.PI_ORB_CONFIG) {
    try {
      await preparePersonalStartup({
        userData: app.getPath("userData"), pluginSource: join(process.resourcesPath, "pi-plugin"),
        baseUrl: piWebBaseUrl, password: piWebPassword, probe: () => probePersonalPiWeb(piWebBaseUrl),
        pickFile: async (title, extension) => {
          const result = await dialog.showOpenDialog({ title, properties: ["openFile"], filters: [{ name: extension, extensions: [extension] }] });
          return result.canceled ? undefined : result.filePaths[0];
        },
        notify: message => { void dialog.showMessageBox({ type: "info", title: "pi-orb 安装提示", message }); },
      });
    } catch (error) { dialog.showErrorBox("pi-orb 启动准备未完成", describeError(error)); }
  }

  session = new OrbSessionController({
    log: entry => console.log(`[pi-orb] session timing ${JSON.stringify(entry)}`),
    client,
    emit: (event) => emit(event),
  });
  codeAgents = new CodeAgentManager({
    client, registryPath: codeAgentRegistryPath(),
    deliver: async (owner, text) => {
      // A completion notice is a session event, not a desktop action. It must still arrive after
      // the user hides Orb or revokes GUI Access while the background worker continues.
      if (session.sessionId !== owner || session.running || session.pendingQuestionId || isQuitting) return false;
      if (!generations.tryAcquire(session.generation)) return false;
      try { await session.prompt(text); emit({ type: "code-agent-notice", text }); return true; }
      catch (error) { generations.release(session.generation); throw error; }
    },
    log: error => console.warn(`[pi-orb] Code agent: ${describeError(error)}`),
  });
  screenshotFlow = new ScreenshotFlow({
    // captureScreenshot refreshes this snapshot on demand using the reference Win32 window walk.
    recordedTarget,
    capture: (target) => captureTargetWindow(target),
    send: (text, images) => session.prompt(text, images),
  });
  const generation = generations.begin();
  session.beginGeneration(generation);

  registerIpc();
  createTray();
  window = createWindow();
  if (wakeAfterStartup) { wakeAfterStartup = false; void showOrb(); }
  await startNativeSelectionMonitor();
  attachWakeController(window);
  if (!shortcutEdgeGuard.start()) {
    console.warn(`[pi-orb] ${shortcutEdgeGuard.error ?? "Keyboard edge detection is unavailable."}`);
  } else {
    doubleAltDetector.start();
  }
  attachKeyboardEdgeRecovery();
  registerShortcut();

  // The connection probe runs first: the window is already created, so its first snapshot must
  // carry a real answer rather than "unknown". Desktop startup is slower (it loads a native driver
  // and shells out for the recorded target) and is not needed for the first render.
  await refreshPiWebState();
  if (piWebState.reachable) await codeAgents.restore();

  // Started so the extension can reach the shell as soon as a session exists, and so a driver
  // problem is reported rather than crashing startup.
  await startDesktop();
  await startBridge();

  if (config.orbWorkspace && validateWorkspace(config.orbWorkspace).ok) {
    try {
      const generation = generations.current;
      grantDefaultAccess(await session.ensureSession(config.orbWorkspace), generation);
    } catch (error) {
      console.warn(`[pi-orb] default Access unavailable: ${describeError(error)}`);
    }
  }

});

/**
 * Show the orb without selecting a target. The screenshot button selects on demand.
 */
async function showOrb(): Promise<void> {
  if (!window || window.isDestroyed()) return;
  await presentOrb(window);
}

/**
 * Reposition the orb into the current display layout, then show and focus it.
 *
 * Shared by both wake paths — the `WakeController` callback and `showOrb` behind the tray menu and the
 * double-Alt gesture — because they had diverged on exactly this step: neither re-clamped, so an orb
 * parked on a monitor that was later unplugged came back at coordinates that exist on no display:
 * invisible and unreachable, with no way to summon it again since every wake route led here. A second
 * copy of the sequence is how the next divergence would start, which is why there is one.
 *
 * The clamp is awaited rather than fired and forgotten: it can animate a dock slide, and showing
 * first would park the orb at the old coordinates for the duration and then jump it.
 *
 * Failure is contained. A shell that cannot reposition itself must still show the window, because
 * refusing to appear is worse than appearing in the wrong place.
 */
async function presentOrb(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return;
  const reopening = !win.isVisible();
  try {
    await clampFloatingWindow(win);
  } catch (error) {
    console.warn(`[pi-orb] could not reposition the orb on wake: ${describeError(error)}`);
  }
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  // Explicitly reopening the hidden Orb selects the user's requested default. Focusing an
  // already visible Orb preserves a manually selected level and never undoes an emergency Stop.
  if (reopening && config.orbWorkspace && desktopBroker && piWebState.reachable) {
    defaultAccessPending = true;
    const generation = generations.current;
    try {
      grantDefaultAccess(await session.ensureSession(config.orbWorkspace), generation);
    } catch (error) {
      lastDesktopProblem = describeError(error);
    }
  }
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
  codeAgents?.dispose();
});
