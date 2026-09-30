// P2-05 packaged-application smoke test.
//
// The package audit proves what is inside the artifact; this proves the artifact runs. A packaged
// Electron app resolves every path differently from `electron-vite dev` (the preload loads from
// inside an asar archive, the renderer is a built file rather than a dev server, the main process
// imports its native modules from `app.asar.unpacked`), so "it works in dev" is not evidence.
//
// It launches the packaged executable with its own user-data directory and an isolated config, then
// drives the renderer over the Chrome DevTools Protocol:
//
//   - the process stays alive (a missing preload or a crashed main process would not);
//   - the sandboxed bridge is exposed and the renderer still has no Node access;
//   - the status round trip over IPC works and reports the isolated, unconfigured state;
//   - `orb:list-desktop-windows` returns a real window list, which is the only way to observe from
//     outside that `koffi` loaded out of `app.asar.unpacked` and enumerated the desktop;
//   - stdout carries no `desktop driver unavailable` line, which is how `startDesktop()` reports a
//     native-module failure.
//
// No screenshot is taken, no pixel is written to disk and no input is posted.
//
// Run: node evidence/p2-05/run-packaged-smoke.mjs

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const evidenceDir = import.meta.dirname;
const repo = resolve(evidenceDir, "..", "..");
const packageJson = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
const executable = join(repo, "release", packageJson.version, "win-unpacked", "pi-orb.exe");

const runRoot = join("D:\\", "pi-orb-p2-runs", `packaged-smoke-${Date.now()}`);
const configPath = join(runRoot, "orb-config.json");
const userDataDir = join(runRoot, "userData");

// Dedicated ports unlikely to collide with a real pi-web instance or a second probe.
const UNUSED_PI_WEB_PORT = 31991;
const DEBUG_PORT = 31992;

const result = {
  capturedAt: new Date().toISOString(),
  executable: executable.replace(`${repo}\\`, ""),
  runRoot,
  checks: [],
  passed: false,
};

function check(name, ok, detail) {
  result.checks.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
}

