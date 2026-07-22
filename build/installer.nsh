!ifndef MUI_BGCOLOR
  !define MUI_BGCOLOR "0A0C10"
!endif
!ifndef MUI_TEXTCOLOR
  !define MUI_TEXTCOLOR "E8E8EC"
!endif
!ifndef MUI_DIRECTORYPAGE_BGCOLOR
  !define MUI_DIRECTORYPAGE_BGCOLOR "0A0C10"
!endif
!ifndef MUI_DIRECTORYPAGE_TEXTCOLOR
  !define MUI_DIRECTORYPAGE_TEXTCOLOR "E8E8EC"
!endif
!ifndef MUI_INSTFILESPAGE_COLORS
  !define MUI_INSTFILESPAGE_COLORS "D4A853 0A0C10"
!endif
!ifndef MUI_FINISHPAGE_LINK_COLOR
  !define MUI_FINISHPAGE_LINK_COLOR "D4A853"
!endif
!ifndef MUI_HEADERIMAGE
  !define MUI_HEADERIMAGE
!endif
!ifndef MUI_HEADERIMAGE_BITMAP_STRETCH
  !define MUI_HEADERIMAGE_BITMAP_STRETCH "FitControl"
!endif
!ifndef MUI_HEADERIMAGE_UNBITMAP_STRETCH
  !define MUI_HEADERIMAGE_UNBITMAP_STRETCH "FitControl"
!endif
!ifndef BUILD_UNINSTALLER
  !ifndef MUI_CUSTOMFUNCTION_GUIINIT
    !define MUI_CUSTOMFUNCTION_GUIINIT SusumusicGuiInit
  !endif
!endif

!include LogicLib.nsh
!include FileFunc.nsh
!include StdUtils.nsh
!include nsDialogs.nsh
!include WinMessages.nsh

!define SUSUMUSIC_INSTALL_MARKER ".susumusic-install-root"

!ifndef BUILD_UNINSTALLER
  Var SusumusicWelcomePage
  Var SusumusicHeroFont
  Var SusumusicTitleFont
  Var SusumusicBodyFont
  Var SusumusicSmallFont
  Var SusumusicDirectoryPage
  Var SusumusicDirectoryInput
!endif

!macro customInit
  !ifndef BUILD_UNINSTALLER
    Call SusumusicUsePreferredInstallDir
    Call SusumusicDisableUnsafeOldUninstallers
    ${If} ${Silent}
      Call SusumusicValidateInstallDir
    ${EndIf}
  !endif
!macroend

!macro customInstall
  FileOpen $0 "$INSTDIR\${SUSUMUSIC_INSTALL_MARKER}" w
  ${IfNot} ${Errors}
    FileWrite $0 "Susumusic install root$\r$\n"
    FileWrite $0 "appId=com.susumusic.desktop$\r$\n"
    FileClose $0
  ${EndIf}
!macroend

!macro customRemoveFiles
  Call un.SusumusicRemoveInstalledFiles
!macroend

!macro customWelcomePage
  Page custom SusumusicWelcomeShow
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customPageAfterChangeDir
  Page custom SusumusicDirectoryShow SusumusicDirectoryLeave
!macroend

!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function SusumusicFinishStartApp
      ${If} ${isUpdated}
        StrCpy $1 "--updated"
      ${Else}
        StrCpy $1 ""
      ${EndIf}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "SusumusicFinishStartApp"
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW SusumusicTintCommonControls
  !insertmacro MUI_PAGE_FINISH
!macroend

!ifndef BUILD_UNINSTALLER
Function SusumusicGuiInit
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4) i .r0'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 19, *i 1, i 4) i .r0'
  Call SusumusicTintCommonControls
FunctionEnd

