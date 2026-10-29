; Windows integration for Work: Write, Plot and Present show up as three
; apps (Start menu and desktop shortcuts with their own icons and taskbar
; identity), files get "Open in Write/Plot/Present" on right-click and in
; Open with, and right-click > New can make Write, Plot and Present files.
; Included by electron-builder's NSIS script (nsis.include in package.json).

!define WORK_EXE "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
!define WORK_ICONS "$INSTDIR\resources\icons"

; ProgID per app and extension, e.g. ReaOffice.Write.docx
!macro workType EXT APP NAME ICON TYPENAME
  WriteRegStr SHCTX "Software\Classes\ReaOffice.${APP}.${EXT}" "" "${TYPENAME}"
  WriteRegStr SHCTX "Software\Classes\ReaOffice.${APP}.${EXT}" "FriendlyTypeName" "${TYPENAME}"
  WriteRegStr SHCTX "Software\Classes\ReaOffice.${APP}.${EXT}\DefaultIcon" "" "${WORK_ICONS}\${ICON}.ico,0"
  WriteRegStr SHCTX "Software\Classes\ReaOffice.${APP}.${EXT}\Application" "ApplicationName" "${NAME}"
  WriteRegStr SHCTX "Software\Classes\ReaOffice.${APP}.${EXT}\Application" "ApplicationIcon" "${WORK_ICONS}\${ICON}.ico,0"
  WriteRegStr SHCTX "Software\Classes\ReaOffice.${APP}.${EXT}\shell\open" "FriendlyAppName" "${NAME}"
  WriteRegStr SHCTX "Software\Classes\ReaOffice.${APP}.${EXT}\shell\open\command" "" '"${WORK_EXE}" "%1"'
  ; Open with list
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "ReaOffice.${APP}.${EXT}" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".${EXT}" ""
  ; Right-click > Open in Write / Plot / Present (Windows 11 shows it under Show more options)
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\ReaOffice.${APP}" "" "Open in ${NAME}"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\ReaOffice.${APP}" "Icon" "${WORK_ICONS}\${ICON}.ico"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\ReaOffice.${APP}\command" "" '"${WORK_EXE}" "%1"'
  ; Default apps settings page
  WriteRegStr SHCTX "Software\ReaOffice\Capabilities\FileAssociations" ".${EXT}" "ReaOffice.${APP}.${EXT}"
  ; Become the default only where no other app is
  ReadRegStr $0 SHCTX "Software\Classes\.${EXT}" ""
  StrCmp $0 "" 0 +2
    WriteRegStr SHCTX "Software\Classes\.${EXT}" "" "ReaOffice.${APP}.${EXT}"
!macroend

!macro workUntype EXT APP
  DeleteRegKey SHCTX "Software\Classes\ReaOffice.${APP}.${EXT}"
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "ReaOffice.${APP}.${EXT}"
  DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\ReaOffice.${APP}"
  DeleteRegKey SHCTX "Software\Classes\.${EXT}\ReaOffice.${APP}.${EXT}"
  ReadRegStr $0 SHCTX "Software\Classes\.${EXT}" ""
  StrCmp $0 "ReaOffice.${APP}.${EXT}" 0 +2
    DeleteRegValue SHCTX "Software\Classes\.${EXT}" ""
!macroend

; Right-click > New. Work opens an empty file as a blank document.
!macro workNew EXT APP
  WriteRegStr SHCTX "Software\Classes\.${EXT}\ReaOffice.${APP}.${EXT}\ShellNew" "NullFile" ""
!macroend

!macro workShortcut NAME APP ICON
  CreateShortCut "$SMPROGRAMS\${NAME}.lnk" "${WORK_EXE}" "--rea-new=${APP}" "${WORK_ICONS}\${ICON}.ico" 0
  WinShell::SetLnkAUMI "$SMPROGRAMS\${NAME}.lnk" "${APP_ID}.${APP}"
  CreateShortCut "$DESKTOP\${NAME}.lnk" "${WORK_EXE}" "--rea-new=${APP}" "${WORK_ICONS}\${ICON}.ico" 0
  WinShell::SetLnkAUMI "$DESKTOP\${NAME}.lnk" "${APP_ID}.${APP}"
!macroend

; Close every running copy of Work (and of older Rea Office builds) before
; installing or uninstalling, so no file stays locked. Runs in place of
; electron-builder's own check, which can miss copies started from another folder.
!macro workIsRunning EXE
  nsExec::Exec 'cmd /c tasklist /NH /FI "IMAGENAME eq ${EXE}" | find /I "${EXE}"'
!macroend

