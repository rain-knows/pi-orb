import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import koffi from "koffi";

const repo = process.cwd();
const electron = join(repo, "node_modules", "electron", "dist", "electron.exe");
const targetDir = join(repo, "evidence", "p1-05", "target-app");
const root = join(process.env.TEMP ?? "C:\\Windows\\Temp", `pi-orb-wheel-probe-${Date.now()}`);
mkdirSync(root, { recursive: true });
const logPath = join(root, "target.jsonl");
const geometryPath = join(root, "geometry.json");
const target = spawn(electron, [targetDir], {
  cwd: repo,
  env: { ...process.env, P1_05_TARGET_LOG: logPath, P1_05_TARGET_GEOMETRY: geometryPath },
  stdio: ["ignore", "ignore", "pipe"],
});

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitForFile(path) {
  for (let i = 0; i < 80; i += 1) {
    if (existsSync(path)) {
      try { return JSON.parse(readFileSync(path, "utf8")); } catch {}
    }
    await sleep(250);
  }
  throw new Error(`missing ${path}`);
}

const enumProc = koffi.proto("int PiOrbProbeEnum(void *hwnd, intptr lParam)");
const user32 = koffi.load("user32.dll");
const EnumWindows = user32.func("int __stdcall EnumWindows(PiOrbProbeEnum *lpEnumFunc, intptr lParam)");
const GetWindowThreadProcessId = user32.func("uint32 __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *lpdwProcessId)");
const GetWindowTextLengthW = user32.func("int __stdcall GetWindowTextLengthW(void *hWnd)");
const GetWindowTextW = user32.func("int __stdcall GetWindowTextW(void *hWnd, uint16_t *lpString, int nMaxCount)");
const SetCursorPos = user32.func("int __stdcall SetCursorPos(int X, int Y)");
const GetForegroundWindow = user32.func("void * __stdcall GetForegroundWindow()");
const POINT = koffi.struct("PiOrbProbePoint", { x: "int32", y: "int32" });
const GetCursorPos = user32.func("int __stdcall GetCursorPos(PiOrbProbePoint *point)");
const WindowFromPoint = user32.func("void * __stdcall WindowFromPoint(PiOrbProbePoint point)");
const MOUSEINPUT = koffi.struct("PiOrbProbeMouseInput", { dx: "int32", dy: "int32", mouseData: "uint32", dwFlags: "uint32", time: "uint32", dwExtraInfo: "uintptr" });
const INPUT_UNION = koffi.union("PiOrbProbeInputUnion", { mi: MOUSEINPUT });
const INPUT = koffi.struct("PiOrbProbeInput", { type: "uint32", u: INPUT_UNION });
const SendInput = user32.func("uint32 __stdcall SendInput(uint32 cInputs, PiOrbProbeInput *pInputs, int cbSize)");
const mouse_event = user32.func("void __stdcall mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, int dwData, uintptr dwExtraInfo)");
const PostMessageW = user32.func("int __stdcall PostMessageW(void *hWnd, uint32 Msg, uintptr wParam, intptr lParam)");
const keybd_event = user32.func("void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)");
const EnumChildWindows = user32.func("int __stdcall EnumChildWindows(void *hWndParent, PiOrbProbeEnum *lpEnumFunc, intptr lParam)");
const GetClassNameW = user32.func("int __stdcall GetClassNameW(void *hWnd, uint16_t *lpClassName, int nMaxCount)");
const SetFocus = user32.func("void * __stdcall SetFocus(void *hWnd)");
const MOUSEEVENTF_MOVE = 1;
const MOUSEEVENTF_WHEEL = 0x800;
const MOUSEEVENTF_LEFTDOWN = 0x2;
const MOUSEEVENTF_LEFTUP = 0x4;
const MOUSEEVENTF_ABSOLUTE = 0x8000;
const MOUSEEVENTF_VIRTUALDESK = 0x4000;
const SM_XVIRTUALSCREEN = 76;
const SM_YVIRTUALSCREEN = 77;
const SM_CXVIRTUALSCREEN = 78;
const SM_CYVIRTUALSCREEN = 79;
const GetSystemMetrics = user32.func("int __stdcall GetSystemMetrics(int nIndex)");

