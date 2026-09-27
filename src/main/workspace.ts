/**
 * Orb workspace selection and validation.
 *
 * The workspace is the dedicated directory whose *exact* match puts a Pi session
 * into Orb mode. This module owns the validation rules requested by P1-01:
 *
 *  - a workspace cannot be enabled without a selection,
 *  - cancel produces no write,
 *  - Windows case differences, symlinks and junctions resolve to one identity,
 *  - a missing directory or a directory without access is rejected with a reason,
 *  - a new directory is only created after an explicit confirmation flag.
 *
 * The workspace is a mode marker and an organization boundary. It is explicitly
 * NOT a filesystem sandbox and NOT an OS permission boundary.
 */

import {
  accessSync,
  constants,
  mkdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { normalizeDirPath } from "@shared/orb-config";

export type WorkspaceValidationCode =
  | "ok"
  | "empty"
  | "not-absolute"
  | "not-found"
  | "not-a-directory"
  | "no-read-access"
  | "no-write-access";

export interface WorkspaceValidation {
  readonly ok: boolean;
  readonly code: WorkspaceValidationCode;
  /** User-facing explanation. Empty only when `ok` is true. */
  readonly message: string;
  /**
   * Normalized comparison key (case-folded on Windows, separators unified).
   * `null` when the input could not be normalized.
   */
  readonly normalized: string | null;
  /**
   * Real path with symlinks and junctions resolved. This is the path Orb should
   * hand to pi-web and persist, so two spellings of one directory cannot create
   * two different modes.
   */
  readonly resolved: string | null;
}

function failure(
  code: WorkspaceValidationCode,
  message: string,
  normalized: string | null = null,
  resolved: string | null = null,
): WorkspaceValidation {
  return { ok: false, code, message, normalized, resolved };
}

/**
 * Validate a candidate workspace directory.
 *
 * Read-only: this function never creates or modifies anything.
 */
export function validateWorkspace(candidate: string | null | undefined): WorkspaceValidation {
  if (candidate === null || candidate === undefined || candidate.trim().length === 0) {
    return failure("empty", "Select a workspace directory to enable Orb.");
  }

  const normalized = normalizeDirPath(candidate);
  if (!normalized) {
    return failure(
      "not-absolute",
      "The workspace must be an absolute directory path.",
    );
  }

  let resolved: string;
  try {
    resolved = realpathSync.native(candidate);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return failure(
        "not-found",
        "The selected directory does not exist.",
        normalized,
      );
    }
    if (code === "EACCES" || code === "EPERM") {
      return failure(
        "no-read-access",
        "The selected directory cannot be accessed with the current account.",
        normalized,
      );
    }
    return failure(
      "not-found",
      `The selected directory could not be resolved: ${(error as Error).message}`,
      normalized,
    );
  }

  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(resolved);
  } catch (error) {
    return failure(
      "not-found",
      `The selected directory could not be inspected: ${(error as Error).message}`,
      normalized,
      resolved,
    );
  }
  if (!stats.isDirectory()) {
    return failure(
      "not-a-directory",
      "The selected path is not a directory.",
      normalized,
      resolved,
    );
  }

  if (!canAccess(resolved, constants.R_OK)) {
    return failure(
      "no-read-access",
      "The selected directory is not readable with the current account.",
      normalized,
      resolved,
    );
  }
  if (!canAccess(resolved, constants.W_OK)) {
    return failure(
      "no-write-access",
      "The selected directory is not writable with the current account.",
      normalized,
      resolved,
    );
  }

  return {
    ok: true,
    code: "ok",
    message: "",
    normalized: normalizeDirPath(resolved),
    resolved,
  };
}

function canAccess(path: string, mode: number): boolean {
  try {
    accessSync(path, mode);
    return true;
  } catch {
    return false;
  }
}

export interface CreateWorkspaceResult {
  readonly ok: boolean;
  readonly message: string;
  readonly validation: WorkspaceValidation | null;
}

/**
 * Create a workspace directory, but only when the caller has confirmed it.
 *
 * Without `confirmed` this returns a refusal and writes nothing, so a cancelled
 * "choose a new directory" dialog cannot leave a stray directory behind.
 */
export function createWorkspace(
  candidate: string,
  confirmed: boolean,
): CreateWorkspaceResult {
  if (!confirmed) {
    return {
      ok: false,
      message: "Creating a new workspace directory requires explicit confirmation.",
      validation: null,
    };
  }

  const normalized = normalizeDirPath(candidate);
  if (!normalized) {
    return {
      ok: false,
      message: "The workspace must be an absolute directory path.",
      validation: null,
    };
  }

  try {
    mkdirSync(candidate, { recursive: true });
  } catch (error) {
    return {
      ok: false,
      message: `Could not create the workspace: ${(error as Error).message}`,
      validation: null,
    };
  }

  return { ok: true, message: "", validation: validateWorkspace(candidate) };
}
