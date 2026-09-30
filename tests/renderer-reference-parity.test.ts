import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// The reference shell is now real HTML/CSS, so assert its DOM rather than looking for JSX strings.
const root = join(import.meta.dirname, "..");
const html = readFileSync(join(root, "src/renderer/index.html"), "utf8");
const css = readFileSync(join(root, "src/renderer/floating.css"), "utf8");

describe("reference floating shell", () => {
  it("mounts the actual reference hierarchy and Pi host surfaces", () => {
    const document = new JSDOM(html).window.document;
    const panel = document.querySelector("#panel");
    expect(panel).not.toBeNull();
    for (const selector of ["#history", "#permission-button", "#new-conversation", "#transcript", "#question", "#history-list", "#selection-chip", "#composer", "#prompt", "#access-sheet", "#preview-sheet"]) {
      expect(panel?.querySelector(selector), selector).not.toBeNull();
    }
    for (const selector of ["#ball", "#ball-gif", "#dock-tab", "#stop"]) {
      expect(document.querySelector(selector), selector).not.toBeNull();
    }
    expect(panel?.querySelector("#composer #prompt[contenteditable='true']")).not.toBeNull();
    expect(document.querySelector("#tcc-gate")).toBeNull();
    expect(document.querySelector("#root")).toBeNull();
  });

  it("keeps the reference geometry, tokens and state selectors", () => {
    for (const token of ["--ball", "--composer-height", "--prompt-line", "--prompt-pad", "--composer-max", "--chrome", "--panel-radius", "--selection-chip", "--black", "--white", "--input-bg", "--border", "--pin", "--error", "--ball-shadow", "--panel-shadow", "--origin-x", "--origin-y"]) {
      expect(css, token).toContain(token);
    }
    expect(css).toMatch(/--ball:\s*72px/u);
    expect(css).toMatch(/--chrome:\s*12px/u);
    expect(css).toMatch(/--panel-radius:\s*36px/u);
    expect(css).toMatch(/--composer-height:\s*var\(--ball\)/u);
    expect(css).toMatch(/transform-origin:\s*var\(--origin-x\)\s+var\(--origin-y\)/u);
    expect(css).toMatch(/transition:\s*opacity 300ms ease-in-out,\s*transform 300ms ease-in-out/u);
    for (const selector of ["body.expanded", "body.pinned", "body.running", "body.has-selection-chip", "body.docked", "body.docked-left", "body.docked-right", "body.expand-left", "body.expand-right", "body.expand-up", "body.expand-down"]) {
      expect(css, selector).toContain(selector);
    }
    expect(css).toContain("html[data-ds-dark-theme]");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("retains the restricted renderer boundary", () => {
    const policy = new JSDOM(html).window.document.querySelector("meta[http-equiv='Content-Security-Policy']")?.getAttribute("content");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).not.toContain("dsh-app:");
    expect(html).not.toContain("deepseek-avatar");
    expect(html).not.toContain("main.tsx");
  });
});
