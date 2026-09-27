# P0-04 read-only capture probe — ONE awareness mode per process.
#
# Why a separate process per mode: DPI awareness must be set before any UI/GDI
# call, so a single process cannot measure an unaware capture and a
# per-monitor-aware capture. The driver runs this file twice.
#
# PRIVACY: pixels never touch the filesystem. The image is captured into memory,
# encoded in memory, hashed, and released. Only metadata is persisted.

param(
  [ValidateSet('unaware', 'permonitorv2')]
  [string]$AwarenessMode = 'unaware',
  [Parameter(Mandatory = $true)][string]$OutPath,
  [int]$CancelAfterMs = 120
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class Cap {
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetThreadDpiAwarenessContext();
  [DllImport("user32.dll")] public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowTextLengthW(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr hdc);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int w, int h);
  [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
  [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hdc);
  [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, int rop);
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hdc);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  public delegate bool EnumProc2(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc2 cb, IntPtr l);

  /**
   * Collect visible, non-minimized, titled, non-foreground windows large enough
   * to be meaningful. Several candidates are returned so a single unusual window
   * (for example a touch-keyboard surface) cannot decide the conclusion.
   */
  public static System.Collections.Generic.List<IntPtr> FindBackgroundCandidates(IntPtr foreground, int max) {
    var list = new System.Collections.Generic.List<IntPtr>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (list.Count >= max) return false;
      if (h == foreground) return true;
      if (!IsWindowVisible(h)) return true;
      if (IsIconic(h)) return true;
      if (GetWindowTextLengthW(h) == 0) return true;
      RECT r; if (!GetWindowRect(h, out r)) return true;
      if (r.Right - r.Left < 400 || r.Bottom - r.Top < 300) return true;
      list.Add(h);
      return true;
    }, IntPtr.Zero);
    return list;
  }

  /**
   * Pick a visible, non-minimized, non-foreground window that is large enough to
   * be meaningful. Used to test whether a window can be captured WITHOUT
   * bringing it to the foreground (the background/foreground semantic).
   */
  public static IntPtr FindBackgroundCandidate(IntPtr foreground) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (h == foreground) return true;
      if (!IsWindowVisible(h)) return true;
      if (IsIconic(h)) return true;
      if (GetWindowTextLengthW(h) == 0) return true;
      RECT r; if (!GetWindowRect(h, out r)) return true;
      if (r.Right - r.Left < 400 || r.Bottom - r.Top < 300) return true;
      found = h;
      return false;
    }, IntPtr.Zero);
    return found;
  }
  [DllImport("user32.dll")] public static extern uint GetGuiResources(IntPtr process, uint flag);

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  public const int SRCCOPY = 0x00CC0020;

  /** DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4 */
  public static bool MakePerMonitorV2() {
    return SetProcessDpiAwarenessContext(new IntPtr(-4));
  }
  public static int ThreadAwareness() { return GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext()); }
}
'@

# --- Awareness, set before any capture --------------------------------------
$awarenessApplied = switch ($AwarenessMode) {
  'permonitorv2' { [Cap]::MakePerMonitorV2() }
  default { $false }
}

$virtualW = [Cap]::GetSystemMetrics(0)
$virtualH = [Cap]::GetSystemMetrics(1)
$desktopDpi = [Cap]::GetDpiForWindow([Cap]::GetDesktopWindow())

# --- GDI baseline (cleanup evidence) ----------------------------------------
$proc = [System.Diagnostics.Process]::GetCurrentProcess()
function Get-GdiCount { [int][Cap]::GetGuiResources($proc.Handle, 0) }
$gdiBaseline = Get-GdiCount
$gdiStages = [ordered]@{ baseline = $gdiBaseline }

# --- Full-screen capture into memory only -----------------------------------
$screenSw = [System.Diagnostics.Stopwatch]::StartNew()
$screenDc = [Cap]::GetDC([IntPtr]::Zero)
$memDc = [Cap]::CreateCompatibleDC($screenDc)
$bitmap = [Cap]::CreateCompatibleBitmap($screenDc, $virtualW, $virtualH)
$prev = [Cap]::SelectObject($memDc, $bitmap)
$bitbltOk = [Cap]::BitBlt($memDc, 0, 0, $virtualW, $virtualH, $screenDc, 0, 0, [Cap]::SRCCOPY)
$screenSw.Stop()

