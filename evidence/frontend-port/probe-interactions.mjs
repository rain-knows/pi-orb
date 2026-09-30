// Drives a real packaged Electron renderer/preload/main against a deterministic Pi Web wire fixture.
// This checks the integration boundary and captures the model, question and tool transcript states;
// it does not claim to be a real model inference run.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
        emit({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "orb_observe", args: { target: "Editor" } });
        emit({ type: "tool_execution_end", toolCallId: "tool-1", toolName: "orb_observe", isError: false });
        emit({ type: "extension_ui_request", id: "ask-1", method: "select", title: "Choose the next step", options: ["Continue (Recommended)", "Stop"] });
      }, 150);
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
    await waitFor(cdp, "document.querySelector('#permission-label')?.textContent", (value) => value === "Orb access", "renderer ready");
    await waitFor(cdp, "document.querySelector('#composer')?.hidden", (value) => value === false, "composer ready");
    await evaluate(cdp, "document.body.dispatchEvent(new PointerEvent('pointerenter')); true");
    await waitFor(cdp, "document.body.classList.contains('expanded')", Boolean, "panel expanded");
    await capture(cdp, "after-ready.png");
    await evaluate(cdp, "document.querySelector('#permission-button').click(); document.querySelector('#model-open').click(); true");
    await waitFor(cdp, "document.querySelectorAll('#model-list button').length", (value) => value === 2, "model list");
    await capture(cdp, "after-model.png");
    await evaluate(cdp, "document.querySelector('#model-close').click(); document.querySelector('#prompt').textContent='Check this'; document.querySelector('#composer').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); true");
    await waitFor(cdp, "document.querySelector('#question')?.hidden", (value) => value === false, "question card");
    await capture(cdp, "after-question.png");
    await evaluate(cdp, "document.querySelector('#question-options button').click(); document.querySelector('#question-continue').click(); true");
    await waitFor(cdp, "document.querySelector('.orb-message--assistant p')?.textContent", (value) => value === "Finished the check.", "assistant reply");
    await capture(cdp, "after-tool-thread.png");
    if (!observed.prompt || !observed.answered) throw new Error(`Wire fixture not completed: ${JSON.stringify(observed)}`);
    writeFileSync(join(import.meta.dirname, "interaction-probe.json"), `${JSON.stringify({ passed: true, commands: observed.commands, screenshots: ["after-ready.png", "after-model.png", "after-question.png", "after-tool-thread.png"] }, null, 2)}\n`);
    console.log("Packaged renderer/Pi wire interaction probe passed");
  } finally { cdp.close(); }
} finally {
  child.kill();
  server.close();
}
