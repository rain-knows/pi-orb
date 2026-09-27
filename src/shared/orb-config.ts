/**
 * Orb configuration contract.
 *
 * This module is the single source of truth shared by:
 *  - the Electron main process, which owns the file (writes it), and
 *  - the Pi extension, which only reads it to decide whether it runs in Orb mode.
 *
 * Design rules (see doc/pi-orb-development-goals.md §4.2):
 *  - The workspace match is an *exact* normalized-directory match. Subdirectories
 *    never match, and a prefix-similar sibling directory never matches.
 *  - This module contains no filesystem access on purpose: it stays pure so both
 *    processes can share it and so the matching rules are unit-testable.
 *  - Orb never rewrites the user's Pi global configuration. This file lives in
 *    the Orb-owned userData directory.
 */

/** File name of the Orb-owned configuration inside the Orb userData directory. */
export const ORB_CONFIG_FILENAME = "orb-config.json";

/**
 * Environment variable overriding the configuration location.
 *
 * Both sides must honour it: the Electron shell writes the file, the Pi extension
 * reads it. If only one side honoured it they would use different files and Orb
 * mode would never activate, so the resolution lives in exactly one place below.
 */
export const ORB_CONFIG_ENV = "PI_ORB_CONFIG";

/** Schema version of the configuration file. Bumped only on a breaking change. */
export const ORB_CONFIG_VERSION = 1;

/** Default global wake shortcut. Registered at runtime; conflicts are reported. */
export const DEFAULT_ORB_SHORTCUT = "CommandOrControl+Shift+Space";

export interface OrbConfig {
  readonly version: number;
  /**
   * The dedicated Orb working directory. `null` means "not configured", which
   * disables Orb mode entirely: with no workspace there is no Orb mode.
   */
  readonly orbWorkspace: string | null;
  /** Global wake/collapse shortcut (Electron accelerator syntax). */
  readonly shortcut: string;
  readonly window: OrbWindowConfig;
}

export interface OrbWindowConfig {
  readonly alwaysOnTop: boolean;
  /** Last known window position in screen coordinates, or `null` for default. */
  readonly x: number | null;
  readonly y: number | null;
  readonly width: number;
  readonly height: number;
}

export function createDefaultOrbConfig(): OrbConfig {
  return {
    version: ORB_CONFIG_VERSION,
    orbWorkspace: null,
    shortcut: DEFAULT_ORB_SHORTCUT,
    window: {
      alwaysOnTop: true,
      x: null,
      y: null,
      width: 420,
      height: 640,
    },
  };
}

/**
 * Normalize a directory path so that two spellings of the same directory compare
 * equal.
 *
 * Handled here:
 *  - separator normalization (`/` and `\`) and duplicate separators
 *  - `.` segments and trailing separators
 *  - Windows drive-letter case and path case (the Win32 filesystem is
 *    case-insensitive by default)
 *
 * Deliberately NOT handled here: symlinks, junctions and `8.3` short names.
 * Those require real filesystem access, so the caller resolves them with
 * `realpath` and passes the result in. Callers that must be robust to links do
 * this on both sides of the comparison.
 */
export function normalizeDirPath(
  input: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const normalizedSeparators =
    platform === "win32" ? trimmed.replace(/\//g, "\\") : trimmed;

  // Reject a relative path instead of silently resolving it against the current
  // directory: a relative Orb workspace would mean a different directory
  // depending on who launched the process.
  if (!isAbsoluteDirPath(normalizedSeparators, platform)) return null;

  let out = normalizedSeparators;
  // Collapse duplicate separators, but keep the leading "\\" of a UNC path.
  if (platform === "win32") {
    const isUnc = out.startsWith("\\\\");
    out = out.replace(/\\{2,}/g, "\\");
    if (isUnc && !out.startsWith("\\\\")) out = `\\${out}`;
  } else {
    out = out.replace(/\/{2,}/g, "/");
  }

  // Remove trailing separators unless the path is a bare root ("C:\" or "/").
  out = stripTrailingSeparators(out, platform);
  if (platform === "win32") out = out.toLowerCase();
  return out.length > 0 ? out : null;
}

function stripTrailingSeparators(value: string, platform: NodeJS.Platform): string {
  const sep = platform === "win32" ? "\\" : "/";
  let out = value;
  while (out.length > 1 && out.endsWith(sep)) {
    // Keep the separator that belongs to a drive root or filesystem root.
    if (platform === "win32" && /^[a-z]:\\$/i.test(out)) break;
    if (platform !== "win32" && out === "/") break;
    out = out.slice(0, -1);
  }
  return out;
}

function isAbsoluteDirPath(value: string, platform: NodeJS.Platform): boolean {
  if (platform === "win32") {
    return /^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\");
  }
  return value.startsWith("/");
}

/**
 * True only when `cwd` is exactly the configured Orb workspace.
 *
 * This is the *only* rule that puts a session into Orb mode. It is intentionally
 * strict:
 *  - a subdirectory of the workspace does NOT match,
 *  - a sibling directory sharing a name prefix does NOT match,
 *  - an unset (`null`) workspace matches nothing.
 */
export function isOrbWorkspace(
  cwd: string | undefined | null,
  orbWorkspace: string | null | undefined,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!cwd || !orbWorkspace) return false;
  const normalizedCwd = normalizeDirPath(cwd, platform);
  const normalizedWorkspace = normalizeDirPath(orbWorkspace, platform);
  if (!normalizedCwd || !normalizedWorkspace) return false;
  return normalizedCwd === normalizedWorkspace;
}

