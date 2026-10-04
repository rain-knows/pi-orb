// Evidence-only instrumentation; never loaded by the product or included in its package.
const { app, BrowserWindow, Menu } = require('electron');
const { readFileSync, writeFileSync, renameSync } = require('node:fs');
const { join } = require('node:path');
let wake;
let probeBrowser;
// Public MCP contextGetter injection is evidence-only. The disposable Chrome page verifies the
// production bridge -> native-window matching -> Electron ribbon; it never opens the user's profile.
if (process.env.PI_ORB_EVIDENCE_DOM_FRAME === '1') {
  const mcp = require('@playwright/mcp');
  const createConnection = mcp.createConnection;
  mcp.createConnection = async config => {
    const { chromium } = require('playwright');
    probeBrowser = await chromium.launch({ channel: 'chrome', headless: false });
    const context = await probeBrowser.newContext();
    const page = await context.newPage();
    await page.setContent('<title>Orb lifecycle browser fixture</title><h1>Disposable browser target</h1>');
    return createConnection({ ...config, extension: false }, async () => context);
  };
}
const build = Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate = template => { wake = template.find(item => item.label === '显示悬浮球')?.click ?? wake; return build(template); };
let lastNonce;
app.whenReady().then(() => {
  setInterval(() => {
    const root = app.getPath('userData');
    try {
      const control = JSON.parse(readFileSync(join(root, 'probe-control.json'), 'utf8'));
      if (control.nonce !== lastNonce) {
        lastNonce = control.nonce;
        if (control.wake) wake?.();
        if (control.closeBrowser) void probeBrowser?.close();
      }
    } catch { /* A control file is optional. */ }
    const temporary = join(root, 'probe-windows.tmp');
    writeFileSync(temporary, JSON.stringify(BrowserWindow.getAllWindows().map(w => ({
      id: w.id, visible: w.isVisible(), bounds: w.getBounds(), url: w.webContents.getURL(),
    }))));
    try { renameSync(temporary, join(root, 'probe-windows.json')); } catch { /* Keep the previous complete observation if Windows holds the file. */ }
  }, 50).unref();
});
require('../../out/main/index.js');
