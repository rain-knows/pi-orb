Option Explicit
Dim shell, fso, executable, exitCode, description, log
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
executable = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\pi-orb\pi-orb.exe")
shell.Environment("PROCESS").Remove "ELECTRON_RUN_AS_NODE"
shell.CurrentDirectory = shell.ExpandEnvironmentStrings("%USERPROFILE%")
On Error Resume Next
Err.Clear
shell.Run """" & executable & """", 1, False
exitCode = Err.Number
description = Err.Description
On Error GoTo 0
Set log = fso.OpenTextFile(fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "piorb-launch.log"), 8, True)
log.WriteLine Now & " host=" & WScript.FullName & " executable=" & executable & " error=" & exitCode & " " & description
log.Close
If exitCode <> 0 Then
  WScript.Echo "Unable to launch: " & executable & vbCrLf & "Error " & Hex(exitCode) & ": " & description
  WScript.Quit 1
End If