/**
 * Parse an untrusted value (file contents, IPC payload) into a valid `OrbConfig`.
 *
 * Returns `null` instead of a partially-filled config when the input is not
 * recognizable. A corrupt configuration must never be silently interpreted as
 * "Orb mode is off but everything else is default" on a write path; callers
 * decide whether to fall back to defaults and report, or to fail closed.
 */
export function parseOrbConfig(value: unknown): OrbConfig | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.version !== "number" || !Number.isInteger(record.version)) {
    return null;
  }
  if (record.version !== ORB_CONFIG_VERSION) return null;

  const orbWorkspace = record.orbWorkspace;
  if (orbWorkspace !== null && typeof orbWorkspace !== "string") return null;
  if (typeof orbWorkspace === "string" && normalizeDirPath(orbWorkspace) === null) {
    return null;
  }

  const shortcut = record.shortcut;
  if (typeof shortcut !== "string" || shortcut.trim().length === 0) return null;

  const windowValue = record.window;
  if (typeof windowValue !== "object" || windowValue === null) return null;
  const windowRecord = windowValue as Record<string, unknown>;
  if (typeof windowRecord.alwaysOnTop !== "boolean") return null;
  const width = readFiniteNumber(windowRecord.width);
  const height = readFiniteNumber(windowRecord.height);
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  const x = readOptionalFiniteNumber(windowRecord.x);
  const y = readOptionalFiniteNumber(windowRecord.y);
  if (x === INVALID || y === INVALID) return null;

  return {
    version: ORB_CONFIG_VERSION,
    orbWorkspace,
    shortcut,
    window: {
      alwaysOnTop: windowRecord.alwaysOnTop,
      x,
      y,
      width,
      height,
    },
  };
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Signals "the field was present but its value is not acceptable".
 *
 * This is distinct from `null`, which means "the field is intentionally unset".
 * Silently turning a wrong-typed value into `null` would hide a corrupt or
 * hand-edited configuration instead of reporting it.
 */
const INVALID = Symbol("invalid-optional-number");

function readOptionalFiniteNumber(value: unknown): number | null | typeof INVALID {
  if (value === null || value === undefined) return null;
  const parsed = readFiniteNumber(value);
  return parsed === null ? INVALID : parsed;
}

export function serializeOrbConfig(config: OrbConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Resolve the Orb configuration path deterministically for both processes.
 *
 * Resolution order:
 *  1. the `PI_ORB_CONFIG` override, when set to a non-blank value;
 *  2. `<userDataDir>/orb-config.json`.
 *
 * `userDataDir` is supplied by the Electron main process (`app.getPath("userData")`).
 * The Pi extension cannot call Electron APIs, so it falls back to the same
 * directory Electron uses by default: `<APPDATA>/pi-orb` on Windows, and
 * `~/.config/pi-orb` elsewhere. Pass `platform` and `homeDir` in tests.
 *
 * Keeping this in the shared module is deliberate: two independent resolutions
 * would silently diverge on a platform or profile change.
 */
export function resolveOrbConfigPath(
  env: Record<string, string | undefined> = process.env,
  options: {
    readonly userDataDir?: string | undefined;
    readonly platform?: NodeJS.Platform;
    readonly homeDir?: string;
  } = {},
): string {
  const override = env[ORB_CONFIG_ENV];
  if (override && override.trim().length > 0) return override;

  const platform = options.platform ?? process.platform;
  const userDataDir = options.userDataDir ?? defaultUserDataDir(env, platform, options.homeDir);
  return joinPath(userDataDir, ORB_CONFIG_FILENAME, platform);
}

/**
 * Mirrors Electron's default `userData` location for an app named `pi-orb`:
 * `%APPDATA%\pi-orb` on Windows, `$XDG_CONFIG_HOME/pi-orb` or `~/.config/pi-orb`
 * elsewhere.
 */
function defaultUserDataDir(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  homeDir: string | undefined,
): string {
  if (platform === "win32") {
    const appData =
      nonBlank(env.APPDATA) ?? joinPath(nonBlank(env.USERPROFILE) ?? homeDir ?? "", "AppData\\Roaming", platform);
    return joinPath(appData, "pi-orb", platform);
  }
  const configHome = nonBlank(env.XDG_CONFIG_HOME) ?? joinPath(homeDir ?? "/root", ".config", platform);
  return joinPath(configHome, "pi-orb", platform);
}

function nonBlank(value: string | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * A tiny path join so this shared module keeps no Node import and stays safe to
 * load in the renderer bundle.
 */
function joinPath(base: string, relative: string, platform: NodeJS.Platform): string {
  const separator = platform === "win32" ? "\\" : "/";
  const normalizedBase = base.endsWith("/") || base.endsWith("\\") ? base.slice(0, -1) : base;
  const normalizedRelative = relative.replace(/^[/\\]+/, "");
  return `${normalizedBase}${separator}${normalizedRelative}`;
}
