/**
 * Host-neutral contracts copied from deepseek-harness-orb's computer-use backend.
 *
 * Source: `deepseek-harness-orb` commit `72f1d738458a223696685a909e806b683eff5885`,
 * `packages/experimental/tool-computer-use/src/backend.ts` (MIT). Trimmed for pi-orb: the Cordis
 * session types, the `createPlatformBackend` factory and the macOS/unsupported branches are gone,
 * because pi-orb's only production backend is the Windows one and the Pi session boundary is
 * pi-orb's own. Overlay handling is the single `backend.withGuiTurn` call site in
 * `src/main/index.ts` rather than the reference's `wrapDesktopBackend`.
 */

export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export interface ScreenInfo {
  readonly index: number;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly scale: number;
  readonly windowId?: number;
  readonly transientWindowIds?: readonly number[];
}

export interface CapturedScreen {
  readonly data: Uint8Array;
  readonly mediaType: ImageMediaType;
}

export interface DesktopForeground {
  readonly appName: string;
  readonly windowTitle?: string;
  readonly finderFolder?: string;
  readonly focusNote?: string;
}

export const FOCUS_NOTE = "Keyboard focus is not on an operable app. Click the target window first if the next step needs focus.";
/**
 * Model-facing copy when the reported Windows window is not the keyboard foreground.
 *
 * Restored verbatim from the reference (commit `72f1d73`, `src/backend.ts:79-80`). The earlier
 * pi-orb copy stopped after "bring this window forward first", so a model that needed focus on a
 * specific control was never told to click inside the window first. `hotkey` does bring the
 * recorded target forward before posting keys, so the copy matches the executor.
 */
export const UNFOCUSED_WINDOW_NOTE = "Keyboard focus is on another window. hotkey brings this window forward first; click inside it if focus must land on a specific control.";
export const FOCUS_FALLBACK_FOREGROUND: DesktopForeground = { appName: "none", focusNote: FOCUS_NOTE };

export type ClickButton = "left" | "right";

export interface ClickInput {
  readonly screen: ScreenInfo;
  readonly position: readonly [number, number];
  readonly button: ClickButton;
  readonly count: 1 | 2;
  readonly modifiers?: readonly string[];
}

export interface TypeInput {
  readonly screen: ScreenInfo;
  readonly position: readonly [number, number];
  readonly text: string;
  readonly replace: boolean;
  readonly submit: boolean;
}

export interface ScrollInput {
  readonly screen: ScreenInfo;
  readonly position: readonly [number, number];
  readonly direction: "up" | "down";
  readonly scrollLevel: number;
}

export interface HotkeyInput { readonly keys: readonly string[]; }
export interface LongPressInput {
  readonly screen: ScreenInfo;
  readonly position: readonly [number, number];
  readonly durationSeconds: number;
}
export interface DragInput {
  readonly startScreen: ScreenInfo;
  readonly startPosition: readonly [number, number];
  readonly endScreen: ScreenInfo;
  readonly endPosition: readonly [number, number];
}
export interface OpenAppInput { readonly name: string; }
export interface OpenAppResult { readonly kind: "activated" | "launched"; readonly name: string; }
export interface OpenInBrowserInput { readonly url?: string; }
export interface OpenInFinderInput { readonly path: string; readonly revealOnly: boolean; }
export interface CopyImageToClipboardInput { readonly path: string; readonly mediaType: ImageMediaType; }

export interface DesktopBackend {
  listScreens(signal?: AbortSignal): Promise<readonly ScreenInfo[]>;
  capture(screen: ScreenInfo, signal?: AbortSignal): Promise<CapturedScreen>;
  inspectForeground(signal?: AbortSignal): Promise<DesktopForeground>;
  listApps(signal?: AbortSignal): Promise<readonly string[]>;
  openApp(input: OpenAppInput, signal?: AbortSignal): Promise<OpenAppResult>;
  click(input: ClickInput, signal?: AbortSignal): Promise<void>;
  typeText(input: TypeInput, signal?: AbortSignal): Promise<void>;
  scroll(input: ScrollInput, signal?: AbortSignal): Promise<void>;
  hotkey(input: HotkeyInput, signal?: AbortSignal): Promise<void>;
  longPress(input: LongPressInput, signal?: AbortSignal): Promise<void>;
  drag(input: DragInput, signal?: AbortSignal): Promise<void>;
  openInBrowser(input: OpenInBrowserInput, signal?: AbortSignal): Promise<void>;
  openInFinder(input: OpenInFinderInput, signal?: AbortSignal): Promise<void>;
  copyImageToClipboard(input: CopyImageToClipboardInput, signal?: AbortSignal): Promise<void>;
  withGuiTurn<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}
