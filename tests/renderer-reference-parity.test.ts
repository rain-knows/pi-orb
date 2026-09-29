import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The floating shell is a port of the reference project's `apps/desktop/renderer/floating.css`
 * (deepseek-harness-orb commit 72f1d738458a223696685a909e806b683eff5885, MIT). The reuse rule in
 * AGENTS.md is that a ported design system keeps the reference's names, so a later comparison with
 * upstream is a diff rather than a translation — and the front end had drifted away from exactly
 * that without anyone noticing, which is why this test exists.
 *
 * It pins the two things that make the port a port: the custom properties the reference defines, and
 * the layout state vocabulary the reference drives from `body`. It deliberately does not pin
 * decorative values (colors are the reference palette, but a future change to a token's value is a
 * design decision, not a drift), and it does not require reference-only surfaces pi-orb has no
 * counterpart for (`#question*`, `#tcc-*`, `#ball-gif`, the transcript iframe — see the file header
 * in `src/renderer/styles.css` and `doc/p2-01-reference-reuse.md`).
 */

const repo = join(import.meta.dirname, "..");
const css = readFileSync(join(repo, "src", "renderer", "styles.css"), "utf8");
const app = readFileSync(join(repo, "src", "renderer", "App.tsx"), "utf8");

/** Custom property names defined anywhere in the stylesheet. */
function definedTokens(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/(--[a-z][\w-]*)\s*:/gu)) {
    if (match[1] !== undefined) names.add(match[1]);
  }
  return names;
}

describe("ported reference design tokens", () => {
  // Every token the reference defines for the floating shell. Keeping the names is the point: it is
  // what lets a value be checked against upstream by reading two files side by side.
  const referenceTokens = [
    "--ball",
    "--composer-height",
    "--prompt-line",
    "--prompt-pad",
    "--composer-max",
    "--chrome",
    "--panel-radius",
    "--selection-chip",
    "--black",
    "--white",
    "--input-bg",
    "--border",
    "--pin",
    "--error",
    "--ball-shadow",
    "--panel-shadow",
    "--origin-x",
    "--origin-y",
  ];

  it("defines every reference token under its reference name", () => {
    const defined = definedTokens(css);
    const missing = referenceTokens.filter((token) => !defined.has(token));
    expect(missing).toEqual([]);
  });

  it("keeps the reference geometry values", () => {
    // These specific numbers are the reference's; the playbook records them as must-match.
    expect(css).toMatch(/--ball:\s*72px/u);
    expect(css).toMatch(/--chrome:\s*12px/u);
    expect(css).toMatch(/--panel-radius:\s*36px/u);
    expect(css).toMatch(/--selection-chip:\s*28px/u);
    // The composer is the height of the ball, expressed as a reference, not as a second literal.
    expect(css).toMatch(/--composer-height:\s*var\(--ball\)/u);
  });

  it("keeps the reference's origin-based panel reveal", () => {
    // The reveal is opacity plus a scale from a corner origin; this is the signature interaction of
    // the reference shell and the thing an ad-hoc rewrite loses first.
    expect(css).toMatch(/transform-origin:\s*var\(--origin-x\)\s+var\(--origin-y\)/u);
    expect(css).toMatch(/transform:\s*scale\(0?\.18\)/u);
    expect(css).toMatch(/transition:\s*opacity 300ms ease-in-out,\s*transform 300ms ease-in-out/u);
  });

  it("sets the origin per expand direction", () => {
    for (const direction of ["left", "right", "up", "down"]) {
      expect(css).toMatch(new RegExp(String.raw`body\.expand-${direction}\s*\{[^}]*--origin-`, "u"));
    }
  });

  it("takes the dark palette from the reference attribute, not a media query", () => {
    // The reference resolves the theme in the host and states it in the DOM; a media query cannot
    // carry the user's explicit choice.
    expect(css).toMatch(/html\[data-ds-dark-theme\]/u);
    const darkBlock = css.slice(css.indexOf("html[data-ds-dark-theme]"));
    expect(darkBlock).toMatch(/--black:\s*rgb\(249, 250, 251\)/u);
    expect(darkBlock).toMatch(/--white:\s*rgb\(21, 21, 23\)/u);
  });
});