Function SusumusicTintCommonControls
  SetCtlColors $HWNDPARENT "E8E8EC" "0A0C10"

  GetDlgItem $0 $HWNDPARENT 1
  ${If} $0 <> 0
    SetCtlColors $0 "E8E8EC" "0A0C10"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 2
  ${If} $0 <> 0
    SetCtlColors $0 "E8E8EC" "0A0C10"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 3
  ${If} $0 <> 0
    SetCtlColors $0 "E8E8EC" "0A0C10"
  ${EndIf}

  GetDlgItem $0 $HWNDPARENT 1028
  ${If} $0 <> 0
    SetCtlColors $0 "8B92A3" "0A0C10"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1256
  ${If} $0 <> 0
    SetCtlColors $0 "8B92A3" "0A0C10"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1034
  ${If} $0 <> 0
    SetCtlColors $0 "" "0A0C10"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1035
  ${If} $0 <> 0
    SetCtlColors $0 "" "0A0C10"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1037
  ${If} $0 <> 0
    SetCtlColors $0 "E8E8EC" "0A0C10"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1038
  ${If} $0 <> 0
    SetCtlColors $0 "8B92A3" "0A0C10"
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1039
  ${If} $0 <> 0
    SetCtlColors $0 "" "0A0C10"
  ${EndIf}

  FindWindow $0 "#32770" "" $HWNDPARENT
  ${If} $0 <> 0
    SetCtlColors $0 "E8E8EC" "0A0C10"

    GetDlgItem $1 $0 1000
    ${If} $1 <> 0
      SetCtlColors $1 "E8E8EC" "0A0C10"
    ${EndIf}
    GetDlgItem $1 $0 1001
    ${If} $1 <> 0
      SetCtlColors $1 "E8E8EC" "0A0C10"
    ${EndIf}
    GetDlgItem $1 $0 1004
    ${If} $1 <> 0
      SetCtlColors $1 "D4A853" "0A0C10"
    ${EndIf}
    GetDlgItem $1 $0 1006
    ${If} $1 <> 0
      SetCtlColors $1 "8B92A3" "0A0C10"
    ${EndIf}
    GetDlgItem $1 $0 1016
    ${If} $1 <> 0
      SetCtlColors $1 "8B92A3" "0A0C10"
    ${EndIf}
    GetDlgItem $1 $0 1019
    ${If} $1 <> 0
      SetCtlColors $1 "E8E8EC" "0A0C10"
    ${EndIf}
    GetDlgItem $1 $0 1020
    ${If} $1 <> 0
      SetCtlColors $1 "8B92A3" "0A0C10"
    ${EndIf}
    GetDlgItem $1 $0 1023
    ${If} $1 <> 0
      SetCtlColors $1 "8B92A3" "0A0C10"
    ${EndIf}
    GetDlgItem $1 $0 1024
    ${If} $1 <> 0
      SetCtlColors $1 "8B92A3" "0A0C10"
    ${EndIf}
    GetDlgItem $1 $0 1027
    ${If} $1 <> 0
      SetCtlColors $1 "E8E8EC" "0A0C10"
    ${EndIf}
    GetDlgItem $1 $0 1201
    ${If} $1 <> 0
      SetCtlColors $1 "E8E8EC" "0A0C10"
    ${EndIf}
    GetDlgItem $1 $0 1202
    ${If} $1 <> 0
      SetCtlColors $1 "8B92A3" "0A0C10"
    ${EndIf}
    GetDlgItem $1 $0 1203
    ${If} $1 <> 0
      SetCtlColors $1 "E8E8EC" "0A0C10"
    ${EndIf}
    GetDlgItem $1 $0 1204
    ${If} $1 <> 0
      SetCtlColors $1 "8B92A3" "0A0C10"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function SusumusicUsePreferredInstallDir
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/D=" $R1
  ${IfNot} ${Errors}
  ${AndIf} $R1 != ""
    StrCpy $INSTDIR "$R1"
  ${Else}
    Call SusumusicUseRegisteredInstallDir
    Pop $R2
    ${If} $R2 != "1"
      Call SusumusicUseFirstAvailableInstallDir
    ${EndIf}
  ${EndIf}
  Push "$INSTDIR"
  Call SusumusicNormalizeInstallDir
  Pop $INSTDIR
FunctionEnd

