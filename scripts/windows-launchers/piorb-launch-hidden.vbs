Option Explicit
Dim shell
Set shell = CreateObject("WScript.Shell")
shell.Environment("PROCESS").Remove "ELECTRON_RUN_AS_NODE"
shell.CurrentDirectory = shell.ExpandEnvironmentStrings("%USERPROFILE%")
shell.Run "pi-orb.exe", 1, False
