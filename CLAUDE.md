# qbittorrent-desktop — project notes

Electron desktop wrapper for qBittorrent's Web UI, for Windows 11.
Repo: `GeorgeAL78/qbittorrent-desktop`. Published to GitHub Releases +
GitHub Packages npm registry `@georgeal78/qbittorrent-desktop`.
Sole maintainer: the user.

## Standing rules (do not relitigate)

- **Do not bump the version for cosmetic-only changes** (README/screenshot edits).
- **Always update the README changelog** on every version bump.
- **Never commit `.npmrc`** or any personal IP/credentials.
- **Always stage `package-lock.json` alongside `package.json`** in version-bump commits.
- Release assets must be labeled **"(Installer)" / "(Portable)"** on the GitHub Releases page.
- **No alpha/pre-release dependencies** in the app, ever — even if they'd fix a deprecation
  warning (decided explicitly re: electron-builder 27 / electron-updater 7 alphas).

## Release pipeline (CI-based, tag-triggered)

```
npm version patch --no-git-tag-version
git add package.json package-lock.json README.md
git commit -m "..."
git tag vX.Y.Z
git push && git push origin vX.Y.Z
```
`.github/workflows/release.yml` then: builds via electron-builder (NSIS installer +
portable target), pre-creates the GitHub release (avoids electron-builder's parallel-
upload create-race), publishes assets + `latest.yml`, labels assets, publishes to
GitHub Packages (best-effort, `continue-on-error`).

`scripts/version` npm lifecycle hook auto-regenerates the Components table in
README.md from live `process.versions` + lockfile — runs automatically on
`npm version`.

## Known limitations / gotchas

- **Portable build cannot self-update.** `app.isPackaged` is true for portable too, so
  `setupAutoUpdater()` still runs, but electron-updater's Windows `NsisUpdater` assumes
  an NSIS-installed app (install dir, uninstaller) it can hand control to — none of
  that exists for a single portable exe. Checks fail silently (wrapped in
  `.catch(() => {})` / swallowed `'error'` event) rather than erroring visibly. Portable
  users are expected to re-download manually. UI still shows "Check for Updates" for
  portable — not yet gated out (a possible future improvement, not yet requested).
- **Magnet-link Windows registration requires HKLM**, not HKCU — done via
  `build/installer.nsh` (`Capabilities`/`RegisteredApplications`) + `nsis.perMachine: true`.
  HKCU-only registration does not appear in Windows' default-apps picker.
- **Never let `Notification` fire in dev mode** — Electron auto-creates a Start Menu
  shortcut (AUMID-tagged) pointing at the bare dev `electron.exe` the first time a
  notification fires un-packaged. That shortcut then hijacks toast-click activation
  for the real installed app (same AUMID). All `Notification` calls are gated on
  `app.isPackaged` (see `canNotify()` in main.js) — do not remove this gate.
- **NSIS config must stay `oneClick: true`.** `oneClick: true` is incompatible with
  `allowToChangeInstallationDirectory` and a NSIS `license` page — don't add those back
  without re-testing the update flow end-to-end.
- **The "click does nothing, works on retry" update reports were never actually a
  reliability bug.** Originally (v1.0.28) misdiagnosed as `oneClick:false` + silent
  install being unreliable, and switched to `oneClick: true` — that didn't fully
  explain later recurrences on v1.0.30→31→32. Added `update.log` diagnostics (v1.0.33,
  written to `app.getPath('userData')`) and confirmed every click was actually landing
  fine on the first try — the real complaint was just too many total clicks (the old
  design needed 4: check → confirm download → notice → confirm restart). Fixed properly
  in v1.0.35 by collapsing to one confirmation ("Download && Install"); the restart/
  install now proceeds automatically once downloaded, no second prompt. Lesson: don't
  assume a flow-friction report is a reliability bug — ask directly before building
  diagnostic tooling around it (see memory `[[feedback-clarify-bug-vs-ux-before-diagnosing]]`).
  `update.log` is still there and worth checking first if this ever resurfaces for real
  — I have direct filesystem access to the user's machine and can read it myself
  (`%APPDATA%\@georgeal78\qbittorrent-desktop\update.log`), no need to ask the user to
  relay it.
- **`js-yaml` is pinned via `overrides` to `^4.3.0`** — electron-updater/builder require
  `^4`; don't let a bump go to 5.x without checking compatibility first.
- Deprecated transitive deps (`glob@7`, `rimraf@2`, `boolean@3`, `inflight`,
  `lodash.isequal`) come from electron-builder's `@electron/asar`/`@electron/get` and
  from electron-updater directly. Fixed only in alpha releases (electron-builder
  27.0.0-alpha.x, electron-updater 7.0.0-alpha.x) — do not adopt per the "no alphas" rule.
  Audit is otherwise clean (0 vulnerabilities as of the last check).

## Auto-update behavior (for reference)

`setupAutoUpdater()` in main.js: checks once on `app.whenReady()`, then every 6 hours
via `setInterval`, gated on `config.autoUpdate !== false` ("Automatically check for
updates" in Settings — controls checking only). Manual check always available via
tray menu and the injected qBittorrent "Desktop" menu. Both are no-ops in dev
(`!app.isPackaged` guard).

Download/install never happens without asking, but it's a **single** confirmation:
`update-available` → `promptDownloadUpdate()` shows one dialog ("Download && Install" /
"Not Now"). Saying yes downloads, and `update-downloaded` goes straight to
`restartAndInstall()` — no second dialog. Declining is remembered per-version
(`config.dismissedUpdateVersion`) so it won't re-nag for the same version except on an
explicit manual check (`manualUpdateCheck` flag bypasses the dismissal).

## Cross-repo coordination

The Docker sibling repo **pia-qbittorrent-docker** supplies the `X-Docker-Version`
custom HTTP header (via `WebUI\CustomHTTPHeaders`) that this app reads in
`preload-main.js` (`reportDockerVersion()`) and shows in the window title bar. That
repo is maintained in a separate Claude Code session — coordinate before changing the
header name/format on either side.
