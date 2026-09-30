import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";

/**
 * Copy the native helper scripts next to the built main process.
 *
 * The main process runs the PowerShell foreground-window helper by path relative to its own
 * directory (`join(__dirname, "native", "foreground-window.ps1")`). Vite only bundles what is
 * imported, so without this the file never reaches `out/main/native/` and every attempt to record the
 * target window fails at runtime — silently and only in a built app, because the failure is reported
 * as "no foreground window", not as a missing file. That looked like "the user's desktop has no
 * foreground window" when the real cause was a missing build artifact.
 */
function copyNativeScripts(): Plugin {
  return {
    name: "pi-orb:copy-native-scripts",
    apply: "build",
    generateBundle() {
      for (const name of ["foreground-window.ps1"]) {
        this.emitFile({
          type: "asset",
          // A fixed name is required: the runtime resolves this exact path, so a hashed name would
          // break the lookup the same way the missing file did.
          fileName: `native/${name}`,
          source: readFileSync(resolve(__dirname, "src/main/native", name)),
        });
      }
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyNativeScripts()],
    build: {
      outDir: "out/main",
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
    resolve: {
      alias: { "@shared": resolve(__dirname, "src/shared") },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
        // A sandboxed preload script must be CommonJS: Electron loads it before
        // any module loader is available in the sandbox. The default `.mjs`
        // output that follows from `"type": "module"` would fail to load, and
        // the failure is silent in the renderer (no bridge, no error). Emit CJS
        // under the `.js` name that the main process loads.
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
          chunkFileNames: "[name].js",
        },
      },
    },
    resolve: {
      alias: { "@shared": resolve(__dirname, "src/shared") },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        // Two entries: the orb shell, and the observation-frame ribbon. The ribbon is a separate page
        // because it is a second window with its own CSP and no script of its own.
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
          "observation-frame": resolve(__dirname, "src/renderer/observation-frame.html"),
        },
      },
    },
    resolve: {
      alias: { "@shared": resolve(__dirname, "src/shared") },
    },
  },
});