# Encode in memory (never a file) to measure format cost + real byte size.
$encodeSw = [System.Diagnostics.Stopwatch]::StartNew()
$ms = New-Object System.IO.MemoryStream
$image = [System.Drawing.Image]::FromHbitmap($bitmap)
$image.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$encodeSw.Stop()
$pngBytes = $ms.ToArray()

$sha = [System.Security.Cryptography.SHA256]::Create()
$pngHash = ($sha.ComputeHash($pngBytes) | Select-Object -First 8 | ForEach-Object { $_.ToString('x2') }) -join ''

$image.Dispose()
$ms.Dispose()

# Decode check: the acceptance item asks for decode + dimensions, not only byte
# count. Re-parse the encoded bytes from memory and confirm the decoded pixel
# size matches the captured size.
$decodeSw = [System.Diagnostics.Stopwatch]::StartNew()
$decodedWidth = 0
$decodedHeight = 0
$decodedFormat = 'unknown'
$decodeOk = $false
try {
  $ms2 = New-Object System.IO.MemoryStream(,$pngBytes)
  $decoded = [System.Drawing.Image]::FromStream($ms2)
  $decodedWidth = $decoded.Width
  $decodedHeight = $decoded.Height
  $decodedFormat = $decoded.RawFormat.ToString()
  $decodeOk = ($decodedWidth -eq $virtualW -and $decodedHeight -eq $virtualH)
  $decoded.Dispose()
  $ms2.Dispose()
} catch {
  $decodeOk = $false
}
$decodeSw.Stop()
[Cap]::SelectObject($memDc, $prev) | Out-Null
[Cap]::DeleteObject($bitmap) | Out-Null
[Cap]::DeleteDC($memDc) | Out-Null
$gdiStages['afterFullScreenCaptureAndEncode'] = Get-GdiCount

# --- Window-relative capture: coordinate mapping evidence -------------------
$fg = [Cap]::GetForegroundWindow()
$rect = New-Object Cap+RECT
$hasRect = [Cap]::GetWindowRect($fg, [ref]$rect)
$winW = if ($hasRect) { $rect.Right - $rect.Left } else { 0 }
$winH = if ($hasRect) { $rect.Bottom - $rect.Top } else { 0 }
$fgPid = 0
[Cap]::GetWindowThreadProcessId($fg, [ref]$fgPid) | Out-Null
$fgProcess = (Get-Process -Id $fgPid -ErrorAction SilentlyContinue).ProcessName
$fgDpi = [Cap]::GetDpiForWindow($fg)

# PrintWindow: capture a specific window WITHOUT bringing it to the foreground.
# Two flag variants are tried, because a composited/DirectComposition window may
# refuse the full-content flag; the result is recorded rather than assumed.
$winSw = [System.Diagnostics.Stopwatch]::StartNew()
$winCaptured = $false
$winCaptureFlag = $null
$winBitmapSize = $null
if ($hasRect -and $winW -gt 0 -and $winH -gt 0) {
  foreach ($flag in 2, 0) {
    $wdc = [Cap]::CreateCompatibleDC($screenDc)
    $wbm = [Cap]::CreateCompatibleBitmap($screenDc, $winW, $winH)
    $wprev = [Cap]::SelectObject($wdc, $wbm)
    $ok = [Cap]::PrintWindow($fg, $wdc, [uint32]$flag)
    [Cap]::SelectObject($wdc, $wprev) | Out-Null
    [Cap]::DeleteObject($wbm) | Out-Null
    [Cap]::DeleteDC($wdc) | Out-Null
    $winCaptureFlag = $flag
    if ($ok) { $winCaptured = $true; break }
  }
  $winBitmapSize = @{ width = $winW; height = $winH }
}
$winSw.Stop()
$gdiStages['afterWindowCapture'] = Get-GdiCount

