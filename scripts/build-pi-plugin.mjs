/** Build an independent Pi package using the existing Vite pipeline and locked dependencies.
 * Pi provides typebox and its SDK; the extension ships without a separate browser gateway.
 */
import { build } from "vite";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire, builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const out = join(repo, "out/pi-plugin");
const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
const dependencies = {};
await build({
  configFile: false,
  build: {
    outDir: out, emptyOutDir: true, ssr: join(repo, "pi-package/extensions/orb.ts"),
    minify: false,
    rollupOptions: {
      external: id => id.startsWith("node:") || builtinModules.includes(id) || id === "typebox"
        || Object.keys(dependencies).some(name => id === name || id.startsWith(`${name}/`)),
      output: { format: "cjs", entryFileNames: "orb.cjs", inlineDynamicImports: true, exports: "named" },
    },
  },
});

/** Resolve package roots even when package.json is hidden by exports. */
function packageRoot(name, from) {
  const require = createRequire(join(from, "package.json"));
  let entry;
  try { entry = require.resolve(`${name}/package.json`); }
  catch { entry = require.resolve(name); }
  let dir = dirname(entry);
  while (dir !== dirname(dir)) {
    const path = join(dir, "package.json");
    if (existsSync(path) && JSON.parse(readFileSync(path, "utf8")).name === name) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Cannot locate locked dependency ${name}`);
}

const hoisted = new Map();
const copied = new Set();
/** Copy the installed dependency graph; preserve nested version conflicts, never run npm scripts. */
function copyDependency(name, from, parent) {
  const source = packageRoot(name, from);
  const previous = hoisted.get(name);
  const target = previous === undefined || previous === source
    ? join(out, "node_modules", name) : join(parent, "node_modules", name);
  if (previous === undefined) hoisted.set(name, source);
  if (copied.has(target)) return;
  copied.add(target);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, filter: path => !path.slice(source.length).split(/[\\/]/u).includes("node_modules") });
  const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
  for (const dep of Object.keys(pkg.dependencies ?? {})) copyDependency(dep, source, target);
}
for (const name of Object.keys(dependencies)) copyDependency(name, repo, out);
writeFileSync(join(out, "package.json"), JSON.stringify({
  name: "pi-orb-pi-package", version: manifest.version, private: true,
  license: "MIT", keywords: ["pi-package"], pi: { extensions: ["./orb.cjs"] },
  dependencies, peerDependencies: { "@earendil-works/pi-coding-agent": "*", typebox: "*" },
}, null, 2));
for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) cpSync(join(repo, file), join(out, file));
console.log(`Independent Pi plugin built with ${copied.size} locked dependency packages.`);
