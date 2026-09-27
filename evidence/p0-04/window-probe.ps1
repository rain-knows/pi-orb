# P0-04 read-only window/DPI probe (no screenshots, no input).
#
# Enumerates top-level windows and monitor/DPI geometry through Win32 APIs only.
# It deliberately does NOT capture pixels, send input, or install anything.
#
# Window titles are treated as potentially sensitive: the persisted record keeps
# only a length, a SHA-256 prefix, and the owning process name — never the literal
# title text.

param(
  [string]$OutPath = "$PSScriptRoot\window-probe.json"
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class P0Probe {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowTextLengthW(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);

  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct MONITORINFOEX {
    public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string szDevice;
  }
  public delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, ref RECT rect, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool GetMonitorInfoW(IntPtr hMonitor, ref MONITORINFOEX info);
  [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr hMonitor, int dpiType, out uint dpiX, out uint dpiY);
  [DllImport("user32.dll")] public static extern IntPtr GetThreadDpiAwarenessContext();
  [DllImport("user32.dll")] public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool EnumDisplaySettingsW(string deviceName, int modeNum, ref DEVMODE devMode);

  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
    public ushort dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
    public uint dmFields;
    public int dmPositionX, dmPositionY;
    public uint dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
    public ushort dmLogPixels;
    public uint dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
  }

  public static string PhysicalMode(string device) {
    var dm = new DEVMODE();
    dm.dmSize = (ushort)Marshal.SizeOf(typeof(DEVMODE));
    if (!EnumDisplaySettingsW(device, -1, ref dm)) return null;
    return dm.dmPelsWidth + "x" + dm.dmPelsHeight + "@" + dm.dmDisplayFrequency;
  }

  public static int ThreadDpiAwareness() { return GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext()); }
  public static int SystemMetricsWidth() { return GetSystemMetrics(0); }
  public static int SystemMetricsHeight() { return GetSystemMetrics(1); }

  public class WindowRow {
    public long hwnd; public int titleLength; public string titleSha; public string className;
    public int pid; public string process; public int left, top, right, bottom, width, height;
    public bool visible, minimized, foreground;
    public uint dpi; public int ownerPid;
  }

  public static List<WindowRow> Rows = new List<WindowRow>();
  public static IntPtr Foreground = GetForegroundWindow();
  public static long ForegroundValue = Foreground.ToInt64();

  public static void Collect() {
    Rows.Clear();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      var titleLen = GetWindowTextLengthW(hWnd);
      var sb = new StringBuilder(512);
      GetWindowTextW(hWnd, sb, sb.Capacity);
      var cls = new StringBuilder(256);
      GetClassNameW(hWnd, cls, cls.Capacity);
      RECT r; GetWindowRect(hWnd, out r);
      uint pid; GetWindowThreadProcessId(hWnd, out pid);
      var row = new WindowRow();
      row.hwnd = hWnd.ToInt64();
      row.titleLength = titleLen;
      row.titleSha = Hashing.Sha(sb.ToString());
      row.className = cls.ToString();
      row.pid = (int)pid;
      row.left = r.Left; row.top = r.Top; row.right = r.Right; row.bottom = r.Bottom;
      row.width = r.Right - r.Left; row.height = r.Bottom - r.Top;
      row.visible = IsWindowVisible(hWnd);
      row.minimized = IsIconic(hWnd);
      row.foreground = hWnd == Foreground;
      row.dpi = GetDpiForWindow(hWnd);
      Rows.Add(row);
      return true;
    }, IntPtr.Zero);
  }

  public static List<string> Monitors() {
    var list = new List<string>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr hMon, IntPtr hdc, ref RECT rect, IntPtr data) {
      var info = new MONITORINFOEX();
      info.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
      var name = "unknown"; var rawName = ""; var work = ""; var bounds = "";
      if (GetMonitorInfoW(hMon, ref info)) {
        rawName = info.szDevice;
        name = rawName.Replace("\\", "/");
        bounds = info.rcMonitor.Left + "," + info.rcMonitor.Top + "," + info.rcMonitor.Right + "," + info.rcMonitor.Bottom;
        work = info.rcWork.Left + "," + info.rcWork.Top + "," + info.rcWork.Right + "," + info.rcWork.Bottom;
      }
      uint dx = 0, dy = 0;
      try { GetDpiForMonitor(hMon, 0, out dx, out dy); } catch { }
      var physical = P0Probe.PhysicalMode(rawName) ?? "unknown";
      list.Add("{\"device\":\"" + name + "\",\"virtualizedBounds\":\"" + bounds + "\",\"work\":\"" + work + "\",\"dpiX\":" + dx + ",\"dpiY\":" + dy + ",\"scalePercent\":" + (dx == 0 ? 0 : (int)Math.Round(dx * 100.0 / 96.0)) + ",\"physicalMode\":\"" + physical + "\"}");
      return true;
    }, IntPtr.Zero);
    return list;
  }
}

