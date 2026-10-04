import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { createServer } from "node:http";
import { assertPortAvailable, localOrbPackages, packageCli, probePersonalPiWeb, piWebServerLaunch } from "../src/main/personal-startup";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(name = "@agegr/pi-web", bin = "bin/pi-web.js") {
  const root = mkdtempSync(join(tmpdir(), "orb-startup-中文 "));
  roots.push(root);
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin/pi-web.js"), "");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name, bin: { "pi-web": bin } }));
  return root;
}

describe("personal installation boundaries", () => {
  it("resolves the production server directly within Pi Web and rejects an unbuilt installation", () => {
    const root = fixture();
    expect(() => piWebServerLaunch(join(root, "bin/pi-web.js"), new URL("http://localhost:30141"))).toThrow("生产构建");
    mkdirSync(join(root, ".next"));
    writeFileSync(join(root, ".next/BUILD_ID"), "fixture");
    const nextRoot = join(root, "node_modules/next");
    mkdirSync(join(nextRoot, "dist/bin"), { recursive: true });
    writeFileSync(join(nextRoot, "package.json"), JSON.stringify({ name: "next" }));
    writeFileSync(join(nextRoot, "dist/bin/next"), "");
    expect(piWebServerLaunch(join(root, "bin/pi-web.js"), new URL("http://localhost:30141"))).toEqual({ cwd: root, args: [join(nextRoot, "dist/bin/next"), "start", "-p", "30141", "-H", "localhost"] });
  });
  it("accepts the manifest's official entry with Chinese and space paths", () => {
    const root = fixture();
    expect(packageCli(root, "@agegr/pi-web", "pi-web")).toBe(join(root, "bin/pi-web.js"));
  });
  it("rejects another product, absent entry and an entry escaping its package", () => {
    expect(packageCli(fixture("foreign"), "@agegr/pi-web", "pi-web")).toBeUndefined();
    expect(packageCli(fixture("@agegr/pi-web", "bin/missing.js"), "@agegr/pi-web", "pi-web")).toBeUndefined();
    expect(packageCli(fixture("@agegr/pi-web", "../outside.js"), "@agegr/pi-web", "pi-web")).toBeUndefined();
  });
  it("selects only verified local Orb declarations, preserving unrelated and managed packages", () => {
    const own = fixture("pi-orb-pi-package");
    const foreign = fixture("other");
    expect(localOrbPackages({ packages: [own, { source: own }, foreign, "npm:other", null, {}] })).toEqual([own, own]);
    expect(localOrbPackages({ packages: [basename(own)] }, dirname(own))).toEqual([own]);
    expect(localOrbPackages(null)).toEqual([]);
  });
  it("refuses remote/HTTPS automatic startup", async () => {
    await expect(assertPortAvailable(new URL("http://192.168.1.2:30141"))).rejects.toThrow("本机");
    await expect(assertPortAvailable(new URL("https://localhost:30141"))).rejects.toThrow("本机");
  });
  it("distinguishes a foreign HTTP listener from Pi Web and refuses its occupied port", async () => {
    let html = "<title>Other app</title>";
    const server = createServer((_request, response) => response.end(html));
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    const port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}`;
    try {
      expect(await probePersonalPiWeb(url)).toBe(false);
      await expect(assertPortAvailable(new URL(url))).rejects.toThrow("占用");
      html = "<html><title>Pi Web</title></html>";
      expect(await probePersonalPiWeb(url)).toBe(true);
    } finally { await new Promise<void>(done => server.close(() => done())); }
    expect(await probePersonalPiWeb(url)).toBe(false);
    await expect(assertPortAvailable(new URL(url))).resolves.toBeUndefined();
  });
});
