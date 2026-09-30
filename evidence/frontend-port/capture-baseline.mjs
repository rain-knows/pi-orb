// Capture the pre-port packaged Orb and the pinned reference renderer at the same 344x444 viewport.
// Reference rendering uses its actual HTML, CSS and image; only host-provided state is supplied here.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = resolve(import.meta.dirname, "../..");
const output = import.meta.dirname;
const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
const app = join(repo, "release", version, "win-unpacked", "pi-orb.exe");
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const reference = "C:\\Users\\JUSTLIKEZYP\\AppData\\Local\\Temp\\deepseek-harness-orb-pi-orb\\apps\\desktop\\renderer\\floating.html";
const after = process.argv.includes("--after");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
mkdirSync(output, { recursive: true });
if (!after && existsSync(join(output, "before-panel.png"))) {
  throw new Error("The original before images are preserved. Use --after for the updated package.");
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
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
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const current = ++id;
        requests.set(current, [resolve, reject]);
        socket.send(JSON.stringify({ id: current, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

async function page(port) {
  for (let i = 0; i < 60; i += 1) {
    await sleep(250);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const target = targets.find((item) => item.type === "page");
      if (target) return connect(target.webSocketDebuggerUrl);
    } catch { /* starting */ }
  }
  throw new Error(`No page on CDP port ${port}`);
}

async function evaluate(cdp, expression) {
  const reply = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.text);
  return reply.result.value;
}

async function screenshot(cdp, name) {
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 344, height: 444, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const image = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  writeFileSync(join(output, name), Buffer.from(image.data, "base64"));
}

const isolated = join("D:\\", "pi-orb-p2-runs", `frontend-${after ? "after" : "before"}-${Date.now()}`);
const env = { ...process.env, PI_ORB_CONFIG: join(isolated, "orb-config.json"), PI_ORB_PI_WEB_URL: "http://127.0.0.1:31991" };
delete env.ELECTRON_RUN_AS_NODE;
const old = spawn(app, [`--user-data-dir=${join(isolated, "userData")}`, "--remote-debugging-port=31993"], { env, stdio: "ignore" });
try {
  const cdp = await page(31993);
  await evaluate(cdp, "window.orb.getStatus().then(() => true)");
  await screenshot(cdp, `${after ? "after" : "before"}-ball.png`);
  await evaluate(cdp, "document.body.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false })); true");
  await sleep(700);
  await screenshot(cdp, `${after ? "after" : "before"}-panel.png`);
  if (after) {
    await evaluate(cdp, "document.querySelector('#permission-button').click(); document.querySelector('#access-open').click(); true");
    await screenshot(cdp, "after-access.png");
  }
  cdp.close();
} finally {
  old.kill();
}

if (!after) {
  const browser = spawn(chrome, ["--headless=new", "--no-first-run", "--disable-gpu", "--remote-debugging-port=31994", `--user-data-dir=${join(isolated, "chrome")}`, pathToFileURL(reference).href], { stdio: "ignore" });
  try {
    const cdp = await page(31994);
    await evaluate(cdp, `(() => {
      document.documentElement.setAttribute('data-ds-dark-theme', '');
      document.body.className = 'expand-left expand-up expanded';
      document.querySelector('#panel').hidden = false;
      document.querySelector('#page-title').textContent = 'Orb';
      document.querySelector('#permission-label').textContent = 'Full access';
      document.querySelector('#input-label').textContent = 'Message';
      document.querySelector('#prompt').dataset.placeholder = 'Ask anything';
      return true;
    })()`);
    await screenshot(cdp, "reference-panel.png");
    cdp.close();
  } finally {
    browser.kill();
  }
}
console.log(`Baseline screenshots saved in ${output}`);
