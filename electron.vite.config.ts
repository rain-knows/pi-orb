import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
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
    plugins: [react()],
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
    resolve: {
      alias: { "@shared": resolve(__dirname, "src/shared") },
    },
  },
});
