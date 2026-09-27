// Preload for the P1-05 input test target.
//
// Exposes exactly one method: report an observed event to the main process so it can
// be appended to the ground-truth log. No Node access is exposed to the page.
//
// CommonJS on purpose: a sandboxed preload must be loadable that way (the same defect
// was found and fixed in the product's own preload during P1-00).

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("p1Target", {
  report: (event, payload) => ipcRenderer.send("p1-target-report", { event, payload }),
});
