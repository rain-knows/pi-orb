# Records the current foreground window and its geometry.
#
# P1-04 requires the screenshot target to be recorded BEFORE the orb takes focus, so
# the orb cannot capture itself. Electron cannot read the foreground window or its
# DPI, so this uses Win32 through PowerShell.
#
# Contract: always writes one JSON object to stdout. On any failure it writes
# `{ "ok": false, "reason": ... }` rather than throwing, so the caller can report a
# specific problem instead of "the helper crashed".
#
# Read-only: no input is sent, nothing is captured, no pixel is touched.

param(
  [string]$IsStillValid = "",
  [string]$ExpectedTitle = ""
)

$ErrorActionPreference = 'Stop'

Add-Type -Namespace P1OrbTarget -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
[DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
[DllImport("user32.dll")] public static extern IntPtr GetThreadDpiAwarenessContext();
[DllImport("user32.dll")] public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr value);
[DllImport("user32.dll")] public static extern bool AreDpiAwarenessContextsEqual(IntPtr a, IntPtr b);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
'@

# P0-04 measured that a DPI-unaware process sees virtualized coordinates on this
# machine (1707x1067 instead of 2560x1600, a 1.5x difference) and that windows with
# dpi=96 and dpi=144 coexist. A helper that reports window bounds must therefore
# declare per-monitor-v2 awareness, or its geometry cannot be mapped to screen
# coordinates. The resulting awareness value is reported so a caller can detect a
# silent regression.
$DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = [IntPtr]::new(-4)
$DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE = [IntPtr]::new(-3)
$DPI_AWARENESS_CONTEXT_SYSTEM_AWARE = [IntPtr]::new(-2)
$DPI_AWARENESS_CONTEXT_UNAWARE = [IntPtr]::new(-1)
$awarenessDeclared = $false
try {
  $awarenessDeclared = [P1OrbTarget.Native]::SetProcessDpiAwarenessContext($DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)
} catch {
  $awarenessDeclared = $false
}

# GetAwarenessFromDpiAwarenessContext collapses v1 and v2 into the same value
# (DPI_AWARENESS_PER_MONITOR_AWARE = 2), so the context must be compared directly to
# tell the two apart. Reporting only the enum would hide the exact distinction
# P0-04 asked for.
$effectiveContext = [P1OrbTarget.Native]::GetThreadDpiAwarenessContext()
$awarenessValue = [P1OrbTarget.Native]::GetAwarenessFromDpiAwarenessContext($effectiveContext)
$isPerMonitorV2 = [P1OrbTarget.Native]::AreDpiAwarenessContextsEqual($effectiveContext, $DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)
$isPerMonitor = [P1OrbTarget.Native]::AreDpiAwarenessContextsEqual($effectiveContext, $DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE)
$isSystemAware = [P1OrbTarget.Native]::AreDpiAwarenessContextsEqual($effectiveContext, $DPI_AWARENESS_CONTEXT_SYSTEM_AWARE)
$isUnaware = [P1OrbTarget.Native]::AreDpiAwarenessContextsEqual($effectiveContext, $DPI_AWARENESS_CONTEXT_UNAWARE)

function Emit($value) {
  Write-Output ($value | ConvertTo-Json -Compress -Depth 6)
}

function Describe-Window([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) { return $null }
  if (-not [P1OrbTarget.Native]::IsWindow($handle)) { return $null }

  $rect = New-Object P1OrbTarget.Native+RECT
  $hasRect = [P1OrbTarget.Native]::GetWindowRect($handle, [ref]$rect)

  $length = [P1OrbTarget.Native]::GetWindowTextLength($handle)
  $title = ''
  if ($length -gt 0) {
    $buffer = New-Object System.Text.StringBuilder ($length + 1)
    [void][P1OrbTarget.Native]::GetWindowText($handle, $buffer, $buffer.Capacity)
    $title = $buffer.ToString()
  }

  # `$pid` is a PowerShell automatic variable; using it would silently shadow the
  # real process id.
  $ownerProcessId = 0
  [void][P1OrbTarget.Native]::GetWindowThreadProcessId($handle, [ref]$ownerProcessId)

  return [ordered]@{
    handle    = $handle.ToInt64().ToString()
    processId = [int]$ownerProcessId
    title     = $title
    visible   = [bool][P1OrbTarget.Native]::IsWindowVisible($handle)
    dpi       = [int][P1OrbTarget.Native]::GetDpiForWindow($handle)
    bounds    = [ordered]@{
      x      = if ($hasRect) { $rect.Left } else { 0 }
      y      = if ($hasRect) { $rect.Top } else { 0 }
      width  = if ($hasRect) { $rect.Right - $rect.Left } else { 0 }
      height = if ($hasRect) { $rect.Bottom - $rect.Top } else { 0 }
    }
  }
}

try {
  $foreground = [P1OrbTarget.Native]::GetForegroundWindow()
  $cursor = New-Object P1OrbTarget.Native+POINT
  [void][P1OrbTarget.Native]::GetCursorPos([ref]$cursor)

  # `IsStillValid` answers "is the window I recorded still the same window?" — that is a different
  # question from "is it still in front". After the user deliberately switches to the orb, the
  # recorded window is no longer in front by design, so foreground-ness cannot be used to decide
  # whether a recorded target is still usable.
  $payload = [ordered]@{
    ok           = $true
    foreground   = Describe-Window $foreground
    cursor       = [ordered]@{ x = $cursor.X; y = $cursor.Y }
    dpiAwareness = [ordered]@{
      requestedPerMonitorV2 = $true
      setCallSucceeded      = [bool]$awarenessDeclared
      # 0 = unaware, 1 = system aware, 2 = per-monitor aware (v1 or v2).
      awarenessValue        = [int]$awarenessValue
      isPerMonitorV2        = [bool]$isPerMonitorV2
      isPerMonitorV1        = [bool]$isPerMonitor
      isSystemAware         = [bool]$isSystemAware
      isUnaware             = [bool]$isUnaware
    }
  }

  if ($IsStillValid -ne '') {
    $valid = $false
    $currentTitle = ''
    $candidate = [IntPtr]::Zero
    try { $candidate = [IntPtr][int64]$IsStillValid } catch { $candidate = [IntPtr]::Zero }
    if ($candidate -ne [IntPtr]::Zero -and [P1OrbTarget.Native]::IsWindow($candidate)) {
      $len = [P1OrbTarget.Native]::GetWindowTextLength($candidate)
      if ($len -gt 0) {
        $sb = New-Object System.Text.StringBuilder ($len + 1)
        [void][P1OrbTarget.Native]::GetWindowText($candidate, $sb, $sb.Capacity)
        $currentTitle = $sb.ToString()
      }
      # A handle can be recycled after its window dies, so the title must still agree.
      $valid = ($ExpectedTitle -eq '') -or ($currentTitle -eq $ExpectedTitle)
    }
    $payload['stillValid'] = [bool]$valid
    $payload['currentTitle'] = $currentTitle
  }

  Emit $payload
} catch {
  Emit ([ordered]@{
    ok     = $false
    reason = $_.Exception.Message
  })
}
