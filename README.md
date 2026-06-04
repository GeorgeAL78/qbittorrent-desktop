# qBittorrent Desktop

A Windows 11 desktop client for qBittorrent running on a remote machine or Docker container. Wraps the qBittorrent Web UI in a native Electron app with added desktop integrations.

## Features

- **Full qBittorrent Web UI** — 100% feature parity, running inside a native window
- **System tray** — minimize to tray, optional start minimized
- **Clipboard monitor** — automatically detects magnet links copied to clipboard and offers to add them
- **Completion notifications** — desktop popup when a torrent finishes downloading
- **Double-click to open** — double-click any torrent or file in the Contents tab to open it in Explorer
- **Path mapping** — maps remote server paths to local mounted paths (e.g. `/downloads` → `Z:\qbittorrent`)
- **.torrent file association** — open .torrent files directly with the app

## Screenshots

| Main Window | Settings | Tray Menu |
|---|---|---|
| ![Main Window](assets/screenshots/main-window.png) | ![Settings](assets/screenshots/settings.png) | ![Tray Menu](assets/screenshots/tray-menu.png) |

## Related

This app is designed to work alongside **[pia-qbittorrent-docker](https://github.com/GeorgeAL78/pia-qbittorrent-docker)** — a Docker setup that runs qBittorrent behind a PIA VPN. If you're using that stack, point the Web UI URL in Settings to your Docker host and port.

## Requirements

- qBittorrent running with Web UI enabled (local or remote/Docker)

> **To build from source** (optional): [Node.js](https://nodejs.org/) v18+ is required. The pre-built `.exe` files in Releases are fully self-contained — no Node.js needed to run them.

## Setup

```bash
git clone https://github.com/GeorgeAL78/qbittorrent-desktop.git
cd qbittorrent-desktop
npm install
npm start
```

On first launch, a Settings window will open. Enter your qBittorrent Web UI URL (e.g. `http://192.168.1.169:8888`), credentials if required, and configure the path mapping.

## Build

Produces an NSIS installer and a portable `.exe` in `dist/`:

```bash
npm run build
```

## Settings

| Setting | Description |
|---|---|
| Web UI URL | Full URL to your qBittorrent Web UI including port |
| Username / Password | Leave blank if authentication is disabled |
| Start minimized | Launch directly to the system tray |
| Minimize to tray on close | Keep running in background when window is closed |
| Clipboard monitor | Watch clipboard for magnet links |
| Remote download path | The save path as qBittorrent sees it (e.g. `/downloads`) |
| Local path | Where that path is mounted on this PC (e.g. `Z:\qbittorrent`) |

## Changelog

### v1.0.8
- Updated screenshots in README with faithful qBittorrent UI mockup

### v1.0.7
- Added main window and tray right-click menu screenshots to README

### v1.0.6
- Added settings screenshot to README

### v1.0.5
- Version number now shown in tray right-click menu
- Version number now shown at the bottom of the Settings window

### v1.0.4
- Settings window now opens automatically on first launch when no URL is configured
- Fixed crash when URL is empty (clipboard monitor, completion checker)
- "Start minimized" is now greyed out when "Run at Windows startup" is enabled

### v1.0.3
- Removed hardcoded personal IP from default config

### v1.0.2
- Added **Run at Windows startup** option — launches minimized to tray on login

### v1.0.1
- Fixed notification header showing `electron.app.qBittorrent Desktop`

### v1.0.0
- Initial release

## License

MIT
