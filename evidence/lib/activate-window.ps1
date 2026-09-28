# Foreground a chosen window, then optionally send a keyboard chord. Shared by stage runners.
#
# Why this exists (P1-04's positive capture path, P1-05's click/foreground delivery): the product
# records "the window the user was looking at" during a wake, and records it BEFORE the orb is shown,
# and the driver only delivers real input to a window that is in front. So a test that wants to
# exercise those paths without adding a hook to the product must put its OWN disposable window in
# front. For P1-04 the chord is then the product's real wake accelerator; P1-05 uses -ForegroundOnly.
#
# Safety: this only ever targets a window handle the caller obtained from a process the caller started,
# and it sends at most one wake chord. It never types text into the target and never reads the
# target's content.
#
# Uses keybd_event rather than SendInput: SendInput needs an explicit-layout union struct, and setting
# that union's fields from PowerShell did not reliably stick (SendInput reported the inputs accepted
# while the registered hotkey never fired, consistent with wVk having stayed 0).
param(
  [Parameter(Mandatory = $true)][string]$Hwnd,
  [string]$LogPath,
  # The chord to send. Defaults to the product's default wake accelerator.
  [ValidateSet('ctrl+shift+space')][string]$Chord = 'ctrl+shift+space',
  # Skip the key synthesis and only foreground the window.
  [switch]$ForegroundOnly
)

Add-Type -Namespace Wake -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.IntPtr dwExtraInfo);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint pid);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
[DllImport("user32.dll")] public static extern bool IsWindow(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern int GetWindowTextLength(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern int GetWindowText(System.IntPtr hWnd, System.Text.StringBuilder s, int n);
'@

function Write-Log([hashtable]$Entry) {
  if (-not $LogPath) { return }
  $entry = @{ at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } + $Entry
  ($entry | ConvertTo-Json -Compress -Depth 6) | Add-Content -Path $LogPath -Encoding utf8
}

$target = [System.IntPtr]::new([int64]$Hwnd)
if (-not [Wake.Native]::IsWindow($target)) {
  Write-Log @{ kind = 'error'; reason = 'the given handle is not a window'; hwnd = $Hwnd }
  Write-Output (ConvertTo-Json -Compress @{ ok = $false; reason = 'not-a-window' })
  exit 2
}

function Get-ForegroundInfo {
  $fg = [Wake.Native]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [void][Wake.Native]::GetWindowText($fg, $sb, 512)
  return @{ hwnd = $fg.ToString(); title = $sb.ToString() }
}

# Foreground stealing needs the calling thread attached to the current foreground thread, and Windows
# additionally refuses SetForegroundWindow from a process that is not currently in front. Two
# documented unlocks are applied: a synthetic ALT press (which Windows treats as user intent to
# switch windows) and a minimize/restore cycle on the target.
function Set-TargetForeground([System.IntPtr]$h) {
  [Wake.Native]::keybd_event(0x12, 0, 0, [System.IntPtr]::Zero)                  # ALT down
  [Wake.Native]::keybd_event(0x12, 0, [uint32]0x0002, [System.IntPtr]::Zero)     # ALT up
  Start-Sleep -Milliseconds 80

  $fg = [Wake.Native]::GetForegroundWindow()
  $fgPid = 0
  $fgThread = [Wake.Native]::GetWindowThreadProcessId($fg, [ref]$fgPid)
  $myThread = [Wake.Native]::GetCurrentThreadId()
  [void][Wake.Native]::AttachThreadInput($myThread, $fgThread, $true)
  [void][Wake.Native]::ShowWindow($h, 6)    # SW_MINIMIZE
  Start-Sleep -Milliseconds 120
  [void][Wake.Native]::ShowWindow($h, 9)    # SW_RESTORE
  [void][Wake.Native]::BringWindowToTop($h)
  $ok = [Wake.Native]::SetForegroundWindow($h)
  [void][Wake.Native]::AttachThreadInput($myThread, $fgThread, $false)
  return $ok
}

$setOk = Set-TargetForeground $target
Start-Sleep -Milliseconds 500

$after = Get-ForegroundInfo
$isForeground = $after.hwnd -eq $target.ToString()
if (-not $isForeground) {
  # One retry: the first attempt can be refused if the desktop was mid-switch.
  $setOk = Set-TargetForeground $target
  Start-Sleep -Milliseconds 600
  $after = Get-ForegroundInfo
  $isForeground = $after.hwnd -eq $target.ToString()
}
Write-Log @{ kind = 'foreground'; setForegroundWindowReturned = $setOk; targetHwnd = $target.ToString(); foregroundHwnd = $after.hwnd; foregroundTitle = $after.title; isForeground = $isForeground }

if (-not $isForeground) {
  Write-Output (ConvertTo-Json -Compress @{ ok = $false; reason = 'could-not-foreground'; foreground = $after })
  exit 3
}

if ($ForegroundOnly) {
  Write-Output (ConvertTo-Json -Compress @{ ok = $true; foregrounded = $true; title = $after.title })
  exit 0
}

# VK_CONTROL=0x11, VK_SHIFT=0x10, VK_SPACE=0x20 ; KEYEVENTF_KEYUP=0x0002
function Send-Key([byte]$vk, [bool]$up) {
  [Wake.Native]::keybd_event($vk, 0, $(if ($up) { [uint32]0x0002 } else { [uint32]0 }), [System.IntPtr]::Zero)
  Start-Sleep -Milliseconds 60
}

Send-Key 0x11 $false   # Ctrl down
Send-Key 0x10 $false   # Shift down
Send-Key 0x20 $false   # Space down
Start-Sleep -Milliseconds 120
Send-Key 0x20 $true
Send-Key 0x10 $true
Send-Key 0x11 $true

Write-Log @{ kind = 'keys-sent'; chord = $Chord; mechanism = 'keybd_event' }
Write-Output (ConvertTo-Json -Compress @{ ok = $true; foregrounded = $true; chordSent = $Chord; title = $after.title })
