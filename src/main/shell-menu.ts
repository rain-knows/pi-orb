/**
 * The orb shell's context menu.
 *
 * Source: `deepseek-harness-orb` commit `72f1d738458a223696685a909e806b683eff5885`,
 * `apps/desktop/src/floating-window.ts` — `floatingContextMenuTemplate` (MIT, see
 * `THIRD_PARTY_NOTICES.md` §3.5).
 *
 * The structure is the reference's, and the reason it exists at all is the first block: Electron
 * windows have no default context menu, so without this, right-clicking the composer offers no
 * cut/copy/paste and the field cannot be edited by mouse at all. The reference enables those roles
 * from the focused field's `editFlags` so a disabled item says *why* it is disabled (nothing
 * selected, clipboard empty) instead of silently doing nothing.
 *
 * The reference's remaining items include Open Main Window, Floating Agent Settings, a Selection
 * Toolbar toggle, a millifraction-coordinates toggle and Quit. Mapped to pi-orb:
 *
 *  - **Quit** is kept. The tray also has it, but a menu that opens on the ball and cannot quit the
 *    app would be the odd one out.
 *  - **Collapse** replaces Open Main Window: pi-orb has no main window of its own (pi-web owns the
 *    chat UI), and hiding the orb is the equivalent "put this away" action. It routes through the
 *    same lifecycle call as the tray and the shortcut, so it still revokes desktop authority.
 *  - Model selection and wake-shortcut editing live here instead of the primary floating panel.
 *    Model selection still uses pi-web's own catalog; shortcut editing changes only the existing
 *    pi-orb wake shortcut.
 *  - The two reference toggles are not ported: pi-orb has neither a selection toolbar nor an
 *    alternate coordinate mode.
 */
import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from "electron";

/** What the renderer asks for, validated before it reaches the menu. */
export interface ShellMenuRequest {
  /** Whether the focused element accepts text, which is what enables the edit block. */
  readonly isEditable: boolean;
  readonly canCut: boolean;
  readonly canCopy: boolean;
  readonly canPaste: boolean;
  readonly canSelectAll: boolean;
  /** Whether the panel is currently showing attached selection context, for the chip's label. */
  readonly hasSelectionContext: boolean;
}

export interface ShellMenuActions {
  readonly onCollapse: () => void;
  readonly onQuit: () => void;
  readonly onClearSelectionContext: () => void;
  readonly onModel?: () => void;
  readonly onScreenshot?: () => void;
  readonly onShortcut?: () => void;
  readonly onWorkspace?: () => void;
}

/**
 * Build the menu items for the shell.
 *
 * Exported separately from the popup so the template can be asserted without an Electron window,
 * which is how the reference tests its own template.
 */
export function shellMenuTemplate(
  request: ShellMenuRequest,
  actions: ShellMenuActions,
): MenuItemConstructorOptions[] {
  const utilities: MenuItemConstructorOptions[] = [];
  if (actions.onWorkspace) utilities.push({ label: "切换工作区…", click: actions.onWorkspace });
  if (actions.onModel) utilities.push({ label: "选择模型", click: actions.onModel });
  if (actions.onScreenshot) utilities.push({ label: "截取屏幕", click: actions.onScreenshot });
  if (actions.onShortcut) utilities.push({ label: "修改唤醒快捷键…", click: actions.onShortcut });
  if (utilities.length > 0) utilities.push({ type: "separator" });
  const shell: MenuItemConstructorOptions[] = [
    ...utilities,
    { label: "隐藏悬浮球", click: actions.onCollapse },
  ];
  if (request.hasSelectionContext) {
    // A label that says what it does to the thing you can see, matching the reference's
    // enable/disable phrasing for its toolbar toggle.
    shell.splice(utilities.length + 1, 0, { label: "移除选中文本", click: actions.onClearSelectionContext });
  }
  shell.push({ type: "separator" }, { label: "退出 pi-orb", click: actions.onQuit });
  if (!request.isEditable) return shell;
  // The edit block sits on top, as in the reference: the roles are the platform's own, so labels,
  // accelerators and behaviour come from Electron rather than being re-spelled here.
  return [
    { role: "cut", enabled: request.canCut },
    { role: "copy", enabled: request.canCopy },
    { role: "paste", enabled: request.canPaste },
    { type: "separator" },
    { role: "selectAll", enabled: request.canSelectAll },
    { type: "separator" },
    ...shell,
  ];
}

/**
 * Show the shell menu over `window`.
 *
 * `Menu.popup` does not replace a visible popup, so this refuses while one is already open rather
 * than stacking a second menu the user would have to dismiss twice. Windows keeps a popup up until it
 * is chosen from or dismissed, and it holds the window's message pump while open, so stacking is not
 * merely untidy: it stalls the shell behind the first menu.
 */
let menuOpen = false;

export function showShellMenu(
  window: BrowserWindow,
  request: ShellMenuRequest,
  actions: ShellMenuActions,
): void {
  if (window.isDestroyed() || menuOpen) return;
  menuOpen = true;
  Menu.buildFromTemplate(shellMenuTemplate(request, actions)).popup({
    window,
    callback: () => {
      menuOpen = false;
    },
  });
}
