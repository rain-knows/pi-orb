import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// The reference shell is now real HTML/CSS, so assert its DOM rather than looking for JSX strings.
const root = join(import.meta.dirname, "..");
const html = readFileSync(join(root, "src/renderer/index.html"), "utf8");

describe("reference floating shell", () => {
  it("mounts the actual reference hierarchy and Pi host surfaces", () => {
    const document = new JSDOM(html).window.document;
    const panel = document.querySelector("#panel");
    expect(panel).not.toBeNull();
    for (const selector of ["#history", "#permission-button", "#permission-menu", "#access-read-only", "#access-workspace-write", "#access-full", "#new-conversation", "#transcript", "#question", "#history-list", "#selection-chip", "#composer", "#prompt", "#preview-sheet"]) {
      expect(panel?.querySelector(selector), selector).not.toBeNull();
    }
    for (const selector of ["#ball", "#ball-gif", "#dock-tab", "#stop"]) {
      expect(document.querySelector(selector), selector).not.toBeNull();
    }
    expect(panel?.querySelector("#composer #prompt[contenteditable='true']")).not.toBeNull();
  });

  it("retains the restricted renderer boundary", () => {
    const policy = new JSDOM(html).window.document.querySelector("meta[http-equiv='Content-Security-Policy']")?.getAttribute("content");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).not.toContain("dsh-app:");
    expect(new JSDOM(html).window.document.querySelector("#ball-gif")?.getAttribute("src")).toBe("deepseek-avatar-square.gif");
  });
});