Function SusumusicUseFirstAvailableInstallDir
  IfFileExists "D:\*.*" driveD 0
  IfFileExists "E:\*.*" driveE 0
  IfFileExists "F:\*.*" driveF 0
  IfFileExists "G:\*.*" driveG 0
  IfFileExists "H:\*.*" driveH 0
  IfFileExists "I:\*.*" driveI 0
  IfFileExists "J:\*.*" driveJ 0
  IfFileExists "K:\*.*" driveK 0
  IfFileExists "L:\*.*" driveL 0
  IfFileExists "M:\*.*" driveM 0
  IfFileExists "N:\*.*" driveN 0
  IfFileExists "O:\*.*" driveO 0
  IfFileExists "P:\*.*" driveP 0
  IfFileExists "Q:\*.*" driveQ 0
  IfFileExists "R:\*.*" driveR 0
  IfFileExists "S:\*.*" driveS 0
  IfFileExists "T:\*.*" driveT 0
  IfFileExists "U:\*.*" driveU 0
  IfFileExists "V:\*.*" driveV 0
  IfFileExists "W:\*.*" driveW 0
  IfFileExists "X:\*.*" driveX 0
  IfFileExists "Y:\*.*" driveY 0
  IfFileExists "Z:\*.*" driveZ 0
  StrCpy $INSTDIR "C:\Susumusic"
  Return

  driveD:
    StrCpy $INSTDIR "D:\Susumusic"
    Return
  driveE:
    StrCpy $INSTDIR "E:\Susumusic"
    Return
  driveF:
    StrCpy $INSTDIR "F:\Susumusic"
    Return
  driveG:
    StrCpy $INSTDIR "G:\Susumusic"
    Return
  driveH:
    StrCpy $INSTDIR "H:\Susumusic"
    Return
  driveI:
    StrCpy $INSTDIR "I:\Susumusic"
    Return
  driveJ:
    StrCpy $INSTDIR "J:\Susumusic"
    Return
  driveK:
    StrCpy $INSTDIR "K:\Susumusic"
    Return
  driveL:
    StrCpy $INSTDIR "L:\Susumusic"
    Return
  driveM:
    StrCpy $INSTDIR "M:\Susumusic"
    Return
  driveN:
    StrCpy $INSTDIR "N:\Susumusic"
    Return
  driveO:
    StrCpy $INSTDIR "O:\Susumusic"
    Return
  driveP:
    StrCpy $INSTDIR "P:\Susumusic"
    Return
  driveQ:
    StrCpy $INSTDIR "Q:\Susumusic"
    Return
  driveR:
    StrCpy $INSTDIR "R:\Susumusic"
    Return
  driveS:
    StrCpy $INSTDIR "S:\Susumusic"
    Return
  driveT:
    StrCpy $INSTDIR "T:\Susumusic"
    Return
  driveU:
    StrCpy $INSTDIR "U:\Susumusic"
    Return
  driveV:
    StrCpy $INSTDIR "V:\Susumusic"
    Return
  driveW:
    StrCpy $INSTDIR "W:\Susumusic"
    Return
  driveX:
    StrCpy $INSTDIR "X:\Susumusic"
    Return
  driveY:
    StrCpy $INSTDIR "Y:\Susumusic"
    Return
  driveZ:
    StrCpy $INSTDIR "Z:\Susumusic"
    Return
FunctionEnd

Function SusumusicHasPreferredInstallDrive
  IfFileExists "D:\*.*" hasPreferred 0
  IfFileExists "E:\*.*" hasPreferred 0
  IfFileExists "F:\*.*" hasPreferred 0
  IfFileExists "G:\*.*" hasPreferred 0
  IfFileExists "H:\*.*" hasPreferred 0
  IfFileExists "I:\*.*" hasPreferred 0
  IfFileExists "J:\*.*" hasPreferred 0
  IfFileExists "K:\*.*" hasPreferred 0
  IfFileExists "L:\*.*" hasPreferred 0
  IfFileExists "M:\*.*" hasPreferred 0
  IfFileExists "N:\*.*" hasPreferred 0
  IfFileExists "O:\*.*" hasPreferred 0
  IfFileExists "P:\*.*" hasPreferred 0
  IfFileExists "Q:\*.*" hasPreferred 0
  IfFileExists "R:\*.*" hasPreferred 0
  IfFileExists "S:\*.*" hasPreferred 0
  IfFileExists "T:\*.*" hasPreferred 0
  IfFileExists "U:\*.*" hasPreferred 0
  IfFileExists "V:\*.*" hasPreferred 0
  IfFileExists "W:\*.*" hasPreferred 0
  IfFileExists "X:\*.*" hasPreferred 0
  IfFileExists "Y:\*.*" hasPreferred 0
  IfFileExists "Z:\*.*" hasPreferred 0
  Push "0"
  Return

  hasPreferred:
    Push "1"
    Return
FunctionEnd

