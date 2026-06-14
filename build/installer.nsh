; Custom NSIS install logic for qBittorrent Desktop.
; Registers the app's Capabilities so it appears in the Windows
; "Default apps -> Choose defaults by link type -> magnet" picker.
; electron-builder's built-in "protocols" only writes the bare
; Classes\magnet handler, which is NOT enough for Chromium browsers
; (Edge/Chrome) that resolve protocols via the modern association API.

!macro customInstall
  ; ProgId for our magnet handler
  WriteRegStr HKLM "Software\Classes\qBittorrentDesktop.Magnet" "" "qBittorrent Desktop Magnet Link"
  WriteRegStr HKLM "Software\Classes\qBittorrentDesktop.Magnet" "URL Protocol" ""
  WriteRegStr HKLM "Software\Classes\qBittorrentDesktop.Magnet\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKLM "Software\Classes\qBittorrentDesktop.Magnet\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; Capabilities declaring the magnet URL association
  WriteRegStr HKLM "Software\qBittorrent Desktop\Capabilities" "ApplicationName" "qBittorrent Desktop"
  WriteRegStr HKLM "Software\qBittorrent Desktop\Capabilities" "ApplicationDescription" "Desktop client for qBittorrent with magnet link support"
  WriteRegStr HKLM "Software\qBittorrent Desktop\Capabilities\URLAssociations" "magnet" "qBittorrentDesktop.Magnet"

  ; Register the application so Windows lists it in the defaults picker
  WriteRegStr HKLM "Software\RegisteredApplications" "qBittorrent Desktop" "Software\qBittorrent Desktop\Capabilities"
!macroend

!macro customUnInstall
  DeleteRegKey HKLM "Software\Classes\qBittorrentDesktop.Magnet"
  DeleteRegKey HKLM "Software\qBittorrent Desktop"
  DeleteRegValue HKLM "Software\RegisteredApplications" "qBittorrent Desktop"
!macroend