# --- Background vs foreground capture semantics ------------------------------
# Does a window have to be the foreground window to be captured? Try PrintWindow
# on several visible but NON-foreground windows. Nothing is raised or focused.
$bgSw = [System.Diagnostics.Stopwatch]::StartNew()
$bgCandidates = [Cap]::FindBackgroundCandidates($fg, 4)
$bgResults = @()
foreach ($cand in $bgCandidates) {
  $bgRect = New-Object Cap+RECT
  $hasBgRect = [Cap]::GetWindowRect($cand, [ref]$bgRect)
  $bgW = if ($hasBgRect) { $bgRect.Right - $bgRect.Left } else { 0 }
  $bgH = if ($hasBgRect) { $bgRect.Bottom - $bgRect.Top } else { 0 }
  $bgPid = 0
  [Cap]::GetWindowThreadProcessId($cand, [ref]$bgPid) | Out-Null
  $captured = $false
  $usedFlag = $null
  foreach ($flag in 2, 0) {
    $bdc = [Cap]::CreateCompatibleDC($screenDc)
    $bbm = [Cap]::CreateCompatibleBitmap($screenDc, [Math]::Max(1, $bgW), [Math]::Max(1, $bgH))
    $bprev = [Cap]::SelectObject($bdc, $bbm)
    $ok = [Cap]::PrintWindow($cand, $bdc, [uint32]$flag)
    [Cap]::SelectObject($bdc, $bprev) | Out-Null
    [Cap]::DeleteObject($bbm) | Out-Null
    [Cap]::DeleteDC($bdc) | Out-Null
    $usedFlag = $flag
    if ($ok) { $captured = $true; break }
  }
  $bgResults += @{
    process                 = (Get-Process -Id $bgPid -ErrorAction SilentlyContinue).ProcessName
    titleLength             = [Cap]::GetWindowTextLengthW($cand)
    className               = 'hashed'
    size                    = @{ width = $bgW; height = $bgH }
    wasForeground           = $false
    capturedWhileBackground = $captured
    flagUsed                = $usedFlag
    dpi                     = [Cap]::GetDpiForWindow($cand)
  }
}
$bgForegroundUnchanged = [Cap]::GetForegroundWindow() -eq $fg
$bgSw.Stop()

# --- Repeat-leak measurement (read-only) ------------------------------------
# The real question is not the absolute handle count of a one-shot probe but
# whether repeated capture cycles GROW it. Record per-cycle counts so growth (a
# leak) is distinguishable from a fixed residue that dies with the process.
$repeatSw = [System.Diagnostics.Stopwatch]::StartNew()
$cycleCounts = @()
$cycles = 8
for ($i = 0; $i -lt $cycles; $i++) {
  $dc2 = [Cap]::CreateCompatibleDC($screenDc)
  $bm = [Cap]::CreateCompatibleBitmap($screenDc, 128, 128)
  $old = [Cap]::SelectObject($dc2, $bm)
  [Cap]::BitBlt($dc2, 0, 0, 128, 128, $screenDc, 0, 0, [Cap]::SRCCOPY) | Out-Null
  [Cap]::SelectObject($dc2, $old) | Out-Null
  [Cap]::DeleteObject($bm) | Out-Null
  [Cap]::DeleteDC($dc2) | Out-Null
  $cycleCounts += (Get-GdiCount)
}
$repeatSw.Stop()
$gdiStages['afterRepeatCycles'] = Get-GdiCount

# --- Cancellation semantics (read-only) -------------------------------------
# A capture loop abandoned mid-flight must not leak GDI objects either.
$cancelSw = [System.Diagnostics.Stopwatch]::StartNew()
$iterations = 0
$aborted = $false
$cancelCounts = @()
try {
  while ($cancelSw.ElapsedMilliseconds -lt $CancelAfterMs) {
    $dc2 = [Cap]::CreateCompatibleDC($screenDc)
    $bm = [Cap]::CreateCompatibleBitmap($screenDc, 64, 64)
    $old = [Cap]::SelectObject($dc2, $bm)
    [Cap]::BitBlt($dc2, 0, 0, 64, 64, $screenDc, 0, 0, [Cap]::SRCCOPY) | Out-Null
    [Cap]::SelectObject($dc2, $old) | Out-Null
    [Cap]::DeleteObject($bm) | Out-Null
    [Cap]::DeleteDC($dc2) | Out-Null
    $iterations++
    if ($iterations % 5 -eq 0) { $cancelCounts += (Get-GdiCount) }
  }
  $aborted = $true
} catch {
  $aborted = $true
}
$cancelSw.Stop()
$gdiStages['afterCancelLoop'] = Get-GdiCount

