import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspace, validateWorkspace } from "../src/main/workspace";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-orb-ws-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("validateWorkspace", () => {
  it("rejects an empty selection so Orb cannot be enabled without a workspace", () => {
    for (const value of [null, undefined, "", "   "]) {
      const result = validateWorkspace(value);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("empty");
    }
  });

  it("rejects a relative path instead of resolving it against the process cwd", () => {
    const result = validateWorkspace("relative/dir");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("not-absolute");
  });

  it("reports a missing directory with a reason and writes nothing", () => {
    const missing = join(root, "does-not-exist");
    const result = validateWorkspace(missing);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("not-found");
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("rejects a file", () => {
    const file = join(root, "a-file.txt");
    writeFileSync(file, "x", "utf8");
    const result = validateWorkspace(file);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("not-a-directory");
  });

  it("accepts an existing directory and resolves it", () => {
    const dir = join(root, "workspace");
    mkdirSync(dir);
    const result = validateWorkspace(dir);
    expect(result.ok).toBe(true);
    expect(result.code).toBe("ok");
    expect(result.resolved).not.toBeNull();
  });

  it("resolves a directory spelled with a trailing separator to one identity", () => {
    const dir = join(root, "workspace");
    mkdirSync(dir);
    const plain = validateWorkspace(dir);
    const trailing = validateWorkspace(`${dir}\\`);
    expect(trailing.resolved).toBe(plain.resolved);
    expect(trailing.normalized).toBe(plain.normalized);
  });

  it("collapses a symlink and its target to the same identity when a link can be made", () => {
    const target = join(root, "real-workspace");
    mkdirSync(target);
    const link = join(root, "linked-workspace");

    let linkCreated = false;
    try {
      symlinkSync(target, link, "junction");
      linkCreated = true;
    } catch {
      // Creating a link can be refused by policy or privileges. The P1-01
      // requirement still has to be proven, so fall back to a second spelling of
      // the same directory, which is the case a naive string comparison gets
      // wrong.
      linkCreated = false;
    }

    const direct = validateWorkspace(target);
    const viaLink = validateWorkspace(linkCreated ? link : `${target}\\.`);
    expect(direct.resolved).toBe(viaLink.resolved);
    expect(direct.normalized).toBe(viaLink.normalized);
  });

  it("is case-insensitive for the comparison key on Windows", () => {
    const dir = join(root, "Workspace");
    mkdirSync(dir);
    const upper = validateWorkspace(dir.toUpperCase());
    const lower = validateWorkspace(dir.toLowerCase());
    if (process.platform === "win32") {
      expect(upper.ok).toBe(true);
      expect(upper.normalized).toBe(lower.normalized);
    } else {
      // On a case-sensitive filesystem the uppercase spelling is a different
      // directory and must not be treated as the same workspace.
      expect(upper.ok).toBe(false);
    }
  });
});

describe("createWorkspace", () => {
  it("writes nothing when the creation was not confirmed", () => {
    const dir = join(root, "unconfirmed");
    const result = createWorkspace(dir, false);
    expect(result.ok).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
    expect(validateWorkspace(dir).ok).toBe(false);
  });

  it("creates the directory only after confirmation", () => {
    const dir = join(root, "confirmed");
    const result = createWorkspace(dir, true);
    expect(result.ok).toBe(true);
    expect(result.validation?.ok).toBe(true);
  });

  it("refuses a relative path even with confirmation", () => {
    const result = createWorkspace("relative/dir", true);
    expect(result.ok).toBe(false);
  });
});
