// Evidence-only instrumentation; never loaded by the product or included in its package.
const { app, BrowserWindow, Menu } = require('electron');
const { readFileSync, writeFileSync, renameSync } = require('node:fs');
const { join } = require('node:path');
let wake;

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
      }
    } catch { /* A control file is optional. */ }
    const temporary = join(root, 'probe-windows.tmp');
    writeFileSync(temporary, JSON.stringify(BrowserWindow.getAllWindows().map(w => ({
      id: w.id, visible: w.isVisible(), bounds: w.getBounds(), url: w.webContents.getURL(),
    }))));
    try { renameSync(temporary, join(root, 'probe-windows.json')); } catch { /* Keep the previous complete observation if Windows holds the file. */ }
  }, 50).unref();
});
require('../../../out/main/index.js');
