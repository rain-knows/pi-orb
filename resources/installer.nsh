; Minimal public electron-builder hooks. No template replacement or PATH modification.
!macro customInstall
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\pi-orb.exe" "" "$INSTDIR\pi-orb.exe"
!macroend

!macro customUnInstall
  ExecWait '"$INSTDIR\pi-orb.exe" --remove-bundled-plugin' $1
  StrCmp $1 0 +2
    MessageBox MB_OK "Pi 插件未能移除。请用 pi remove 手动移除安装目录 resources\pi-plugin 的声明；模型和历史已保留。"
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\pi-orb.exe" ""
  StrCmp $0 "$INSTDIR\pi-orb.exe" 0 +2
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\pi-orb.exe"
!macroend