public class Hashing {
  public static string Sha(string value) {
    using (var sha = System.Security.Cryptography.SHA256.Create()) {
      var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(value ?? ""));
      var sb = new StringBuilder();
      for (int i = 0; i < 6; i++) sb.Append(bytes[i].ToString("x2"));
      return sb.ToString();
    }
  }
}
'@

$sw = [System.Diagnostics.Stopwatch]::StartNew()
[P0Probe]::Collect()
$enumMs = $sw.ElapsedMilliseconds

$pidName = @{}
Get-Process | ForEach-Object { $pidName[[int]$_.Id] = $_.ProcessName }

$rows = [P0Probe]::Rows | ForEach-Object {
  [ordered]@{
    hwnd        = $_.hwnd
    titleLength = $_.titleLength
    titleSha    = $_.titleSha
    className   = $_.className
    pid         = $_.pid
    process     = $pidName[$_.pid]
    rect        = @{ left = $_.left; top = $_.top; right = $_.right; bottom = $_.bottom }
    size        = @{ width = $_.width; height = $_.height }
    visible     = $_.visible
    minimized   = $_.minimized
    foreground  = $_.foreground
    dpi         = $_.dpi
  }
}

$monitors = [P0Probe]::Monitors() | ForEach-Object { $_ | ConvertFrom-Json }

$record = [ordered]@{
  capturedAt        = (Get-Date).ToUniversalTime().ToString('o')
  probeKind         = 'read-only window/DPI enumeration'
  screenshotsTaken  = 0
  inputSent         = 0
  titleHandling     = 'titles are hashed (6-byte SHA-256 prefix) and length only; literal titles are never persisted'
  enumerationMs     = $enumMs
  windowCount       = @($rows).Count
  visibleCount      = @($rows | Where-Object { $_.visible }).Count
  foregroundWindow  = ($rows | Where-Object { $_.foreground } | Select-Object -First 1)
  primaryDpi        = [P0Probe]::Rows | Where-Object { $_.dpi -gt 0 } | Select-Object -First 1 -ExpandProperty dpi
  dpiAwareness      = [ordered]@{
    processAwarenessValue = [P0Probe]::ThreadDpiAwareness()
    awarenessLegend       = '0=UNAWARE, 1=SYSTEM_AWARE, 2=PER_MONITOR_AWARE; a UNAWARE process receives virtualized coordinates and DPI 96'
    virtualizedScreen     = "$([P0Probe]::SystemMetricsWidth())x$([P0Probe]::SystemMetricsHeight())"
    physicalResolutions   = (Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentHorizontalResolution } | ForEach-Object { "$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution)" })
    coordinateRisk        = 'input coordinates (virtualized) and screenshot pixels (physical) are different spaces unless the helper declares DPI awareness; a mapping must convert explicitly'
  }
  monitors          = $monitors
  windows           = $rows
  os                = (Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber, OSArchitecture)
  notes             = @(
    'No pixel capture: capture cost, image decode, and image dimensions remain unverified until screenshot permission is granted.',
    'Window geometry and DPI are the inputs a coordinate mapping needs; they do not show that a click lands correctly (that is P1-05).',
    'Console/principal windows are enumerated independently of foreground state, so a background window can be identified without activating it.'
  )
}

$record | ConvertTo-Json -Depth 8 | Set-Content -Path $OutPath -Encoding UTF8
Write-Output "wrote $OutPath"
Write-Output ("windows={0} visible={1} monitors={2} enumMs={3}" -f $record.windowCount, $record.visibleCount, $monitors.Count, $enumMs)