Function SusumusicNormalizeInstallDir
  Exch $0
  Push "$0"
  Call SusumusicTrimInstallDir
  Pop $0
  StrLen $1 "$0"
  ${If} $1 == 2
    StrCpy $2 "$0" 1 1
    ${If} $2 == ":"
      StrCpy $0 "$0\Susumusic"
    ${EndIf}
  ${ElseIf} $1 == 3
    StrCpy $2 "$0" 1 1
    StrCpy $3 "$0" 1 2
    ${If} $2 == ":"
    ${AndIf} $3 == "\"
      StrCpy $0 "$0Susumusic"
    ${EndIf}
  ${EndIf}

  StrLen $1 "$0"
  StrCpy $2 "$0" 10 -10
  ${If} $1 < 10
  ${OrIf} $2 != "\Susumusic"
  ${AndIf} $2 != "\susumusic"
    StrCpy $0 "$0\Susumusic"
  ${EndIf}
  Exch $0
FunctionEnd

Function SusumusicTrimInstallDir
  Exch $0

  trim:
    StrLen $1 "$0"
    ${If} $1 > 3
      StrCpy $2 "$0" 1 -1
      ${If} $2 == "\"
        StrCpy $0 "$0" -1
        Goto trim
      ${EndIf}
    ${EndIf}

  Exch $0
FunctionEnd

Function SusumusicInstallDirLooksOwned
  Exch $0
  StrCpy $1 "0"

  IfFileExists "$0\${SUSUMUSIC_INSTALL_MARKER}" 0 +2
    StrCpy $1 "1"

  StrCpy $0 "$1"
  Exch $0
FunctionEnd

Function SusumusicExistingInstallPathCanBeAdopted
  Exch $0
  StrCpy $1 "0"

  ${If} $0 == ""
    Goto done
  ${EndIf}

  Push "$0"
  Call SusumusicTrimInstallDir
  Pop $2
  ${If} $2 == ""
    Goto done
  ${EndIf}

  Push "$2"
  Call SusumusicNormalizeInstallDir
  Pop $3
  ${If} $2 != $3
    Goto done
  ${EndIf}

  IfFileExists "$2\*.*" 0 done
  IfFileExists "$2\${SUSUMUSIC_INSTALL_MARKER}" adopt 0
  IfFileExists "$2\${PRODUCT_FILENAME}.exe" adopt 0
  IfFileExists "$2\resources\app.asar" adopt 0
  IfFileExists "$2\resources\app\package.json" adopt 0
  IfFileExists "$2\resources\app\server.js" adopt 0
  Goto done

  adopt:
    StrCpy $1 "1"

  done:
    StrCpy $0 "$1"
    Exch $0
FunctionEnd

Function SusumusicUseRegisteredInstallDir
  ReadRegStr $0 HKCU "Software\${APP_GUID}" InstallLocation
  Push "$0"
  Call SusumusicExistingInstallPathCanBeAdopted
  Pop $1
  ${If} $1 == "1"
    Push "$0"
    Call SusumusicNormalizeInstallDir
    Pop $INSTDIR
    Push "1"
    Return
  ${EndIf}

  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$0"
  Call SusumusicExistingInstallPathCanBeAdopted
  Pop $1
  ${If} $1 == "1"
    Push "$0"
    Call SusumusicNormalizeInstallDir
    Pop $INSTDIR
    Push "1"
    Return
  ${EndIf}

  ReadRegStr $0 HKLM "Software\${APP_GUID}" InstallLocation
  Push "$0"
  Call SusumusicExistingInstallPathCanBeAdopted
  Pop $1
  ${If} $1 == "1"
    Push "$0"
    Call SusumusicNormalizeInstallDir
    Pop $INSTDIR
    Push "1"
    Return
  ${EndIf}

  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$0"
  Call SusumusicExistingInstallPathCanBeAdopted
  Pop $1
  ${If} $1 == "1"
    Push "$0"
    Call SusumusicNormalizeInstallDir
    Pop $INSTDIR
    Push "1"
    Return
  ${EndIf}

  Push "0"
FunctionEnd