describe("ported reference layout state", () => {
  it("uses the reference state vocabulary", () => {
    // Orientation states are emitted from templates (`expand-${horizontal}`, `docked-${side}`), so
    // the emission shape is checked here and the full set of selector names is checked against the
    // stylesheet, which is what actually has to handle every value.
    for (const literal of ["expanded", "pinned", "running", "has-selection-chip", "docked"]) {
      expect(app, literal).toContain(literal);
    }
    expect(app).toMatch(/`expand-\$\{/u);
    expect(app).toMatch(/`docked-\$\{/u);
  });

  it("styles every state the shell can emit", () => {
    for (const selector of [
      "body.expanded",
      "body.pinned",
      "body.running",
      "body.has-selection-chip",
      "body.docked",
      "body.docked-left",
      "body.docked-right",
      "body.expand-left",
      "body.expand-right",
      "body.expand-up",
      "body.expand-down",
    ]) {
      expect(css, selector).toContain(selector);
    }
  });

  it("emits the state on body, the way the reference does", () => {
    expect(app).toMatch(/document\.body\.className\s*=/u);
  });

  it("wires hover expansion at the window edge like the reference", () => {
    expect(app).toMatch(/document\.body\.addEventListener\("pointerenter"/u);
    expect(app).toMatch(/document\.body\.addEventListener\("pointerleave"/u);
  });

  it("mounts the reference element ids", () => {
    // Ids, not classes: the reference identifies its shell elements by id, and the CSS above is
    // written against those ids.
    for (const id of ["panel", "ball", "composer", "dock-tab", "prompt", "selection-chip", "history", "new-conversation", "transcript", "send"]) {
      expect(app).toContain(`id="${id}"`);
    }
  });
});

describe("ported shell stays free of the abandoned naming", () => {
  it("has no leftover orb__/orb-- classes", () => {
    // The previous rewrite used an `orb__*` scheme with no relationship to the reference. Leaving
    // any behind would mean two design systems in one window.
    expect(css).not.toMatch(/\.orb__/u);
    expect(css).not.toMatch(/\.orb--/u);
    expect(app).not.toMatch(/orb__/u);
    expect(app).not.toMatch(/orb--/u);
  });
});

describe("ported interaction timings and guards", () => {
  // The reference's `floating.js` opens with four timing constants (:3-6) that its state machine
  // reads. They are what the gesture feels like, so a value drifting here is a product change, not a
  // detail — pi-orb had the collapse delay at 480ms against the reference's 180ms.
  it("keeps the reference interaction timings", () => {
    expect(app).toMatch(/const COLLAPSE_MS = 180;/u);
    expect(app).toMatch(/const ANIMATION_MS = 300;/u);
    expect(app).toMatch(/const DOCK_HOVER_DELAY_MS = 800;/u);
  });

  it("uses the timing constants instead of repeating the numbers", () => {
    // A bare 300 or 800 next to the constants would mean one call site was missed.
    expect(app).toMatch(/setTimeout\(\(\) => setPanelHidden\(true\), ANIMATION_MS\)/u);
    expect(app).toMatch(/\}, COLLAPSE_MS\)/u);
    expect(app).toMatch(/\}, DOCK_HOVER_DELAY_MS\)/u);
  });

  it("keeps the reference's collapse guard states", () => {
    // `scheduleCollapse` must refuse to schedule while these hold (floating.js:528). pi-orb adds its
    // own overlays, which the reference expresses through its own surfaces.
    const guard = app.slice(app.indexOf("const scheduleCollapse"), app.indexOf("const scheduleCollapse") + 1400);
    for (const state of ["pinned", "busy", "dragging", "selectionContext", "controlsOpen", "historyOpen", "preview"]) {
      expect(guard, state).toMatch(new RegExp(String.raw`\b${state}\b`, "u"));
    }
  });

  it("tracks dragging as state, not only as a ref", () => {
    // The guard reads it during render, so a ref alone would let a hover-leave collapse the panel
    // mid-drag without React ever re-evaluating the guard.
    expect(app).toMatch(/const \[dragging, setDragging\] = useState\(false\)/u);
    expect(app).toMatch(/setDragging\(true\)/u);
    expect(app).toMatch(/setDragging\(false\)/u);
  });

  it("arms the dock tab on a hover delay and cancels it on leave", () => {
    // The reference only unsnaps if the pointer is still on the tab when the timer fires.
    expect(app).toMatch(/onPointerEnter=\{\(\) => \{\s*dockHoverTimer\.current = setTimeout/u);
    expect(app).toMatch(/onPointerLeave=\{\(\) => \{[\s\S]{0,200}clearTimeout\(dockHoverTimer\.current\)/u);
  });

  it("sets the theme attribute the way the reference does", () => {
    // `applyColorScheme` (floating.js:42-47): toggle the attribute and set colorScheme, so the
    // browser's own widgets follow the theme and not only our palette.
    expect(app).toMatch(/toggleAttribute\("data-ds-dark-theme", media\.matches\)/u);
    expect(app).toMatch(/documentElement\.style\.colorScheme/u);
  });
});
