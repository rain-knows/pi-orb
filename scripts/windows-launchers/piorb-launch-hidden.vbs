Option Explicit
Dim shell, fso, executable
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
On Error Resume Next
executable = shell.RegRead("HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\pi-orb.exe\")
If Err.Number <> 0 Then
  WScript.Echo "The current-user pi-orb installation was not found."
  WScript.Quit 1
End If
On Error GoTo 0
If Not fso.FileExists(executable) Then
  WScript.Echo "pi-orb.exe was not found: " & executable
  WScript.Quit 1
End If
shell.Environment("PROCESS").Remove "ELECTRON_RUN_AS_NODE"
shell.CurrentDirectory = shell.ExpandEnvironmentStrings("%USERPROFILE%")
shell.Run """" & executable & """", 1, False
