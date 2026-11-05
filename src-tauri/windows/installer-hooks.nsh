; Up to 1.9 the app was called KiJi, and its installer registered under that name.
; A new install would land beside it, so run the old uninstaller first. It removes
; the old program only: the library in %APPDATA%\com.yomilab.kiji stays.
!macro NSIS_HOOK_PREINSTALL
  Push $R0
  Push $R1
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\KiJi" "UninstallString"
  ReadRegStr $R1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\KiJi" "InstallLocation"
  ${If} $R0 != ""
  ${AndIf} $R1 != ""
    ; InstallLocation is stored in quotes; _?= needs the bare path.
    StrCpy $R1 $R1 -1 1
    ExecWait '$R0 /S _?=$R1'
    Delete "$R1\uninstall.exe"
    RMDir "$R1"
  ${EndIf}
  Pop $R1
  Pop $R0
!macroend
