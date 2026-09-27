/**
 * Orb configuration store, owned by the Electron main process.
 *
 * The Pi extension reads the same file but never writes it. All writes go
 * through this store so that a single process owns the file and the atomic
 * write path.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  createDefaultOrbConfig,
  parseOrbConfig,
  resolveOrbConfigPath,
  serializeOrbConfig,
  type OrbConfig,
} from "@shared/orb-config";

export interface ConfigLoadResult {
  readonly config: OrbConfig;
  /**
   * True when the on-disk file was absent. A missing file is the normal
   * first-run state and is not reported as a problem.
   */
  readonly created: boolean;
  /**
   * Set when a file existed but could not be used. The path is left untouched so
   * the user can inspect or recover it; Orb starts from defaults and reports.
   */
  readonly error: string | null;
}

/**
 * Load the Orb configuration.
 *
 * A malformed file is never silently overwritten. It is reported through
 * `error` and a new default config is offered in memory only.
 */
export function loadOrbConfig(path: string): ConfigLoadResult {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { config: createDefaultOrbConfig(), created: true, error: null };
    }
    return {
      config: createDefaultOrbConfig(),
      created: false,
      error: `Could not read ${path}: ${(error as Error).message}`,
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    return {
      config: createDefaultOrbConfig(),
      created: false,
      error: `Configuration at ${path} is not valid JSON: ${(error as Error).message}`,
    };
  }

  const parsed = parseOrbConfig(parsedJson);
  if (!parsed) {
    return {
      config: createDefaultOrbConfig(),
      created: false,
      error: `Configuration at ${path} does not match the expected schema.`,
    };
  }
  return { config: parsed, created: false, error: null };
}

/**
 * Persist the configuration using a temp file plus rename, so a crash mid-write
 * cannot leave a half-written config behind.
 */
export function saveOrbConfig(path: string, config: OrbConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, serializeOrbConfig(config), "utf8");
  renameSync(tempPath, path);
}

export function defaultConfigPath(userDataDir: string): string {
  return resolveOrbConfigPath(process.env, { userDataDir });
}