Function SusumusicRegisteredInstallDirCanBeAdopted
  Exch $0
  StrCpy $1 "0"

  ${If} $0 == ""
    Goto done
  ${EndIf}

  Push "$0"
  Call SusumusicNormalizeInstallDir
  Pop $2

  ReadRegStr $3 HKCU "Software\${APP_GUID}" InstallLocation
  Push "$3"
  Call SusumusicExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Push "$3"
    Call SusumusicNormalizeInstallDir
    Pop $5
    ${If} $5 == $2
      StrCpy $1 "1"
      Goto done
    ${EndIf}
  ${EndIf}

  ReadRegStr $3 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$3"
  Call SusumusicExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Push "$3"
    Call SusumusicNormalizeInstallDir
    Pop $5
    ${If} $5 == $2
      StrCpy $1 "1"
      Goto done
    ${EndIf}
  ${EndIf}

  ReadRegStr $3 HKLM "Software\${APP_GUID}" InstallLocation
  Push "$3"
  Call SusumusicExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Push "$3"
    Call SusumusicNormalizeInstallDir
    Pop $5
    ${If} $5 == $2
      StrCpy $1 "1"
      Goto done
    ${EndIf}
  ${EndIf}

  ReadRegStr $3 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$3"
  Call SusumusicExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Push "$3"
    Call SusumusicNormalizeInstallDir
    Pop $5
    ${If} $5 == $2
      StrCpy $1 "1"
      Goto done
    ${EndIf}
  ${EndIf}

  done:
    StrCpy $0 "$1"
    Exch $0
FunctionEnd

Function SusumusicInstallDirIsEmpty
  Exch $0
  FindFirst $1 $2 "$0\*.*"
  StrCpy $3 "1"

  loop:
    StrCmp $2 "" done
    StrCmp $2 "." next
    StrCmp $2 ".." next
    StrCpy $3 "0"
    Goto done

  next:
    FindNext $1 $2
    Goto loop

  done:
    FindClose $1
    StrCpy $0 "$3"
    Exch $0
FunctionEnd

Function SusumusicOldInstallPathNeedsQuarantine
  Exch $0
  StrCpy $1 "0"

  ${If} $0 == ""
    Goto done
  ${EndIf}

  Push "$0"
  Call SusumusicTrimInstallDir
  Pop $2
  Push "$2"
  Call SusumusicNormalizeInstallDir
  Pop $3

  ${If} $2 != $3
    StrCpy $1 "1"
    Goto done
  ${EndIf}

  IfFileExists "$2\${SUSUMUSIC_INSTALL_MARKER}" done 0
  Push "$2"
  Call SusumusicExistingInstallPathCanBeAdopted
  Pop $4
  ${If} $4 == "1"
    Goto done
  ${EndIf}

  StrCpy $1 "1"

  done:
    StrCpy $0 "$1"
    Exch $0
FunctionEnd

Function SusumusicDisableUnsafeOldUninstallers
  StrCpy $2 "0"

  ReadRegStr $0 HKCU "Software\${APP_GUID}" InstallLocation
  Push "$0"
  Call SusumusicDeleteLegacyUninstallerFileIfMissingMarker
  Push "$0"
  Call SusumusicOldInstallPathNeedsQuarantine
  Pop $1
  ${If} $1 == "1"
    DetailPrint "Skip unsafe legacy Susumusic uninstaller: $0"
    StrCpy $2 "1"
  ${EndIf}

  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$0"
  Call SusumusicDeleteLegacyUninstallerFileIfMissingMarker
  Push "$0"
  Call SusumusicOldInstallPathNeedsQuarantine
  Pop $1
  ${If} $1 == "1"
    DetailPrint "Skip unsafe legacy Susumusic uninstaller: $0"
    StrCpy $2 "1"
  ${EndIf}

  ${If} $2 == "1"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
    DeleteRegKey HKCU "Software\${APP_GUID}"
  ${EndIf}

  StrCpy $2 "0"

  ReadRegStr $0 HKLM "Software\${APP_GUID}" InstallLocation
  Push "$0"
  Call SusumusicDeleteLegacyUninstallerFileIfMissingMarker
  Push "$0"
  Call SusumusicOldInstallPathNeedsQuarantine
  Pop $1
  ${If} $1 == "1"
    DetailPrint "Skip unsafe legacy Susumusic uninstaller: $0"
    StrCpy $2 "1"
  ${EndIf}

  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" InstallLocation
  Push "$0"
  Call SusumusicDeleteLegacyUninstallerFileIfMissingMarker
  Push "$0"
  Call SusumusicOldInstallPathNeedsQuarantine
  Pop $1
  ${If} $1 == "1"
    DetailPrint "Skip unsafe legacy Susumusic uninstaller: $0"
    StrCpy $2 "1"
  ${EndIf}

  ${If} $2 == "1"
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}"
    DeleteRegKey HKLM "Software\${APP_GUID}"
  ${EndIf}