# Release the shared screen DC once, after every capture path has finished.
[Cap]::ReleaseDC([IntPtr]::Zero, $screenDc) | Out-Null

# --- Cleanup verification ---------------------------------------------------
$beforeGc = Get-GdiCount
[GC]::Collect()
[GC]::WaitForPendingFinalizers()
[GC]::Collect()
$guiAfter = Get-GdiCount
$gdiStages['beforeGc'] = $beforeGc
$gdiStages['afterGc'] = $guiAfter

$record = [ordered]@{
  awarenessMode        = $AwarenessMode
  awarenessApplied     = $awarenessApplied
  threadAwarenessValue = [Cap]::ThreadAwareness()
  virtualScreen        = @{ width = $virtualW; height = $virtualH }
  desktopDpi           = $desktopDpi
  fullScreenCapture    = @{
    bitbltSucceeded = $bitbltOk
    width           = $virtualW
    height          = $virtualH
    captureMs       = $screenSw.ElapsedMilliseconds
    pngEncodeMs     = $encodeSw.ElapsedMilliseconds
    pngByteSize     = $pngBytes.Length
    pngFormat       = 'png'
    pngSha256Prefix = $pngHash
    pixelsPersisted = 0
  }
  decodeVerification   = @{
    decoded          = $decodeOk
    decodedWidth     = $decodedWidth
    decodedHeight    = $decodedHeight
    capturedWidth    = $virtualW
    capturedHeight   = $virtualH
    decodedFormat    = $decodedFormat
    decodeMs         = $decodeSw.ElapsedMilliseconds
    dimensionsMatch  = $decodeOk
  }
  windowCapture        = @{
    targetWasForeground = $true
    targetProcess       = $fgProcess
    targetDpi           = $fgDpi
    titleLength         = [Cap]::GetWindowTextLengthW($fg)
    rectFromGetWindowRect = @{ left = $rect.Left; top = $rect.Top; width = $winW; height = $winH }
    printWindowSucceeded  = $winCaptured
    printWindowFlagUsed  = $winCaptureFlag
    printWindowNote      = 'flags tried in order 2 (PW_RENDERFULLCONTENT) then 0; a composited window may refuse both, which means window-targeted capture needs a compositor-aware fallback'
    capturedSize          = $winBitmapSize
    captureMs             = $winSw.ElapsedMilliseconds
    broughtToForeground   = $false
  }
  backgroundCapture    = @{
    candidateCount      = @($bgResults).Count
    elapsedMs           = $bgSw.ElapsedMilliseconds
    candidates          = $bgResults
    anyCapturedWhileBackground = (@($bgResults | Where-Object { $_.capturedWhileBackground }).Count -gt 0)
    foregroundUnchanged = $bgForegroundUnchanged
    conclusion          = 'anyCapturedWhileBackground=true means at least one real window was captured without being raised; false means no tested window could be captured in the background, so the driver may have to front a window (a visible, disruptive behavior the product must disclose)'
  }
  cancellation         = @{
    readOnlyCancelled     = $aborted
    iterationsBeforeAbort = $iterations
    elapsedMs             = $cancelSw.ElapsedMilliseconds
    gdiCountsEveryFiveIterations = $cancelCounts
    gdiCountsPerRepeatCycle = $cycleCounts
    repeatCycles          = $cycles
    repeatElapsedMs       = $repeatSw.ElapsedMilliseconds
    growthAcrossRepeats   = if ($cycleCounts.Count -gt 1) { $cycleCounts[-1] - $cycleCounts[0] } else { 0 }
    note                  = 'read-only cancel path; no input was pressed, so no key/mouse release applies here (that stays a P1-05 requirement)'
  }
  cleanup              = @{
    gdiStages        = $gdiStages
    gdiObjectsBefore = $gdiBaseline
    gdiObjectsAfter  = $guiAfter
    delta            = $guiAfter - $gdiBaseline
    note             = 'per-stage GDI accounting distinguishes a probe-internal handle from a real leak; a nonzero delta after GC on a one-shot process is process-exit-scoped, not a long-running leak'
  }
  screenshotsTaken     = 1
  pixelsWrittenToDisk  = 0
  inputSent            = 0
}

$record | ConvertTo-Json -Depth 8 | Set-Content -Path $OutPath -Encoding UTF8
Write-Output "wrote $OutPath"