function address(value) { return Number(koffi.address(value)); }
function text(hwnd) {
  const length = GetWindowTextLengthW(hwnd);
  if (length <= 0) return "";
  const buffer = Buffer.alloc((length + 1) * 2);
  GetWindowTextW(hwnd, buffer, length + 1);
  return buffer.toString("utf16le", 0, length * 2);
}
function className(hwnd) {
  const buffer = Buffer.alloc(256 * 2);
  const length = GetClassNameW(hwnd, buffer, 256);
  return length > 0 ? buffer.toString("utf16le", 0, length * 2) : "";
}
function windowInfo(hwnd) {
  if (!hwnd) return null;
  const pid = [0];
  GetWindowThreadProcessId(hwnd, pid);
  return { hwnd: address(hwnd), pid: pid[0], title: text(hwnd), className: className(hwnd) };
}
function findWindow(pid, title) {
  let found;
  const callback = koffi.register(hwnd => {
    const owner = [0];
    GetWindowThreadProcessId(hwnd, owner);
    if (owner[0] === pid && text(hwnd) === title) { found = hwnd; return 0; }
    return 1;
  }, koffi.pointer(enumProc));
  try { EnumWindows(callback, 0); } finally { koffi.unregister(callback); }
  return found;
}
function sendWheel(hwnd, x, y, delta) {
  const left = GetSystemMetrics(SM_XVIRTUALSCREEN);
  const top = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const width = Math.max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN));
  const height = Math.max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN));
  const move = { type: 0, u: { mi: { dx: Math.round(((x - left) * 65535) / Math.max(1, width - 1)), dy: Math.round(((y - top) * 65535) / Math.max(1, height - 1)), mouseData: 0, dwFlags: MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, time: 0, dwExtraInfo: 0 } } };
  const wheel = { type: 0, u: { mi: { dx: 0, dy: 0, mouseData: delta >>> 0, dwFlags: MOUSEEVENTF_WHEEL, time: 0, dwExtraInfo: 0 } } };
  if (SendInput(1, [move], koffi.sizeof(INPUT)) !== 1) throw new Error("move SendInput failed");
  if (SetCursorPos(x, y) === 0) throw new Error("SetCursorPos failed");
  if (SendInput(1, [wheel], koffi.sizeof(INPUT)) !== 1) throw new Error("wheel SendInput failed");
  mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0n);
  const wParam = BigInt((delta & 0xffff) << 16);
  const lParam = BigInt((y & 0xffff) | ((x & 0xffff) << 16));
  const children = [];
  const callback = koffi.register(child => { children.push(child); return 1; }, koffi.pointer(enumProc));
  try { EnumChildWindows(hwnd, callback, 0); } finally { koffi.unregister(callback); }
  for (const child of [hwnd, ...children]) {
    console.error("posting wheel to", address(child), className(child));
    PostMessageW(child, 0x20a, wParam, lParam);
  }
  const renderChild = children.find(child => className(child) === "Chrome_RenderWidgetHostHWND");
  if (renderChild) SetFocus(renderChild);
  const clickDown = { type: 0, u: { mi: { dx: 0, dy: 0, mouseData: 0, dwFlags: MOUSEEVENTF_LEFTDOWN, time: 0, dwExtraInfo: 0 } } };
  const clickUp = { type: 0, u: { mi: { dx: 0, dy: 0, mouseData: 0, dwFlags: MOUSEEVENTF_LEFTUP, time: 0, dwExtraInfo: 0 } } };
  SendInput(1, [clickDown], koffi.sizeof(INPUT));
  SendInput(1, [clickUp], koffi.sizeof(INPUT));
  keybd_event(0x41, 0, 0, 0n);
  keybd_event(0x41, 0, 2, 0n);
}

try {
  const geometry = await waitForFile(geometryPath);
  const hwnd = findWindow(target.pid, "P1-05 input target");
  if (!hwnd) throw new Error(`window not found for pid ${target.pid}`);
  const hwndNumber = address(hwnd);
  const activated = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(repo, "evidence", "lib", "activate-window.ps1"), "-Hwnd", String(hwndNumber), "-Chord", "ctrl+alt+f11"], { encoding: "utf8", timeout: 30000 }).trim().split(/\r?\n/).at(-1));
  const point = geometry.scroller?.physicalScreenPoint ?? { x: 500, y: 800 };
  const before = readFileSync(logPath, "utf8").trim().split(/\r?\n/).filter(Boolean).length;
  const foregroundBefore = address(GetForegroundWindow());
  const childrenForFocus = [];
  const focusCallback = koffi.register(child => { childrenForFocus.push(child); return 1; }, koffi.pointer(enumProc));
  try { EnumChildWindows(hwnd, focusCallback, 0); } finally { koffi.unregister(focusCallback); }
  const renderForFocus = childrenForFocus.find(child => className(child) === "Chrome_RenderWidgetHostHWND");
  if (renderForFocus) SetFocus(renderForFocus);
  const hitTestBefore = windowInfo(WindowFromPoint({ x: point.x, y: point.y }));
  sendWheel(hwnd, point.x, point.y, -120);
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class W { [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int x,int y); [DllImport(\"user32.dll\")] public static extern void mouse_event(uint f,uint dx,uint dy,int d,UIntPtr e); }'; [W]::SetCursorPos(${point.x},${point.y}); [W]::mouse_event(0x800,0,0,-120,[UIntPtr]::Zero)`], { stdio: "ignore", timeout: 30000 });
  await sleep(1000);
  const actualCursor = { x: 0, y: 0 };
  GetCursorPos(actualCursor);
  const hitTestAfter = windowInfo(WindowFromPoint({ x: point.x, y: point.y }));
  const foregroundAfter = windowInfo(GetForegroundWindow());
  const events = readFileSync(logPath, "utf8").trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  console.log(JSON.stringify({ pid: target.pid, hwnd: hwndNumber, geometry: geometry.scroller, activated, foregroundBefore, foregroundAfter, point, actualCursor, hitTestBefore, hitTestAfter, inputSize: koffi.sizeof(INPUT), eventsBefore: before, eventsAfter: events.length, events: events.slice(before) }, null, 2));
} finally {
  try { execFileSync("taskkill", ["/PID", String(target.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
}
