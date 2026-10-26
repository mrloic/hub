!include "nsDialogs.nsh"
Var DesktopShortcutCheckbox
Var HubDesktopShortcut
!macro customPageAfterChangeDir
  Page custom HubShortcutPage HubShortcutLeave
!macroend
Function HubShortcutPage
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateCheckbox} 0 10u 100% 20u "Создать ярлык Hub на рабочем столе"
  Pop $DesktopShortcutCheckbox
  nsDialogs::Show
FunctionEnd
Function HubShortcutLeave
  ${NSD_GetState} $DesktopShortcutCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $HubDesktopShortcut "true"
  ${Else}
    StrCpy $HubDesktopShortcut "false"
  ${EndIf}
FunctionEnd

!macro customInstall
  ${If} $HubDesktopShortcut == "true"
    CreateShortCut "$DESKTOP\Hub.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${EndIf}
!macroend
!macro customUnInstall
  Delete "$DESKTOP\Hub.lnk"
!macroend
