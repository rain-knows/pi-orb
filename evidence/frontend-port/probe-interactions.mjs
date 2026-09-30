// Drives a real packaged Electron renderer/preload/main against a deterministic Pi Web wire fixture.
// This checks the integration boundary and captures the model, question and tool transcript states;
// it does not claim to be a real model inference run.
import { spawn } from "node:child_process";
import { connect as connectPipe } from "node:net";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../..");
const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
const executable = join(repo, "release", version, "win-unpacked", "pi-orb.exe");
const runRoot = join("D:\\", "pi-orb-p2-runs", `frontend-interactions-${Date.now()}`);
const workspace = join(runRoot, "workspace");
mkdirSync(workspace, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const observed = { commands: [], answered: false, prompt: false };
let stream;
let selected = { provider: "fixture", id: "one" };
const emit = (event) => stream?.write(`data: ${JSON.stringify(event)}\n\n`);

const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/api/web-auth") { response.writeHead(404).end(); return; }
  if (path === "/api/models") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ modelList: [
      { provider: "fixture", id: "one", name: "Fixture One", input: ["text", "image"] },
      { provider: "fixture", id: "two", name: "Fixture Two", input: ["text"] },
    ] }));
    return;
  }
  if (path === "/api/sessions") {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ sessions: [
      { id: "fixture-session", cwd: workspace, name: "Reference flow", firstMessage: "Check this", modified: "2026-09-30T00:00:00Z", messageCount: 2 },
    ] }));
    return;
  }
  if (path === "/api/agent/new") {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ sessionId: "fixture-session" }));
    return;
  }
  if (path === "/api/agent/fixture-session/events") {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.flushHeaders();
    stream = response;
    response.on("close", () => { if (stream === response) stream = undefined; });
    return;
  }
  if (path === "/api/agent/fixture-session") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const command = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    observed.commands.push(command.type);
    if (command.type === "get_state") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ success: true, data: { model: selected } }));
      return;
    }
    if (command.type === "set_model") selected = { provider: command.provider, id: command.modelId };
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ success: true, data: {} }));
    if (command.type === "prompt") {
      observed.prompt = true;
      setTimeout(() => {
        emit({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "orb_batch", args: { actions: [{ kind: "click" }, { kind: "click" }, { kind: "click" }] } });
      }, 150);
      for (const step of [1, 2, 3]) setTimeout(() => {
        emit({ type: "tool_execution_update", toolCallId: "tool-1", toolName: "orb_batch", partialResult: { content: [{ type: "text", text: `执行第 ${step}/3 步` }] } });
      }, 250 + step * 200);
      setTimeout(() => {
        emit({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "orb_batch", isError: false });
        emit({ type: "extension_ui_request", id: "ask-1", method: "select", title: "Choose the next step", options: ["Continue (Recommended)", "Stop"] });
      }, 1500);
    }
    if (command.type === "extension_ui_response") {
      observed.answered = command.id === "ask-1" && command.value === "Continue (Recommended)";
      emit({ type: "extension_ui_closed", id: "ask-1" });
      emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Finished the check." } });
      emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Finished the check." }] } });
      emit({ type: "agent_end", stopReason: "stop" });
    }
    return;
  }
  response.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const env = { ...process.env, PI_ORB_CONFIG: join(runRoot, "orb-config.json"), PI_ORB_PI_WEB_URL: `http://127.0.0.1:${port}` };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [`--user-data-dir=${join(runRoot, "userData")}`, "--remote-debugging-port=31995"], { env, stdio: "ignore" });
let nativeTarget;

