/** Observation ribbon preference adapted from mini-yifan/dsh-orb-cordis@aa79308e47265b7d4a774edb688de2bbd7dce66e,
 * packages/host/src/preferences.ts (MIT). Pi uses its own userData directory and atomic store. */
import { readFileSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";

export class ObservationFramePreference {
  #enabled = true;
  constructor(readonly path: string) {
    let raw: string;
    try { raw = readFileSync(path, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    const value = JSON.parse(raw) as { enabled?: unknown };
    if (typeof value.enabled !== "boolean") throw new Error("Invalid observation frame preference.");
    this.#enabled = value.enabled;
  }
  get enabled(): boolean { return this.#enabled; }
  setEnabled(enabled: boolean): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, JSON.stringify({ enabled }), "utf8");
    renameSync(`${this.path}.tmp`, this.path);
    this.#enabled = enabled;
  }
}
