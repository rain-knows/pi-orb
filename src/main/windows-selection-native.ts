/**
 * Native Windows selection monitor: low-level mouse hook plus UI Automation read-back.
 *
 * Source: `deepseek-harness-orb` commit `72f1d738458a223696685a909e806b683eff5885`,
 * `apps/desktop/src/windows-selection-native.ts` (MIT — see `THIRD_PARTY_NOTICES.md` §3.5).
 *
 * The hook itself only reports the pointer position at the boundary; the selected text comes from
 * `TextPattern` on the focused control, read after release. Both halves are needed: reading on
 * mouse-move would run UIA on every movement, and reading without the hook would not know when the
 * user finished selecting.
 */

import { execFile } from "node:child_process";
import koffi from "koffi";
import type { WindowsSelectionMessage, WindowsSelectionProbe } from "./windows-selection";

const WH_MOUSE_LL = 14;
const WM_LBUTTONUP = 0x0202;
const MONITOR_DEFAULTTONEAREST = 2;

const point = koffi.struct("PI_ORB_SEL_POINT", { x: "int32", y: "int32" });
const mouseHook = koffi.struct("PI_ORB_SEL_MOUSE_HOOK", {
  pt: point,
  mouseData: "uint32",
  flags: "uint32",
  time: "uint32",
  extraInfo: "uintptr",
});
const hookProc = koffi.proto("intptr __stdcall PiOrbSelectionHook(int nCode, uintptr wParam, intptr lParam)");

const selectionScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$focused = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $focused) { return }
$pattern = $null
if (-not $focused.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) { return }
$ranges = @($pattern.GetSelection())
if ($ranges.Length -lt 1) { return }
$text = $ranges[0].GetText(4000)
if ([string]::IsNullOrWhiteSpace($text)) { return }
$rects = @($ranges[0].GetBoundingRectangles())
$x = 0; $y = 0; $width = 0; $height = 0
if ($rects.Length -ge 4) { $x = $rects[0]; $y = $rects[1]; $width = $rects[2]; $height = $rects[3] }
[pscustomobject]@{
  text = $text; x = $x; y = $y; width = $width; height = $height; pid = $focused.Current.ProcessId
} | ConvertTo-Json -Compress
`;

/** Read the focused control's selected text with Windows UI Automation. */
export function readWindowsSelection(): Promise<Awaited<ReturnType<WindowsSelectionProbe["readSelection"]>>> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-STA", "-Command", selectionScript],
      { timeout: 1500, windowsHide: true },
      (error, stdout) => {
        if (error !== null) {
          resolve(undefined);
          return;
        }
        try {
          const parsed: unknown = JSON.parse(stdout);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            resolve(undefined);
            return;
          }
          const record = parsed as Record<string, unknown>;
          if (typeof record.text !== "string" || record.text.trim() === "") {
            resolve(undefined);
            return;
          }
          resolve({
            text: record.text,
            ...(typeof record.pid === "number" ? { pid: record.pid } : {}),
            ...(typeof record.x === "number" ? { x: record.x } : {}),
            ...(typeof record.y === "number" ? { y: record.y } : {}),
            ...(typeof record.width === "number" ? { width: record.width } : {}),
            ...(typeof record.height === "number" ? { height: record.height } : {}),
          });
        } catch {
          resolve(undefined);
        }
      },
    );
  });
}

function dip(x: number, y: number): { x: number; y: number } {
  try {
    const user32 = koffi.load("user32.dll");
    const shcore = koffi.load("shcore.dll");
    const monitorFromPoint = user32.func(
      "void * __stdcall MonitorFromPoint(PI_ORB_SEL_POINT pt, uint32 flags)",
    ) as (point: { x: number; y: number }, flags: number) => unknown;
    const monitor = monitorFromPoint({ x, y }, MONITOR_DEFAULTTONEAREST);
    const dpiForMonitor = shcore.func(
      "int __stdcall GetDpiForMonitor(void *monitor, int type, _Out_ uint32 *dpiX, _Out_ uint32 *dpiY)",
    ) as (monitor: unknown, type: number, dpiX: number[], dpiY: number[]) => number;
    const dpiX = [96];
    const dpiY = [96];
    if (dpiForMonitor(monitor, 0, dpiX, dpiY) !== 0) return { x, y };
    const scale = (dpiX[0] ?? 96) / 96;
    return Number.isFinite(scale) && scale > 0 ? { x: x / scale, y: y / scale } : { x, y };
  } catch {
    return { x, y };
  }
}

/** Install the low-level hook and return an unhook function. */
export function installWindowsSelectionHooks(
  dispatch: (message: WindowsSelectionMessage) => void,
): () => void {
  const user32 = koffi.load("user32.dll");
  const callNextHookEx = user32.func(
    "intptr __stdcall CallNextHookEx(void *hook, int code, uintptr wParam, intptr lParam)",
  ) as (hook: unknown, code: number, wParam: number | bigint, lParam: unknown) => unknown;
  const setWindowsHookEx = user32.func(
    "void * __stdcall SetWindowsHookExW(int idHook, PiOrbSelectionHook *proc, void *module, uint32 threadId)",
  ) as (idHook: number, proc: unknown, module: unknown, threadId: number) => unknown;
  const unhookWindowsHookEx = user32.func("int __stdcall UnhookWindowsHookEx(void *hook)") as (hook: unknown) => number;
  const callbacks: Array<ReturnType<typeof koffi.register>> = [];
  const hooks: unknown[] = [];
  const mouse = koffi.register(
    (code: number, wParam: number | bigint, lParam: unknown) => {
      try {
        if (code >= 0 && Number(wParam) === WM_LBUTTONUP) {
          const info = koffi.decode(lParam, mouseHook) as { pt: { x: number; y: number } };
          dispatch({ type: "mouse-up", button: "left", ...dip(info.pt.x, info.pt.y) });
        }
      } catch {
        // A hook fault must not swallow the rest of the mouse chain.
      }
      return callNextHookEx(null, code, wParam, lParam);
    },
    koffi.pointer(hookProc),
  );
  callbacks.push(mouse);
  hooks.push(setWindowsHookEx(WH_MOUSE_LL, mouse, null, 0));
  return () => {
    for (const hook of hooks) {
      if (hook !== null && hook !== undefined) unhookWindowsHookEx(hook);
    }
    for (const callback of callbacks) koffi.unregister(callback);
  };
}

export function productionSelectionProbe(): WindowsSelectionProbe {
  return { readSelection: readWindowsSelection };
}
