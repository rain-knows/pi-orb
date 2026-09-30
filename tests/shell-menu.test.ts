import { describe, expect, it, vi } from "vitest";

// `shell-menu` imports `electron` for `Menu`. The template is pure data, so it is tested directly;
// `popup` is captured so the stacking guard can be exercised without a window.
const popup = vi.fn();
vi.mock("electron", () => ({ Menu: { buildFromTemplate: vi.fn(() => ({ popup })) } }));

const { shellMenuTemplate, showShellMenu } = await import("../src/main/shell-menu");

/**
 * The orb shell's context menu, ported from the reference's `floatingContextMenuTemplate`
 * (deepseek-harness-orb commit 72f1d73, `apps/desktop/src/floating-window.ts:55-129`).
 *
 * The reason it exists is the first block: Electron windows have no default context menu, so without
 * it there is no way to cut, copy or paste in the composer by mouse at all. The reference enables
 * those roles from the focused field's `editFlags`, so a disabled item explains itself instead of
 * silently doing nothing.
 */

const noop = () => undefined;
const actions = { onCollapse: noop, onQuit: noop, onClearSelectionContext: noop };
const labels = (items: readonly { label?: string; type?: string; role?: string }[]) =>
  items.map((item) => item.role ?? item.label ?? item.type ?? "?");

describe("ported shell context menu", () => {
  it("offers the edit roles only when the target is editable, as the reference does", () => {
    // Not editable: no cut/copy/paste, and no separators left dangling for them.
    const readonly = shellMenuTemplate(
      { isEditable: false, canCut: false, canCopy: true, canPaste: false, canSelectAll: false, hasSelectionContext: false },
      actions,
    );
    expect(labels(readonly)).toEqual(["隐藏悬浮球", "separator", "退出 pi-orb"]);

    const editable = shellMenuTemplate(
      { isEditable: true, canCut: true, canCopy: true, canPaste: true, canSelectAll: true, hasSelectionContext: false },
      actions,
    );
    expect(labels(editable)).toEqual([
      "cut",
      "copy",
      "paste",
      "separator",
      "selectAll",
      "separator",
      "隐藏悬浮球",
      "separator",
      "退出 pi-orb",
    ]);
  });

  it("disables individual edit roles from the field's own flags", () => {
    // "Paste" with an empty clipboard must be visibly unavailable rather than a no-op on click.
    const items = shellMenuTemplate(
      { isEditable: true, canCut: false, canCopy: false, canPaste: true, canSelectAll: true, hasSelectionContext: false },
      actions,
    );
    const byRole = new Map(items.filter((item) => item.role !== undefined).map((item) => [item.role, item.enabled]));
    expect(byRole.get("cut")).toBe(false);
    expect(byRole.get("copy")).toBe(false);
    expect(byRole.get("paste")).toBe(true);
    expect(byRole.get("selectAll")).toBe(true);
  });

  it("uses the platform roles rather than re-spelling the editing commands", () => {
    // Roles give the labels, accelerators and platform behaviour for free; hard-coded labels would
    // have to be re-localised and would drift from the host.
    const items = shellMenuTemplate(
      { isEditable: true, canCut: true, canCopy: true, canPaste: true, canSelectAll: true, hasSelectionContext: false },
      actions,
    );
    for (const role of ["cut", "copy", "paste", "selectAll"]) {
      const item = items.find((entry) => entry.role === role);
      expect(item, role).toBeDefined();
      expect(item?.label, `${role} must not hard-code a label`).toBeUndefined();
    }
  });

  it("adds the selection item only while context is attached", () => {
    const without = shellMenuTemplate(
      { isEditable: false, canCut: false, canCopy: false, canPaste: false, canSelectAll: false, hasSelectionContext: false },
      actions,
    );
    const with_ = shellMenuTemplate(
      { isEditable: false, canCut: false, canCopy: false, canPaste: false, canSelectAll: false, hasSelectionContext: true },
      actions,
    );
    expect(labels(without)).not.toContain("移除选中文本");
    expect(labels(with_)).toEqual(["隐藏悬浮球", "移除选中文本", "separator", "退出 pi-orb"]);
  });

  it("refuses to stack a second menu while one is open", () => {
    // `Menu.popup` does not replace a visible popup, and Windows holds the window's message pump
    // while one is up, so a second right-click must not build a second menu.
    popup.mockClear();
    const window = { isDestroyed: () => false };
    const request = { isEditable: false, canCut: false, canCopy: false, canPaste: false, canSelectAll: false, hasSelectionContext: false };
    const asWindow = window as unknown as Parameters<typeof showShellMenu>[0];

    showShellMenu(asWindow, request, actions);
    expect(popup).toHaveBeenCalledTimes(1);
    // The first menu is still open (its callback has not fired), so the second request is dropped.
    showShellMenu(asWindow, request, actions);
    expect(popup).toHaveBeenCalledTimes(1);

    // Once it closes, the next request is served again — the guard is not a permanent latch.
    const closed = popup.mock.calls[0]?.[0]?.callback as (() => void) | undefined;
    expect(closed).toBeTypeOf("function");
    closed?.();
    showShellMenu(asWindow, request, actions);
    expect(popup).toHaveBeenCalledTimes(2);
    // Leave the module's state closed for any later test in this file.
    (popup.mock.calls[1]?.[0]?.callback as (() => void) | undefined)?.();
  });

  it("does nothing for a destroyed window", () => {
    popup.mockClear();
    showShellMenu({ isDestroyed: () => true } as unknown as Parameters<typeof showShellMenu>[0], {
      isEditable: false, canCut: false, canCopy: false, canPaste: false, canSelectAll: false, hasSelectionContext: false,
    }, actions);
    expect(popup).not.toHaveBeenCalled();
  });

  it("routes Pi utilities through the context menu and keeps the reference shell actions", () => {
    const calls: string[] = [];
    const items = shellMenuTemplate(
      { isEditable: false, canCut: false, canCopy: false, canPaste: false, canSelectAll: false, hasSelectionContext: true },
      {
        onModel: () => calls.push("model"),
        onScreenshot: () => calls.push("screenshot"),
        onShortcut: () => calls.push("shortcut"),
        onCollapse: () => calls.push("collapse"),
        onQuit: () => calls.push("quit"),
        onClearSelectionContext: () => calls.push("clear"),
      },
    );
    for (const item of items) item.click?.({} as never, undefined, {} as never);
    expect(calls).toEqual(["model", "screenshot", "shortcut", "collapse", "clear", "quit"]);

    const text = items.map((item) => item.label ?? "").join(" ");
    for (const absent of ["Settings", "Toolbar", "Millifraction"]) {
      expect(text).not.toContain(absent);
    }
  });
});
