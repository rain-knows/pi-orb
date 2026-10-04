/** Rasterize resources/icon.svg and use electron-builder's existing ICO converter.
 * Icon plate: deepseek-harness-orb 72f1d738, resources/icon-windows.svg (MIT).
 * Pass a Sharp package location (or install Sharp externally); no runtime dependency is added.
 */
import { createRequire } from "node:module";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { convertIcon } from "app-builder-lib/out/util/iconConverter.js";
const require = createRequire(import.meta.url);
const sharp = require(process.argv[2] ?? "sharp");
const resources = resolve(import.meta.dirname, "../resources");
await sharp(readFileSync(resolve(resources, "icon.svg"))).resize(1024, 1024).png().toFile(resolve(resources, "icon.png"));
// A stale ICO must not short-circuit conversion of the current SVG.
if (existsSync(resolve(resources, "icon.ico"))) unlinkSync(resolve(resources, "icon.ico"));
const result = await convertIcon({ sources: [resolve(resources, "icon.png")], fallbackSources: [], roots: [resources], format: "ico", outDir: resources });
if (result.icons.length !== 1 || result.isFallback) throw new Error("Icon conversion failed");
console.log(result.icons[0].file);
