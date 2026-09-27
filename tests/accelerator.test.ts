import { describe, expect, it } from "vitest";
import { validateAccelerator } from "@shared/accelerator";

describe("validateAccelerator", () => {
  it("accepts the documented default and ordinary combinations", () => {
    for (const accelerator of [
      "CommandOrControl+Shift+Space",
      "Control+Alt+O",
      "Ctrl+Shift+F1",
      "Alt+1",
      "Super+.",
    ]) {
      const result = validateAccelerator(accelerator);
      expect(result.ok, accelerator).toBe(true);
      expect(result.key, accelerator).not.toBeNull();
    }
  });

  it("accepts a bare key with no modifier", () => {
    expect(validateAccelerator("F9").ok).toBe(true);
    expect(validateAccelerator("Space").ok).toBe(true);
  });

  it("reports the recognized modifiers", () => {
    const result = validateAccelerator("Control+Alt+O");
    expect(result.modifiers).toEqual(["control", "alt"]);
    expect(result.key).toBe("O");
  });

  it("rejects empty input", () => {
    for (const value of [null, undefined, "", "   ", "++"]) {
      const result = validateAccelerator(value);
      expect(result.ok, String(value)).toBe(false);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("rejects a modifier-only accelerator instead of silently doing nothing", () => {
    // Electron's parser refuses these. A user asking for "double Alt" needs the
    // separate listener work in P2-02, not a silent no-op here.
    for (const value of ["Control", "Alt+Alt", "Shift+Control"]) {
      const result = validateAccelerator(value);
      expect(result.ok, value).toBe(false);
      expect(result.message, value).toContain("needs a key");
    }
  });

  it("rejects more than one key code", () => {
    const result = validateAccelerator("Control+A+B");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("one key");
  });

  it("rejects an unknown key name and names it", () => {
    const result = validateAccelerator("Control+NotAKey");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("NotAKey");
  });

  it("rejects an out-of-range function key", () => {
    expect(validateAccelerator("F25").ok).toBe(false);
    expect(validateAccelerator("F0").ok).toBe(false);
    expect(validateAccelerator("F24").ok).toBe(true);
  });

  it("tolerates surrounding and inner whitespace", () => {
    expect(validateAccelerator("  Control + Alt + O  ").ok).toBe(true);
    // The canonical form is the trimmed parts rejoined, so it is exactly what gets
    // registered.
    expect(validateAccelerator("  Control + Alt + O  ").normalized).toBe("Control+Alt+O");
  });

  it("rejects a doubled separator rather than validating a shortened form", () => {
    // Accepting it here while registering the original would let the OS refuse a
    // malformed value and report it as a conflict with another application.
    const result = validateAccelerator("Control++Alt+O");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("empty part");
    expect(result.normalized).toBeNull();
  });

  it("returns the canonical form that will actually be registered", () => {
    expect(validateAccelerator("  F9  ").normalized).toBe("F9");
    expect(validateAccelerator("CommandOrControl + Shift + Space").normalized).toBe(
      "CommandOrControl+Shift+Space",
    );
  });

  it("keeps the original key casing for the OS but recognizes case-insensitively", () => {
    expect(validateAccelerator("control+alt+o").key).toBe("o");
    expect(validateAccelerator("CONTROL+ALT+O").key).toBe("O");
  });
});