if (!existsSync(executable)) {
  check("the packaged executable exists", false, `${executable} — run \`npm run package:win:dir\` first`);
  writeFileSync(join(evidenceDir, "packaged-smoke.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ passed: false, checks: result.checks }, null, 2));
  process.exit(1);
}

mkdirSync(runRoot, { recursive: true });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Minimal CDP client, enough for `Runtime.evaluate` against the single page target. */
async function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", () => fail(new Error("CDP socket error")), { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data.toString());
    if (typeof message.id === "number" && pending.has(message.id)) {
      const { resolve: done, reject: fail } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) fail(new Error(message.error.message));
      else done(message.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((done, fail) => {
      const id = (nextId += 1);
      pending.set(id, { resolve: done, reject: fail });
      socket.send(JSON.stringify({ id, method, params }));
    });
  return { send, close: () => socket.close() };
}

async function evaluate(client, expression) {
  const outcome = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (outcome.exceptionDetails) throw new Error(outcome.exceptionDetails.exception?.description ?? "evaluation failed");
  return outcome.result.value;
}

/**
 * Poll a rendered fact until it holds.
 *
 * The window target exists before React has mounted, and the first CDP `Runtime.evaluate` can run
 * during that gap — which reported `rootChildren: 0` once and made a working renderer look broken.
 * Waiting for the condition keeps the assertion strict (the DOM must actually reach that state)
 * while removing the timing assumption.
 */
async function waitForValue(client, expression, predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await evaluate(client, expression);
    if (predicate(last)) return last;
    if (Date.now() > deadline) return last;
    await sleep(250);
  }
}

// `ELECTRON_RUN_AS_NODE=1` turns an Electron binary into plain Node, which then rejects Electron's
// own switches (`bad option: --user-data-dir=…`, exit 9) and never creates a window. Some agent
// environments export it globally, so it is removed from the child environment explicitly instead of
// letting the probe report a shell misconfiguration as a product defect.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(
  executable,
  [`--user-data-dir=${userDataDir}`, `--remote-debugging-port=${DEBUG_PORT}`],
  {
    cwd: runRoot,
    env: {
      ...childEnv,
      PI_ORB_CONFIG: configPath,
      PI_ORB_PI_WEB_URL: `http://127.0.0.1:${UNUSED_PI_WEB_PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

try {
  let pageTarget = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(500);
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await response.json();
      pageTarget = targets.find((target) => target.type === "page") ?? null;
      if (pageTarget) break;
    } catch {
      // The debugging endpoint is not up yet.
    }
  }

  check("the packaged application stays alive", child.exitCode === null, `exitCode=${child.exitCode}`);
  check("the packaged application creates its window", pageTarget !== null, pageTarget?.title ?? "no page target");

  if (pageTarget) {
    const client = await connect(pageTarget.webSocketDebuggerUrl);

    const bridgeType = await evaluate(client, "typeof window.orb");
    check("the packaged preload bridge reaches the renderer", bridgeType === "object", `typeof window.orb = ${bridgeType}`);

    const sandbox = JSON.parse(
      await evaluate(client, "JSON.stringify({ require: typeof require, process: typeof process, module: typeof module })"),
    );
    check(
      "the packaged renderer still has no Node access",
      sandbox.require === "undefined" && sandbox.process === "undefined" && sandbox.module === "undefined",
      JSON.stringify(sandbox),
    );

    const status = await evaluate(client, "window.orb.getStatus().then((s) => JSON.stringify(s)).catch((e) => 'ERR:' + e.message)");
    const statusValue = status.startsWith("ERR:") ? null : JSON.parse(status);
    check("the packaged app answers IPC status", statusValue !== null, statusValue ? JSON.stringify(statusValue).slice(0, 160) : status);
    check(
      "the packaged app starts in the isolated unconfigured state",
      statusValue?.configured === false && statusValue?.piWeb?.reachable === false,
      `configured=${statusValue?.configured} reachable=${statusValue?.piWeb?.reachable}`,
    );

    // The orb starts collapsed to the ball, so the setup panel's text is not in the layout; what
    // proves the built renderer really rendered is a mounted root, a loaded stylesheet, the product
    // avatar decoding out of the archive, and the ported reference shell actually being present:
    // the ball/panel/composer ids and the custom properties the ported stylesheet resolves. Reading
    // computed values is the difference between "the CSS file was loaded" and "the ported design
    // system is in effect", which is the property the reference-reuse rule is about.
    const renderExpression = `JSON.stringify((() => {
      const root = document.documentElement;
      const style = getComputedStyle(root);
      const ball = document.getElementById('ball');
      const ballStyle = ball ? getComputedStyle(ball) : null;
      return {
        rootChildren: document.getElementById('root')?.childElementCount ?? 0,
        ball: ball !== null,
        panel: document.getElementById('panel') !== null,
        composer: document.getElementById('composer') !== null,
        dockTab: document.getElementById('dock-tab') !== null,
        configured: !document.querySelector('.empty-state h1'),
        tokens: {
          ball: style.getPropertyValue('--ball').trim(),
          chrome: style.getPropertyValue('--chrome').trim(),
          panelRadius: style.getPropertyValue('--panel-radius').trim(),
          composerHeight: style.getPropertyValue('--composer-height').trim(),
        },
        ballSize: ballStyle ? ballStyle.width : null,
        ballRadius: ballStyle ? ballStyle.borderRadius : null,
        bodyClasses: document.body.className,
        avatarLoaded: [...document.images].some((image) => image.complete && image.naturalWidth > 0),
        avatarSrc: [...document.images].map((image) => image.currentSrc || image.src).join(','),
        styleSheets: document.styleSheets.length,
      };
    })())`;
    const render = JSON.parse(
      await waitForValue(
        client,
        renderExpression,
        (raw) => {
          try {
            const value = JSON.parse(raw);
            return value.rootChildren > 0 && value.ball === true;
          } catch {
            return false;
          }
        },
      ),
    );
    check(
      "the built renderer bundle and its assets load from the archive",
      render.rootChildren > 0 && render.ball && render.avatarLoaded && render.styleSheets > 0,
      JSON.stringify({ rootChildren: render.rootChildren, ball: render.ball, avatarLoaded: render.avatarLoaded, styleSheets: render.styleSheets }).slice(0, 240),
    );
    check(
      "the ported reference shell is mounted, not just its stylesheet",
      // `#panel`, `#ball` and `#dock-tab` exist regardless of state, as in the reference. `#composer`
      // is absent only while the workspace is unconfigured: pi-orb replaces the transcript with the
      // "choose a workspace" step, and offering an input before Orb mode can exist would be a false
      // affordance. The probe runs unconfigured, so it asserts the reference structure minus that
      // one state-dependent element.
      render.panel && render.dockTab && (!render.composer || render.configured === false),
      JSON.stringify({ panel: render.panel, dockTab: render.dockTab, composer: render.composer, configured: render.configured, bodyClasses: render.bodyClasses }).slice(0, 240),
    );
    check(
      "the reference design tokens resolve to the reference values",
      // `--composer-height: var(--ball)` must resolve, not be echoed verbatim.
      render.tokens.ball === "72px" &&
        render.tokens.chrome === "12px" &&
        render.tokens.panelRadius === "36px" &&
        render.tokens.composerHeight === "72px",
      JSON.stringify(render.tokens),
    );
    check(
      "the ball renders at the reference size and shape",
      render.ballSize === "72px" && render.ballRadius === "50%",
      JSON.stringify({ ballSize: render.ballSize, ballRadius: render.ballRadius }),
    );

    // The observation ribbon is a second window that must never gain the bridge the shell has, and
    // its inner hole has to land on the observed rectangle. Both are checked by navigating the
    // packaged Chromium at the built frame page and reading the computed styles, which is the only
    // way to see the mask/glow arithmetic actually take effect.
    const framePage = join(repo, "out", "renderer", "observation-frame.html");
    if (existsSync(framePage)) {
      await client.send("Page.enable", {});
      await client.send("Page.navigate", { url: `file:///${framePage.replaceAll("\\", "/")}` });
      await new Promise((done) => setTimeout(done, 1200));
      // The main process writes these after placing the window; the same values are written here so
      // the renderer half is measured against the placement arithmetic the unit tests pin.
      await evaluate(
        client,
        `(() => { const root = document.documentElement.style;
          for (const [name, value] of [['--glow-top',28],['--glow-right',28],['--glow-bottom',28],['--glow-left',28],['--stroke-top',8],['--stroke-right',8],['--stroke-bottom',8],['--stroke-left',8]]) root.setProperty(name, value + 'px'); })()`,
      );
      const ribbon = JSON.parse(
        await evaluate(
          client,
          `JSON.stringify((() => {
            const frame = document.getElementById('frame');
            if (!frame) return { present: false };
            const style = getComputedStyle(frame);
            const body = getComputedStyle(document.body);
            return {
              present: true,
              glow: [body.paddingTop, body.paddingRight, body.paddingBottom, body.paddingLeft].join(','),
              stroke: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].join(','),
              radius: style.borderRadius,
              gradient: style.backgroundImage.includes('gradient'),
              glowFilter: style.filter.includes('drop-shadow'),
              holePunched: (style.webkitMaskComposite || style.maskComposite || '').includes('exclude'),
              pointerEvents: style.pointerEvents,
              animations: style.animationName,
              scripts: document.scripts.length,
            };
          })())`,
        ),
      );
      check(
        "the observation ribbon renders with the reference geometry",
        ribbon.present === true &&
          ribbon.glow === "28px,28px,28px,28px" &&
          ribbon.stroke === "8px,8px,8px,8px" &&
          ribbon.radius === "16px" &&
          ribbon.gradient &&
          ribbon.glowFilter,
        JSON.stringify(ribbon).slice(0, 240),
      );
      check(
        "the observation ribbon cannot block input or animate",
        // "Does not block the action" is the acceptance criterion, and `pointer-events: none` is the
        // renderer half of it (the window's `setIgnoreMouseEvents` is the other). No animation matches
        // the reference's rule that the ribbon marks a region rather than an activity.
        ribbon.pointerEvents === "none" && ribbon.animations === "none" && ribbon.holePunched === true,
        JSON.stringify({ pointerEvents: ribbon.pointerEvents, animations: ribbon.animations, holePunched: ribbon.holePunched }),
      );
      check(
        "the observation ribbon window carries no scripts",
        // It is a separate page precisely so it never gets the shell's bridge; a script tag here would
        // be the first step towards giving the overlay capabilities.
        ribbon.scripts === 0,
        `script tags: ${String(ribbon.scripts)}`,
      );
      await client.send("Page.navigate", { url: pageTarget.url });
      await new Promise((done) => setTimeout(done, 1200));
    }

    // The ported dock gesture: drag the ball past the edge, then let go, and confirm the window
    // *slides* off rather than snapping. Docking only happens once the ball is past an edge, so the
    // probe reproduces that pre-condition first; without it the call is a no-op and a snap and a
    // slide are indistinguishable. The window position is read through the renderer's own
    // `screenX`/`outerWidth`, which track the OS window, so observing motion needs no product API.
    const slide = await evaluate(
      client,
      `(async () => {
        // Drag hard against the left edge, as a user dragging the ball there would.
        await window.orb.moveFloatingBall(-40, 500);
        await new Promise((done) => setTimeout(done, 200));
        const before = { x: window.screenX, width: window.outerWidth };
        const samples = [];
        const settled = window.orb.clampFloatingBall();
        for (let i = 0; i < 30; i += 1) {
          samples.push({ x: window.screenX, width: window.outerWidth });
          await new Promise((done) => setTimeout(done, 16));
        }
        const state = await settled;
        return JSON.stringify({ state, before, samples });
      })()`,
    );
    const slideValue = JSON.parse(slide);
    const frames = slideValue.samples.map((entry) => `${entry.x}:${entry.width}`);
    const distinct = new Set(frames).size;
    check(
      "the dock gesture slides the window off the edge instead of snapping it",
      // The reference's 250ms slide at ~16ms frames produces several intermediate positions; a bare
      // `setBounds` would produce one or two.
      slideValue.state?.docked !== undefined && distinct >= 4,
      JSON.stringify({ docked: slideValue.state?.docked, before: slideValue.before, distinctFrames: distinct, settled: frames[frames.length - 1] }),
    );

    // Unsnapping must slide back, and the tab must give way to the ball.
    const unsnap = await evaluate(
      client,
      "window.orb.unsnapFloatingBall().then((s) => JSON.stringify(s)).catch((e) => 'ERR:' + e.message)",
    );
    const unsnapValue = unsnap.startsWith("ERR:") ? null : JSON.parse(unsnap);
    check(
      "unsnapping the docked orb restores the ball and clears the dock state",
      unsnapValue !== null && unsnapValue.docked === undefined && unsnapValue.expanded === false,
      String(unsnap).slice(0, 200),
    );

    // The decisive native check: this call runs `koffi` out of `app.asar.unpacked` and enumerates
    // real top-level windows through Win32.
    const windows = await evaluate(
      client,
      "window.orb.listDesktopWindows().then((r) => JSON.stringify(r)).catch((e) => 'ERR:' + e.message)",
    );
    const windowsValue = windows.startsWith("ERR:") ? null : JSON.parse(windows);
    check(
      "the packaged desktop backend lists real windows (koffi loads from app.asar.unpacked)",
      windowsValue?.ok === true && Array.isArray(windowsValue.windows) && windowsValue.windows.length > 0,
      windowsValue?.ok
        ? `${windowsValue.windows.length} windows, first="${windowsValue.windows[0]?.title ?? ""}"`
        : String(windows).slice(0, 200),
    );

    client.close();
  }

  // `startDesktop()` reports a native-module failure only on its log stream, so it is searched in
  // both streams: a failure that reached stderr only would otherwise let a broken packaging look
  // like a healthy window.
  const driverFailureLine = `${stdout}\n${stderr}`
    .split(/\r?\n/u)
    .find((line) => /desktop driver/u.test(line));
  check(
    "no desktop-driver failure was reported at startup",
    driverFailureLine === undefined,
    (driverFailureLine ?? "none").slice(0, 200),
  );
  check(
    "no module-resolution error was reported",
    !/Cannot find module|ERR_MODULE_NOT_FOUND/u.test(stderr),
    (stderr.split(/\r?\n/u).find((line) => /Cannot find module|ERR_MODULE_NOT_FOUND/u.test(line)) ?? "none").slice(0, 200),
  );

  result.stdoutTail = stdout.trim().split(/\r?\n/u).slice(-10).join("\n");
  result.stderrTail = stderr.trim().split(/\r?\n/u).slice(-10).join("\n");
} catch (error) {
  check("the packaged smoke completed without error", false, error.message);
  result.stdoutTail = stdout.slice(-2000);
  result.stderrTail = stderr.slice(-2000);
} finally {
  child.kill();
  await sleep(1500);
  if (child.exitCode === null) child.kill("SIGKILL");
}

result.passed = result.checks.length > 0 && result.checks.every((entry) => entry.ok);
writeFileSync(join(evidenceDir, "packaged-smoke.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ passed: result.passed, checks: result.checks }, null, 2));

// The run directory is scratch space, not evidence: the isolated profile, config and any Electron
// cache under it are deleted, so the probe leaves the machine as it found it.
try {
  rmSync(runRoot, { recursive: true, force: true });
} catch {
  // The OS may still hold a handle on the Electron profile; harmless.
}

process.exit(result.passed ? 0 : 1);
