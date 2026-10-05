import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it("records a failed packaging run instead of leaving an earlier successful stage result", () => {
  const source = readFileSync(join(import.meta.dirname, "../evidence/p2-05/run-p2-05.mjs"), "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replace("import.meta.dirname", JSON.stringify(import.meta.dirname));
  const writes: { path: string; text: string }[] = [];
  const exit = vi.fn();
  const log = vi.fn();
  runInNewContext(source, {
    join, resolve,
    existsSync: () => true,
    readFileSync: () => JSON.stringify({ passed: true, checks: [] }),
    writeFileSync: (path: string, text: string) => writes.push({ path, text }),
    execFileSync: () => { throw Object.assign(new Error("build failed"), { stdout: "fixture build failure" }); },
    process: { env: {}, platform: "win32", exit },
    console: { log },
  });
  expect(writes).toHaveLength(1);
  const recorded = JSON.parse(writes[0]!.text);
  expect(recorded).toMatchObject({ passed: false, steps: [{ ok: false, output: "fixture build failure" }] });
  expect(JSON.parse(log.mock.calls[0]![0]).failed).toContain("build and package the unpacked Windows app");
  expect(exit).toHaveBeenCalledWith(1);
});