FunctionEnd

Function SusumusicDeleteLegacyUninstallerFileIfMissingMarker
  Pop $0
  ${If} $0 != ""
    Push "$0"
    Call SusumusicTrimInstallDir
    Pop $1
    ${If} $1 != ""
      IfFileExists "$1\${SUSUMUSIC_INSTALL_MARKER}" done 0
      DetailPrint "Remove legacy Susumusic uninstaller file: $1"
      Delete "$1\Uninstall ${PRODUCT_FILENAME}.exe"
    ${EndIf}
  ${EndIf}

  done:
FunctionEnd

Function SusumusicValidateInstallDir
  Push "$INSTDIR"
  Call SusumusicNormalizeInstallDir
  Pop $INSTDIR

  Push "$INSTDIR"
  Call SusumusicRegisteredInstallDirCanBeAdopted
  Pop $3

  Push "$INSTDIR"
  Call SusumusicExistingInstallPathCanBeAdopted
  Pop $4

  StrCpy $0 "$INSTDIR" 1 0
  StrCpy $1 "$INSTDIR" 1 1
  ${If} $1 == ":"
    ${If} $0 == "C"
    ${OrIf} $0 == "c"
      Call SusumusicHasPreferredInstallDrive
      Pop $2
      ${If} $2 == "1"
      ${AndIf} $3 != "1"
      ${AndIf} $4 != "1"
        MessageBox MB_ICONSTOP|MB_OK "检测到这台电脑还有 D-Z 盘，Susumusic 不安装到 C 盘。请改选 D 盘或其它非 C 盘的 Susumusic 文件夹。$\r$\n$\r$\n如果电脑只有 C 盘，安装器会自动放行 C:\Susumusic。"
        Abort
      ${EndIf}
    ${EndIf}
  ${EndIf}

  StrLen $0 "$INSTDIR"
  StrCpy $1 "$INSTDIR" 10 -10
  ${If} $0 < 10
  ${OrIf} $1 != "\Susumusic"
  ${AndIf} $1 != "\susumusic"
    MessageBox MB_ICONSTOP|MB_OK "安装目录必须是独立的 Susumusic 文件夹。请选择一个上级目录，安装器会自动创建 Susumusic 子文件夹。"
    Abort
  ${EndIf}

  IfFileExists "$INSTDIR\*.*" 0 valid

  Push "$INSTDIR"
  Call SusumusicInstallDirLooksOwned
  Pop $0
  ${If} $0 == "1"
    Goto valid
  ${EndIf}

  ${If} $3 == "1"
    Goto valid
  ${EndIf}

  ${If} $4 == "1"
    Goto valid
  ${EndIf}

  Push "$INSTDIR"
  Call SusumusicInstallDirIsEmpty
  Pop $0
  ${If} $0 == "1"
    Goto valid
  ${EndIf}

  MessageBox MB_ICONSTOP|MB_OK "为避免卸载时误删其它文件，Susumusic 不能安装到已有文件的非专属目录。请新建或选择一个空的 Susumusic 文件夹。$\r$\n$\r$\n当前路径：$INSTDIR"
  Abort

  valid:
