# Report which keys are physically down right now, for a key-residue check.
#
# Why this exists: the stage used to judge "no key was left pressed" by comparing key-down and key-up
# counts in the *target application's* own event log. That proxy is corrupted by the test harness
# itself — the foreground unlock in activate-window.ps1 deliberately taps ALT, and Windows swallows the
# matching standalone ALT release while it is in menu mode, so the target logged 34 ALT downs and 1
# unrelated key-up while no key was actually held. A count imbalance in that log therefore says nothing
# about the product.
#
# This reports the real, global keyboard state via GetAsyncKeyState instead. The caller takes one sample
# before any input and one after, and only a key that is down *after but not before* is residue — which
# keeps the check immune to both the harness's own synthetic taps and a key the user happens to hold.
param()

Add-Type -Namespace KeyState -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
'@

# The keys any of this stage's actions could plausibly leave behind: the modifiers used by the wake
# chord, the typing keys, and the navigation keys the driver sends.
$vkeys = [ordered]@{
  'Alt'      = 0x12
  'Control'  = 0x11
  'Shift'    = 0x10
  'Space'    = 0x20
  'Tab'      = 0x09
  'Enter'    = 0x0D
  'Escape'   = 0x1B
  'CapsLock' = 0x14
  'A'        = 0x41
  'B'        = 0x42
  'O'        = 0x4F
  'P'        = 0x50
  'R'        = 0x52
  'T'        = 0x54
  'Y'        = 0x59
  'MouseLeft'   = 0x01
  'MouseRight'  = 0x02
  'MouseMiddle' = 0x04
}

$down = @()
foreach ($entry in $vkeys.GetEnumerator()) {
  # High bit set means the key is currently down.
  $state = [KeyState.Native]::GetAsyncKeyState([int]$entry.Value)
  if (($state -band 0x8000) -ne 0) { $down += $entry.Key }
}

Write-Output (ConvertTo-Json -Compress @{ down = @($down); sampledAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() })
