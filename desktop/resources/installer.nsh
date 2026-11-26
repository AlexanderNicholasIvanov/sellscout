; Always install for the current user: skips the "Anyone who uses this computer / Only for me"
; page (per-machine needs admin rights, which this installer never asks for).
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
