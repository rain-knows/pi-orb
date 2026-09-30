import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The reference playbook's §5.2/§5.3 tables pin the values that must match the reference project
 * (`COLLAPSE_MS = 180`, `--ball: 72px`, the dock slide durations, and so on). Those tables were
 * correct while the *code* had drifted — the collapse delay sat at 480ms against a documented 180ms
 * for several stages, because nothing compared the two. The drift was found by reading source, not
 * by a test.
 *
 * This suite closes that loop: every value the playbook pins is asserted against the implementation
 * *and* against a mention in the playbook, so the two cannot silently disagree in either direction.
 * The mapping is declared here rather than parsed out of the Markdown: the playbook writes some
 * values as `NAME = value` inside a sentence and others as their own table cell, and a regex that
 * insists on one shape would fail for reasons that have nothing to do with the constant being right.
 */

const repo = join(import.meta.dirname, "..");
const playbook = readFileSync(join(repo, "doc", "reference-playbook.md"), "utf8");
const geometry = readFileSync(join(repo, "src", "main", "floating-geometry.ts"), "utf8");
const app = readFileSync(join(repo, "src", "renderer", "floating.js"), "utf8");
const css = readFileSync(join(repo, "src", "renderer", "floating.css"), "utf8");

interface PinnedConstant {
  readonly name: string;
  readonly value: string;
  /** Where the constant is defined. */
  readonly source: string;
  readonly sourcePath: string;
  /** The playbook must name it — a value nobody wrote down cannot be "must match". */
  readonly documentedInPlaybook: boolean;
}

const pinned: readonly PinnedConstant[] = [
  { name: "COLLAPSE_MS", value: "180", source: app, sourcePath: "src/renderer/floating.js", documentedInPlaybook: true },
  { name: "ANIMATION_MS", value: "300", source: app, sourcePath: "src/renderer/floating.js", documentedInPlaybook: true },
  { name: "DOCK_HOVER_DELAY_MS", value: "800", source: app, sourcePath: "src/renderer/floating.js", documentedInPlaybook: true },
  { name: "FLOATING_DOCK_SLIDE_OFF_MS", value: "250", source: geometry, sourcePath: "src/main/floating-geometry.ts", documentedInPlaybook: true },
  { name: "FLOATING_DOCK_SLIDE_IN_MS", value: "300", source: geometry, sourcePath: "src/main/floating-geometry.ts", documentedInPlaybook: true },
  { name: "FLOATING_BALL_SIZE", value: "72", source: geometry, sourcePath: "src/main/floating-geometry.ts", documentedInPlaybook: false },
  { name: "FLOATING_CHROME_INSET", value: "12", source: geometry, sourcePath: "src/main/floating-geometry.ts", documentedInPlaybook: false },
  { name: "FLOATING_DOCK_TAB_WIDTH", value: "6", source: geometry, sourcePath: "src/main/floating-geometry.ts", documentedInPlaybook: false },
];

describe("playbook constants agree with the implementation", () => {
  it.each(pinned)("$name is $value in $sourcePath", ({ name, value, source }) => {
    expect(source, `${name} must be ${value}`).toMatch(new RegExp(String.raw`\b${name}\s*=\s*${value}\b`, "u"));
  });

  it.each(pinned.filter((entry) => entry.documentedInPlaybook))(
    "$name is documented in the playbook with the same value",
    ({ name, value }) => {
      // The constant must appear with its value, whether the playbook writes it as a table cell
      // (`| `NAME` | `value` |`) or inside a sentence (`NAME = value`). Plain quoted patterns, so the
      // backticks that appear in the Markdown need no escaping.
      const asCell = new RegExp("[`]" + name + "[`]\\s*\\|\\s*[`]" + value + "[`]", "u");
      const inProse = new RegExp("\\b" + name + "\\s*=\\s*" + value + "\\b", "u");
      expect(asCell.test(playbook) || inProse.test(playbook), `${name} = ${value} must appear in the playbook`).toBe(true);
    },
  );

  it("keeps the geometry the CSS is built from", () => {
    expect(css).toMatch(/--ball:\s*72px/u);
    expect(css).toMatch(/--chrome:\s*12px/u);
    expect(css).toMatch(/--panel-radius:\s*36px/u);
    expect(css).toMatch(/--selection-chip:\s*28px/u);
    expect(geometry).toMatch(/FLOATING_PANEL_SIZE\s*=\s*\{\s*width:\s*320,\s*height:\s*420\s*\}/u);
    // The playbook records the three CSS values together.
    expect(playbook).toMatch(/72px`\s*\/\s*`12px`\s*\/\s*`36px/u);
  });

  it("keeps the dock tab fill equal in the constant and the stylesheet", () => {
    // Two copies exist for a reason (the main process sizes the tab's window, the CSS paints the
    // element), so a mismatch would be silent; the reference keeps one constant and its CSS matches.
    expect(geometry).toMatch(/FLOATING_DOCK_TAB_FILL\s*=\s*"#75757F"/u);
    expect(css.toLowerCase()).toContain("#75757f");
  });

  it("keeps the panel transition equal to ANIMATION_MS", () => {
    // The CSS transition and the renderer's hide delay must agree, or the panel is hidden mid-reveal
    // (or left visible after collapsing).
    expect(css).toMatch(/transition:\s*opacity 300ms ease-in-out,\s*transform 300ms ease-in-out/u);
    expect(app).toMatch(/const ANIMATION_MS = 300\b/u);
  });

  it("keeps the composer height derived from the ball, not repeated", () => {
    // `--composer-height: var(--ball)` is what makes the input pill exactly one ball tall; a second
    // literal would let the two diverge when one changes.
    expect(css).toMatch(/--composer-height:\s*var\(--ball\)/u);
    expect(css).toMatch(/--prompt-line:\s*20px/u);
  });
});
