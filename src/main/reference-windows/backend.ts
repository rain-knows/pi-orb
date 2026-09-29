/**
 * Host-neutral contracts copied from deepseek-harness-orb's computer-use backend.
 * The Pi/Cordis session types are intentionally omitted; pi-orb owns that boundary.
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
export const UNFOCUSED_WINDOW_NOTE = "Keyboard focus is on another window. Keyboard actions bring this window forward first.";
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