FunctionEnd
Function SusumusicWelcomeShow
  Call SusumusicUsePreferredInstallDir

  nsDialogs::Create 1018
  Pop $SusumusicWelcomePage
  ${If} $SusumusicWelcomePage == error
    Abort
  ${EndIf}

  SetCtlColors $SusumusicWelcomePage "E8E8EC" "0A0C10"
  CreateFont $SusumusicHeroFont "Microsoft YaHei UI" 24 700
  CreateFont $SusumusicTitleFont "Microsoft YaHei UI" 11 700
  CreateFont $SusumusicBodyFont "Microsoft YaHei UI" 9 400
  CreateFont $SusumusicSmallFont "Microsoft YaHei UI" 8 400

  ${NSD_CreateLabel} 22u 18u 82u 10u "SUSUMUSIC"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SusumusicSmallFont 1
  SetCtlColors $0 "D4A853" "0A0C10"

  ${NSD_CreateLabel} 22u 36u 226u 30u "Susumusic 安装"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SusumusicHeroFont 1
  SetCtlColors $0 "E8E8EC" "0A0C10"

  ${NSD_CreateLabel} 22u 72u 36u 2u ""
  Pop $0
  SetCtlColors $0 "" "D4A853"

  ${NSD_CreateLabel} 22u 88u 238u 24u "沉浸式音乐播放器，融合天气电台、歌词舞台、粒子视觉和 3D 歌单架。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SusumusicBodyFont 1
  SetCtlColors $0 "8B92A3" "0A0C10"

  ${NSD_CreateLabel} 22u 118u 238u 12u "默认安装到 $INSTDIR"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SusumusicTitleFont 1
  SetCtlColors $0 "D4A853" "0A0C10"

  ${NSD_CreateLabel} 22u 140u 238u 12u "点击「下一步」选择安装位置，或直接使用默认路径。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SusumusicSmallFont 1
  SetCtlColors $0 "6B7280" "0A0C10"

  nsDialogs::Show
FunctionEnd

Function SusumusicDirectoryBrowse
  nsDialogs::SelectFolderDialog "选择 Susumusic 安装文件夹" "$INSTDIR"
  Pop $0
  ${If} $0 != error
  ${AndIf} $0 != ""
    Push "$0"
    Call SusumusicNormalizeInstallDir
    Pop $0
    StrCpy $INSTDIR "$0"
    SendMessage $SusumusicDirectoryInput ${WM_SETTEXT} 0 "STR:$INSTDIR"
  ${EndIf}
FunctionEnd

Function SusumusicDirectoryShow
  Call SusumusicUsePreferredInstallDir

  nsDialogs::Create 1018
  Pop $SusumusicDirectoryPage
  ${If} $SusumusicDirectoryPage == error
    Abort
  ${EndIf}

  SetCtlColors $SusumusicDirectoryPage "E8E8EC" "0A0C10"
  CreateFont $SusumusicTitleFont "Microsoft YaHei UI" 15 700
  CreateFont $SusumusicBodyFont "Microsoft YaHei UI" 9 400
  CreateFont $SusumusicSmallFont "Microsoft YaHei UI" 8 500

  ${NSD_CreateLabel} 22u 12u 238u 20u "选择安装位置"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SusumusicTitleFont 1
  SetCtlColors $0 "E8E8EC" "0A0C10"

  ${NSD_CreateLabel} 22u 40u 238u 24u "你可以使用默认路径，也可以选择其它磁盘或文件夹。安装器会自动创建缺失的目录。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SusumusicBodyFont 1
  SetCtlColors $0 "8B92A3" "0A0C10"

  ${NSD_CreateLabel} 22u 76u 238u 10u "安装目录"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SusumusicSmallFont 1
  SetCtlColors $0 "D4A853" "0A0C10"

  ${NSD_CreateText} 22u 94u 178u 15u "$INSTDIR"
  Pop $SusumusicDirectoryInput
  SendMessage $SusumusicDirectoryInput ${WM_SETFONT} $SusumusicBodyFont 1
  SetCtlColors $SusumusicDirectoryInput "E8E8EC" "1A1C22"

  ${NSD_CreateBrowseButton} 210u 93u 50u 17u "浏览..."
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SusumusicSmallFont 1
  ${NSD_OnClick} $0 SusumusicDirectoryBrowse

  ${NSD_CreateLabel} 22u 122u 238u 12u "默认推荐：D:\Susumusic；选盘符会自动建文件夹。"
  Pop $0
  SendMessage $0 ${WM_SETFONT} $SusumusicSmallFont 1
  SetCtlColors $0 "6B7280" "0A0C10"

  nsDialogs::Show
FunctionEnd

Function SusumusicDirectoryLeave
  ${NSD_GetText} $SusumusicDirectoryInput $0
  ${If} $0 == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "请选择安装文件夹。"
    Abort
  ${EndIf}
  Push "$0"
  Call SusumusicNormalizeInstallDir
  Pop $0
  StrCpy $INSTDIR "$0"
  SendMessage $SusumusicDirectoryInput ${WM_SETTEXT} 0 "STR:$INSTDIR"
  Call SusumusicValidateInstallDir
