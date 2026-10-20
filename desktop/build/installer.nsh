; Close any copy of GLB&ME that is still running (including the first build's "GLB&ME.exe",
; which could get stuck invisibly in the background) before installing.
!macro customInit
  nsExec::Exec 'taskkill /F /T /IM "GLB&ME.exe"'
  nsExec::Exec 'taskkill /F /T /IM "GLB-ME.exe"'
!macroend