// Real broker/native input; the disposable target's log is the ground truth.
async function probeNativeTarget(cdp) {
  const logPath = join(runRoot, "target.jsonl");
  const geometryPath = join(runRoot, "geometry.json");
  nativeTarget = spawn(join(repo, "node_modules/electron/dist/electron.exe"), [join(repo, "evidence/p1-05/target-app")], {
    env: { ...env, P1_05_TARGET_LOG: logPath, P1_05_TARGET_GEOMETRY: geometryPath }, stdio: "ignore", windowsHide: true,
  });
  for (let i = 0; i < 60 && !existsSync(geometryPath); i++) await sleep(100);
  if (!existsSync(geometryPath)) throw new Error("Disposable native input target did not start");
  await sleep(300);
  await cdp.send("Page.bringToFront"); // Orb focus, without any wake shortcut or saved target.
  const state = await evaluate(cdp, "window.orb.getStatus()");
  const handshake = JSON.parse(readFileSync(join(runRoot, "userData/bridge-token.json"), "utf8"));
  const call = (request) => new Promise((resolve, reject) => {
    const socket = connectPipe(handshake.pipePath);
    const timer = setTimeout(() => socket.destroy(new Error("Native bridge timeout")), 5000);
    let data = "";
    socket.on("connect", () => socket.write(`${JSON.stringify({ version: 2, requestId: `probe-${Date.now()}`, ...request, token: handshake.token, sessionId: state.sessionId, generation: state.generation })}\n`));
    socket.on("data", (chunk) => { data += chunk.toString(); });
    socket.on("end", () => { clearTimeout(timer); try { resolve(JSON.parse(data.trim())); } catch (error) { reject(error); } });
    socket.on("error", (error) => { clearTimeout(timer); reject(error); });
  });
  const observed = await call({ type: "observe" });
  const observation = observed.result;
  if (!observed.ok || !observation?.ok || observation.window?.title !== "P1-05 input target") {
    throw new Error(`Native target was not selected: ${observed.reason ?? observation?.message ?? observation?.window?.title}`);
  }
  const geometry = JSON.parse(readFileSync(geometryPath, "utf8"));
  const point = geometry.cellCentres[0].physicalScreenPoint;
  const bounds = observation.window.bounds;
  const action = { kind: "click", observationId: observation.observationId,
    position: { x: 1000 * (point.x - bounds.x) / bounds.width, y: 1000 * (point.y - bounds.y) / bounds.height } };
  const outcome = await call({ type: "act", action });
  await sleep(200);
  const received = readFileSync(logPath, "utf8").trim().split(/\r?\n/u).map((line) => JSON.parse(line)).filter((event) => event.kind === "cell-mousedown");
  const report = { capturedAt: new Date().toISOString(), method: "direct authenticated bridge, real native input, no model inference",
    selectedDisposableTarget: true, targetReadback: received.map((event) => event.cell),
    freshObservation: Boolean(outcome.result?.observation?.observationId) && outcome.result.observation.observationId !== observation.observationId,
    passed: outcome.ok && outcome.result?.ok && received.length === 1 && received[0].cell === "0,0" };
  writeFileSync(join(import.meta.dirname, "native-target-probe.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed || !report.freshObservation) throw new Error(`Native readback failed: ${JSON.stringify(report)}`);
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const requests = new Map();
  socket.addEventListener("message", (event) => {
    const reply = JSON.parse(event.data.toString());
    if (!requests.has(reply.id)) return;
    const [resolve, reject] = requests.get(reply.id);
    requests.delete(reply.id);
    if (reply.error) reject(new Error(reply.error.message));
    else resolve(reply.result);
  });
  return {
    send(method, params = {}) { return new Promise((resolve, reject) => {
      const id = ++nextId;
      requests.set(id, [resolve, reject]);
      socket.send(JSON.stringify({ id, method, params }));
    }); },
    close() { socket.close(); },
  };
}
async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(cdp, expression, predicate, label) {
  let last;
  for (let i = 0; i < 80; i += 1) {
    last = await evaluate(cdp, expression);
    if (predicate(last)) return last;
    await sleep(250);
  }
  const dom = await evaluate(cdp, "JSON.stringify({ status: document.querySelector('#status')?.textContent, transcript: document.querySelector('#transcript')?.textContent?.slice(0, 300), body: document.body.className })");
  throw new Error(`${label}: ${JSON.stringify(last)}; wire=${JSON.stringify(observed)}; dom=${dom}`);
}
async function capture(cdp, name) {
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 344, height: 444, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const image = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(import.meta.dirname, name), Buffer.from(image.data, "base64"));
}

try {
  let target;
  for (let i = 0; i < 60; i += 1) {
    await sleep(250);
    try {
      const targets = await (await fetch("http://127.0.0.1:31995/json/list")).json();
      target = targets.find((item) => item.type === "page");
      if (target) break;
    } catch { /* starting */ }
  }
  if (!target) throw new Error("Packaged window did not start");
  const cdp = await connect(target.webSocketDebuggerUrl);
  try {
    await waitFor(cdp, "typeof window.orb", (value) => value === "object", "preload bridge");
    const status = await evaluate(cdp, `window.orb.setWorkspace(${JSON.stringify(workspace)}, false)`);
    if (!status.configured) throw new Error(`Workspace failed: ${status.problem}`);
    await cdp.send("Page.reload");
    await waitFor(cdp, "document.querySelector('#permission-label')?.textContent", (value) => value === "完全访问", "default Full Access");
    await waitFor(cdp, "document.querySelector('#composer')?.hidden", (value) => value === false, "composer ready");
    await evaluate(cdp, "document.body.dispatchEvent(new PointerEvent('pointerenter')); true");
    await waitFor(cdp, "document.body.classList.contains('expanded')", Boolean, "panel expanded");
    await capture(cdp, "after-ready.png");
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    await waitFor(cdp, "document.documentElement.hasAttribute('data-ds-dark-theme')", Boolean, "dark theme");
    await capture(cdp, "after-dark.png");
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
    await waitFor(cdp, "document.documentElement.hasAttribute('data-ds-dark-theme')", (value) => value === false, "light theme");
    await evaluate(cdp, "document.querySelector('#prompt').textContent='Check this\\nand that\\nand one more'; document.querySelector('#prompt').dispatchEvent(new Event('input', { bubbles: true })); true");
    await capture(cdp, "after-input.png");
    await evaluate(cdp, "document.querySelector('#prompt').focus(); document.body.dispatchEvent(new PointerEvent('pointerleave')); true");
    await sleep(280);
    if (!await evaluate(cdp, "document.body.classList.contains('expanded')")) throw new Error("Draft collapsed while editing");
    await evaluate(cdp, "document.querySelector('#prompt').blur(); true");
    await sleep(280);
    if (!await evaluate(cdp, "document.body.classList.contains('expanded')")) throw new Error("Unsent draft collapsed after blur");
    await evaluate(cdp, "document.querySelector('#prompt').textContent=''; document.querySelector('#prompt').dispatchEvent(new Event('input', { bubbles: true })); true");
    await evaluate(cdp, "document.querySelector('#permission-button').click(); true");
    await capture(cdp, "after-access.png");
    await evaluate(cdp, "document.querySelector('#permission-button').click(); document.querySelector('#prompt').textContent='Check this'; document.querySelector('#composer').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); true");
    await waitFor(cdp, "Boolean(document.querySelector('.orb-tool--running'))", Boolean, "running tool card");
    await waitFor(cdp, "document.querySelector('.orb-tool--running p')?.textContent", (value) => value === "执行第 2/3 步", "Chinese batch progress");
    const runningStyle = await evaluate(cdp, "({ caret: getComputedStyle(document.querySelector('#prompt')).caretColor, stop: getComputedStyle(document.querySelector('#stop')).width, placeholder: getComputedStyle(document.querySelector('#prompt'), '::after').content })");
    if (runningStyle.caret !== "rgba(0, 0, 0, 0)" || runningStyle.stop !== "36px" || runningStyle.placeholder !== '\"\"') throw new Error(`Running composer style: ${JSON.stringify(runningStyle)}`);
    await capture(cdp, "after-tool-running.png");
    await waitFor(cdp, "document.querySelector('#question')?.hidden", (value) => value === false, "question card");
    await capture(cdp, "after-question.png");
    await evaluate(cdp, "document.querySelector('#question-options button').click(); document.querySelector('#question-continue').click(); true");
    await waitFor(cdp, "document.querySelector('.orb-message--assistant p')?.textContent", (value) => value === "Finished the check.", "assistant reply");
    await capture(cdp, "after-tool-thread.png");
    await evaluate(cdp, "document.querySelector('#history').click(); true");
    await waitFor(cdp, "document.querySelectorAll('#history-list button').length", (value) => value === 1, "history list");
    await capture(cdp, "after-history.png");
    await evaluate(cdp, `(() => {
      document.querySelector('#history').click();
      document.querySelector('#preview-target').textContent='Editor';
      document.querySelector('#preview-meta').textContent='320 × 180 · not sent yet';
      const illustration = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#e8e8ec"/><rect x="13" y="12" width="294" height="156" rx="9" fill="#fff"/><rect x="13" y="12" width="294" height="22" rx="9" fill="#c7c9d0"/><rect x="28" y="52" width="90" height="8" rx="4" fill="#8995a5"/><rect x="28" y="72" width="248" height="5" rx="2" fill="#d5d9e0"/><rect x="28" y="86" width="220" height="5" rx="2" fill="#d5d9e0"/><rect x="28" y="114" width="108" height="29" rx="8" fill="#4f6685"/></svg>';
      document.querySelector('#preview-image').src='data:image/svg+xml,' + encodeURIComponent(illustration);
      document.querySelector('#preview-sheet').hidden=false;
      return true;
    })()`);
    await capture(cdp, "after-preview-fixture.png");
    await evaluate(cdp, "document.querySelector('#preview-sheet').hidden=true; document.body.dispatchEvent(new PointerEvent('pointerleave')); true");
    await waitFor(cdp, "document.body.classList.contains('expanded')", (value) => value === false, "panel collapsed");
    await sleep(400);
    const dock = await evaluate(cdp, "window.orb.moveFloatingBall(-60, 200).then(() => window.orb.clampFloatingBall())");
    if (dock.docked !== "left") throw new Error(`Dock state failed: ${JSON.stringify(dock)}`);
    await evaluate(cdp, "window.orb.unsnapFloatingBall().then(() => true)");
    await evaluate(cdp, `new Promise(resolve => {
      const ball = document.querySelector('#ball');
      const rect = ball.getBoundingClientRect();
      ball.setPointerCapture = () => {};
      const start = { pointerId: 1, button: 0, buttons: 1, screenX: window.screenX + rect.left + 36, screenY: 200, clientX: rect.left + 36, clientY: rect.top + 36 };
      ball.dispatchEvent(new PointerEvent('pointerdown', start));
      ball.dispatchEvent(new PointerEvent('pointermove', { ...start, screenX: -24 }));
      setTimeout(() => { ball.dispatchEvent(new PointerEvent('pointerup', { ...start, screenX: -24 })); setTimeout(resolve, 700); }, 300);
    })`);
    await waitFor(cdp, "document.body.classList.contains('docked-left')", Boolean, "renderer dock state");
    await capture(cdp, "after-dock.png");
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    const reducedMotion = await evaluate(cdp, "getComputedStyle(document.querySelector('#dock-tab')).animationName");
    if (reducedMotion !== "none") throw new Error(`Reduced-motion dock animation still active: ${reducedMotion}`);
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    if (!observed.prompt || !observed.answered) throw new Error(`Wire fixture not completed: ${JSON.stringify(observed)}`);
    await probeNativeTarget(cdp);
    writeFileSync(join(import.meta.dirname, "interaction-probe.json"), `${JSON.stringify({ passed: true, commands: observed.commands, reducedMotion, draftStaysExpanded: true, runningStyle, screenshots: ["after-ready.png", "after-dark.png", "after-input.png", "after-access.png", "after-question.png", "after-tool-running.png", "after-tool-thread.png", "after-history.png", "after-dock.png"], visualFixture: ["after-preview-fixture.png"] }, null, 2)}\n`);
    console.log("Packaged renderer/Pi wire interaction probe passed");
  } finally { cdp.close(); }
} finally {
  nativeTarget?.kill();
  child.kill();
  server.close();
}
