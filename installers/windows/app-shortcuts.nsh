; Made by tools/app-shortcut-icons.py: do not change by hand, run the script again.
; A shortcut in the Start menu for each app, in the folder "Syntelab Creative": it opens Syntelab Creative right in that app
; (--app <app id>). The names of versions up to 1.0.0 ("Syntelab <app>", outside the folder) are taken away.

!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$SMPROGRAMS\Syntelab Creative"
  Delete "$SMPROGRAMS\Syntelab Dev.lnk"
  CreateShortCut "$SMPROGRAMS\Syntelab Creative\Dev.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--app dev" "$INSTDIR\icons\apps\dev.ico" 0 SW_SHOWNORMAL "" "Tools for developers. Part of Syntelab Creative."
  Delete "$SMPROGRAMS\Syntelab PDF Organizer.lnk"
  CreateShortCut "$SMPROGRAMS\Syntelab Creative\PDF Organizer.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--app pdf-organizer" "$INSTDIR\icons\apps\pdf-organizer.ico" 0 SW_SHOWNORMAL "" "View, organize, edit and sign PDFs. Part of Syntelab Creative."
  Delete "$SMPROGRAMS\Syntelab Scribe.lnk"
  CreateShortCut "$SMPROGRAMS\Syntelab Creative\Scribe.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--app scribe" "$INSTDIR\icons\apps\scribe.ico" 0 SW_SHOWNORMAL "" "A text editor with tools: clean, sort, compare and transform text. Part of Syntelab Creative."
  Delete "$SMPROGRAMS\Syntelab Units.lnk"
  CreateShortCut "$SMPROGRAMS\Syntelab Creative\Units.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--app units" "$INSTDIR\icons\apps\units.ico" 0 SW_SHOWNORMAL "" "Unit converters: length, temperature, currency and many more. Part of Syntelab Creative."
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --tag-shortcuts'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$SMPROGRAMS\Syntelab Creative\Dev.lnk"
  Delete "$SMPROGRAMS\Syntelab Dev.lnk"
  Delete "$SMPROGRAMS\Syntelab Creative\PDF Organizer.lnk"
  Delete "$SMPROGRAMS\Syntelab PDF Organizer.lnk"
  Delete "$SMPROGRAMS\Syntelab Creative\Scribe.lnk"
  Delete "$SMPROGRAMS\Syntelab Scribe.lnk"
  Delete "$SMPROGRAMS\Syntelab Creative\Units.lnk"
  Delete "$SMPROGRAMS\Syntelab Units.lnk"
  RMDir "$SMPROGRAMS\Syntelab Creative"
  DeleteRegValue HKCU "Software\RegisteredApplications" "SyntelabCreative"
  DeleteRegKey HKCU "Software\SyntelabCreative"
  DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "SyntelabCreative.pdf"
  DeleteRegKey HKCU "Software\Classes\SyntelabCreative.pdf"
!macroend