!macro workKill EXE
  nsExec::Exec 'taskkill /T /IM "${EXE}"'
  Pop $0
  Sleep 1500
  nsExec::Exec 'taskkill /F /T /IM "${EXE}"'
  Pop $0
!macroend

!macro customCheckAppRunning
  !insertmacro workIsRunning "${APP_EXECUTABLE_FILENAME}"
  Pop $R0
  !insertmacro workIsRunning "Rea Office.exe"
  Pop $R1
  ${if} $R0 == 0
  ${orIf} $R1 == 0
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Work is still running. Save your files, then choose OK to close Write, Plot and Present and continue." /SD IDOK IDOK +2
    Quit
    !insertmacro workKill "${APP_EXECUTABLE_FILENAME}"
    !insertmacro workKill "Rea Office.exe"
    Sleep 1000
  ${endif}
!macroend

; An old copy that won't uninstall cleanly shouldn't block the new one;
; the new files go over it.
!macro customUnInstallCheck
  ${if} $R0 != 0
    DetailPrint "The previous version didn't uninstall cleanly (code $R0). Installing over it."
  ${endif}
  ClearErrors
!macroend

!macro customInstall
  ; Leftovers from builds named Rea Office
  ${if} "$INSTDIR" != "$LOCALAPPDATA\Programs\Rea Office"
    RMDir /r "$LOCALAPPDATA\Programs\Rea Office"
  ${endif}
  Delete "$SMPROGRAMS\Rea Office.lnk"
  Delete "$DESKTOP\Rea Office.lnk"

  !insertmacro workShortcut "Write" "docs" "write"
  !insertmacro workShortcut "Plot" "sheets" "plot"
  !insertmacro workShortcut "Present" "slides" "present"

  !insertmacro workType "docx" "Write" "Write" "write" "Write document"
  !insertmacro workType "odt" "Write" "Write" "write" "OpenDocument text"
  !insertmacro workType "txt" "Write" "Write" "write" "Text document"
  !insertmacro workType "md" "Write" "Write" "write" "Markdown document"
  !insertmacro workType "xlsx" "Plot" "Plot" "plot" "Plot workbook"
  !insertmacro workType "xlsm" "Plot" "Plot" "plot" "Macro-enabled workbook"
  !insertmacro workType "xltx" "Plot" "Plot" "plot" "Workbook template"
  !insertmacro workType "xls" "Plot" "Plot" "plot" "Workbook (old format)"
  !insertmacro workType "ods" "Plot" "Plot" "plot" "OpenDocument spreadsheet"
  !insertmacro workType "csv" "Plot" "Plot" "plot" "CSV file"
  !insertmacro workType "reaslides" "Present" "Present" "present" "Present presentation"
  !insertmacro workType "pptx" "Present" "Present" "present" "Presentation"
  !insertmacro workType "odp" "Present" "Present" "present" "OpenDocument presentation"
  ; .reaslides is Work's own format
  WriteRegStr SHCTX "Software\Classes\.reaslides" "" "ReaOffice.Present.reaslides"

  !insertmacro workNew "docx" "Write"
  !insertmacro workNew "xlsx" "Plot"
  !insertmacro workNew "reaslides" "Present"

  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "Work"
  WriteRegStr SHCTX "Software\ReaOffice\Capabilities" "ApplicationName" "Work"
  WriteRegStr SHCTX "Software\ReaOffice\Capabilities" "ApplicationDescription" "Write, Plot and Present, with AI built in."
  WriteRegStr SHCTX "Software\RegisteredApplications" "ReaOffice.Work" "Software\ReaOffice\Capabilities"
  ; Tell Explorer the associations changed
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Write.lnk"
  Delete "$SMPROGRAMS\Plot.lnk"
  Delete "$SMPROGRAMS\Present.lnk"
  Delete "$DESKTOP\Write.lnk"
  Delete "$DESKTOP\Plot.lnk"
  Delete "$DESKTOP\Present.lnk"

  !insertmacro workUntype "docx" "Write"
  !insertmacro workUntype "odt" "Write"
  !insertmacro workUntype "txt" "Write"
  !insertmacro workUntype "md" "Write"
  !insertmacro workUntype "xlsx" "Plot"
  !insertmacro workUntype "xlsm" "Plot"
  !insertmacro workUntype "xltx" "Plot"
  !insertmacro workUntype "xls" "Plot"
  !insertmacro workUntype "ods" "Plot"
  !insertmacro workUntype "csv" "Plot"
  !insertmacro workUntype "reaslides" "Present"
  !insertmacro workUntype "pptx" "Present"
  !insertmacro workUntype "odp" "Present"

  DeleteRegKey SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegKey SHCTX "Software\ReaOffice"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "ReaOffice.Work"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
