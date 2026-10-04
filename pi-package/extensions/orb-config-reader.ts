import { readFileSync } from "node:fs";
import { parseOrbConfig, type OrbConfig } from "../../src/shared/orb-config.js";

export function readOrbConfig(path: string): OrbConfig | null {
  try { return parseOrbConfig(JSON.parse(readFileSync(path, "utf8"))); }
  catch { return null; }
}
