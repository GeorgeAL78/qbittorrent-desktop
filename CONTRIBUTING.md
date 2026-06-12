# Contributing

Thanks for your interest in contributing to qBittorrent Desktop!

## Running locally

```bash
git clone https://github.com/GeorgeAL78/qbittorrent-desktop.git
cd qbittorrent-desktop
npm install
npm start
```

On first launch, open Settings and enter your qBittorrent Web UI URL.

## Building the installer

```bash
npm run build
```

Produces an NSIS installer and portable `.exe` in `dist/`.

## Project structure

| File | Description |
|---|---|
| `main.js` | Electron main process — window management, tray, IPC, qBt API calls |
| `preload-main.js` | Preload for main window — intercepts dblclick, exposes `window.qbDesktop` |
| `preload.js` | Preload for settings window — exposes API via contextBridge |
| `preload-popup.js` | Preload for magnet popup window |
| `settings.html` | Settings UI |
| `magnet-popup.html` | Magnet link popup UI |
| `error.html` | Shown when qBittorrent Web UI is unreachable |

## Submitting changes

1. Fork the repo
2. Create a branch (`git checkout -b my-feature`)
3. Make your changes
4. Test with `npm start`
5. Open a pull request

Please keep PRs focused — one feature or fix per PR.
