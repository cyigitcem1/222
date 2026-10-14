; Keep the standard builder uninstall and update rollback behavior. Use the
; Unicode extended path for local installation directories so deeply nested
; bundled dependency files can also be removed without Windows policy changes.
!macro customUnInstall
  Push $R0
  StrCpy $R0 "$INSTDIR" 2 1
  ${If} $R0 == ":\"
    StrCpy $INSTDIR "\\?\$INSTDIR"
  ${EndIf}
  Pop $R0
!macroend