FunctionEnd
!endif

!ifdef BUILD_UNINSTALLER
!macro customUnInit
  Call un.SusumusicValidateUninstallDir
!macroend

Function un.SusumusicInstallDirLooksOwned
  Exch $0
  StrCpy $1 "0"

  IfFileExists "$0\${SUSUMUSIC_INSTALL_MARKER}" 0 +2
    StrCpy $1 "1"

  StrCpy $0 "$1"
  Exch $0
FunctionEnd

Function un.SusumusicNormalizeInstallDir
  Exch $0
  Push "$0"
  Call un.SusumusicTrimInstallDir
  Pop $0
  StrLen $1 "$0"
  ${If} $1 == 2
    StrCpy $2 "$0" 1 1
    ${If} $2 == ":"
      StrCpy $0 "$0\Susumusic"
    ${EndIf}
  ${ElseIf} $1 == 3
    StrCpy $2 "$0" 1 1
    StrCpy $3 "$0" 1 2
    ${If} $2 == ":"
    ${AndIf} $3 == "\"
      StrCpy $0 "$0Susumusic"
    ${EndIf}
  ${EndIf}

  StrLen $1 "$0"
  StrCpy $2 "$0" 10 -10
  ${If} $1 < 10
  ${OrIf} $2 != "\Susumusic"
  ${AndIf} $2 != "\susumusic"
    StrCpy $0 "$0\Susumusic"
  ${EndIf}
  Exch $0
FunctionEnd

Function un.SusumusicTrimInstallDir
  Exch $0

  trim:
    StrLen $1 "$0"
    ${If} $1 > 3
      StrCpy $2 "$0" 1 -1
      ${If} $2 == "\"
        StrCpy $0 "$0" -1
        Goto trim
      ${EndIf}
    ${EndIf}

  Exch $0
FunctionEnd

Function un.SusumusicValidateUninstallDir
  Push "$INSTDIR"
  Call un.SusumusicTrimInstallDir
  Pop $0
  Push "$0"
  Call un.SusumusicNormalizeInstallDir
  Pop $1
  ${If} $0 != $1
    MessageBox MB_OK|MB_ICONSTOP "当前卸载路径不是 Susumusic 专属目录，已阻止卸载以避免误删其它文件。$\r$\n$\r$\n当前路径：$INSTDIR$\r$\n安全路径应为：$0"
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $INSTDIR "$0"

  Push "$INSTDIR"
  Call un.SusumusicInstallDirLooksOwned
  Pop $0
  ${If} $0 != "1"
    MessageBox MB_OK|MB_ICONSTOP "无法确认当前目录属于 Susumusic，已阻止卸载以避免误删其它文件。$\r$\n$\r$\n当前路径：$INSTDIR"
    SetErrorLevel 2
    Quit
  ${EndIf}
FunctionEnd

Function un.SusumusicRemoveInstalledFiles
  SetOutPath $TEMP

  Delete "$INSTDIR\${PRODUCT_FILENAME}.exe"
  Delete "$INSTDIR\Uninstall ${PRODUCT_FILENAME}.exe"
  Delete "$INSTDIR\uninstallerIcon.ico"

  Delete "$INSTDIR\chrome_100_percent.pak"
  Delete "$INSTDIR\chrome_200_percent.pak"
  Delete "$INSTDIR\d3dcompiler_47.dll"
  Delete "$INSTDIR\dxcompiler.dll"
  Delete "$INSTDIR\dxil.dll"
  Delete "$INSTDIR\ffmpeg.dll"
  Delete "$INSTDIR\icudtl.dat"
  Delete "$INSTDIR\libEGL.dll"
  Delete "$INSTDIR\libGLESv2.dll"
  Delete "$INSTDIR\LICENSE.electron.txt"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\resources.pak"
  Delete "$INSTDIR\snapshot_blob.bin"
  Delete "$INSTDIR\v8_context_snapshot.bin"
  Delete "$INSTDIR\vk_swiftshader.dll"
  Delete "$INSTDIR\vk_swiftshader_icd.json"
  Delete "$INSTDIR\vulkan-1.dll"

  RMDir "$INSTDIR\locales"
  RMDir "$INSTDIR\resources"
  RMDir "$INSTDIR\swiftshader"

  RMDir "$INSTDIR"
FunctionEnd
!endif
