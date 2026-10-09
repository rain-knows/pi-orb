import { mkdtemp, realpath, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveFinderOpen } from "../src/main/reference-windows/open";

describe("reference open path validation", () => {
  it("rejects forbidden inputs before checking whether they exist", async () => {
    for (const path of ["/etc", "/etc/pi-orb-does-not-exist", "/System/pi-orb-does-not-exist"]) {
      await expect(resolveFinderOpen(path, false)).rejects.toThrow("opening a system path is forbidden");
    }
  });

  it("still resolves an existing permitted directory and preserves reveal-only intent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-orb-open-"));
    try {
      expect(await resolveFinderOpen(directory, true)).toEqual({ path: await realpath(directory), revealOnly: true });
    } finally {
      await rmdir(directory);
    }
  });
});
