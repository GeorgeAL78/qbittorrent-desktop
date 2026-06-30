const {
  app, BrowserWindow, Tray, Menu, shell, ipcMain,
  Notification, clipboard, nativeImage, dialog, screen,
} = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

app.setAppUserModelId('qBittorrent Desktop');
app.commandLine.appendSwitch('ignore-certificate-errors');

// ── Single-instance lock (required for second-instance + file-association) ──
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// ── Config ──────────────────────────────────────────────────────────────────
const configPath = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {}
  return {
    qbUrl: '',
    username: '',
    password: '',
    startMinimized: false,
    minimizeToTray: true,
    runAtStartup: false,
    clipboardMonitor: true,
    registerMagnetHandler: true,
    remoteDownloadPath: '/downloads',
    localDownloadPath: 'Z:\\qbittorrent',
    windowBounds: { width: 1280, height: 800 },
  };
}

function saveConfig(cfg) {
  try { fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2)); } catch (e) {}
}

let config = loadConfig();

// ── qBittorrent Web API ──────────────────────────────────────────────────────
let qbtCookie = null;

function qbtBaseUrl() {
  if (!config.qbUrl) return null;
  return new URL(config.qbUrl.replace(/\/$/, ''));
}

function qbtGet(apiPath) {
  const base = qbtBaseUrl();
  if (!base) return Promise.resolve(null);
  const mod = base.protocol === 'https:' ? https : http;
  const headers = {
    'Referer': config.qbUrl,
    ...(qbtCookie ? { Cookie: qbtCookie } : {}),
  };
  return new Promise((resolve, reject) => {
    const req = mod.request(
      { hostname: base.hostname, port: parseInt(base.port) || (base.protocol === 'https:' ? 443 : 80), path: apiPath, method: 'GET', headers },
      (res) => {
        const sc = res.headers['set-cookie'];
        if (sc) qbtCookie = sc.map(c => c.split(';')[0]).join('; ');
        let data = '';
        res.on('data', d => (data += d));
        res.on('end', () => resolve({ status: res.statusCode, body: data.trim() }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function qbtPost(apiPath, fields) {
  const base = qbtBaseUrl();
  if (!base) return Promise.resolve(null);
  const mod = base.protocol === 'https:' ? https : http;
  const body = new URLSearchParams(fields).toString();
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(body),
    'Referer': config.qbUrl,
    ...(qbtCookie ? { Cookie: qbtCookie } : {}),
  };
  return new Promise((resolve, reject) => {
    const req = mod.request(
      { hostname: base.hostname, port: parseInt(base.port) || (base.protocol === 'https:' ? 443 : 80), path: apiPath, method: 'POST', headers },
      (res) => {
        const sc = res.headers['set-cookie'];
        if (sc) qbtCookie = sc.map(c => c.split(';')[0]).join('; ');
        let data = '';
        res.on('data', d => (data += d));
        res.on('end', () => resolve({ status: res.statusCode, body: data.trim() }));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function qbtPostMultipart(apiPath, files) {
  const base = qbtBaseUrl();
  if (!base) return Promise.resolve(null);
  const mod = base.protocol === 'https:' ? https : http;
  const boundary = '----qBtDesktop' + Date.now().toString(16);
  const parts = [];
  for (const { name, filename, data } of files) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: application/x-bittorrent\r\n\r\n`,
    ));
    parts.push(data);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  const headers = {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length,
    'Referer': config.qbUrl,
    ...(qbtCookie ? { Cookie: qbtCookie } : {}),
  };
  return new Promise((resolve, reject) => {
    const req = mod.request(
      { hostname: base.hostname, port: parseInt(base.port) || (base.protocol === 'https:' ? 443 : 80), path: apiPath, method: 'POST', headers },
      (res) => {
        const sc = res.headers['set-cookie'];
        if (sc) qbtCookie = sc.map(c => c.split(';')[0]).join('; ');
        let data = '';
        res.on('data', d => (data += d));
        res.on('end', () => resolve({ status: res.statusCode, body: data.trim() }));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function ensureLoggedIn() {
  if (!config.username) return true;
  try {
    const res = await qbtPost('/api/v2/auth/login', { username: config.username, password: config.password });
    return res.body === 'Ok.' || res.body === 'Ok';
  } catch (e) {
    return false;
  }
}

async function qbtApiCall(fn) {
  try {
    let res = await fn();
    if (res.status === 403) {
      qbtCookie = null;
      await ensureLoggedIn();
      res = await fn();
    }
    return res;
  } catch (e) {
    return null;
  }
}

function isQbtSuccess(res) {
  // qBittorrent returns 200 + "Ok." on success. Accept any 200 that isn't an
  // explicit "Fails." — some versions vary capitalisation or omit the period.
  return res && res.status === 200 && !res.body.toLowerCase().startsWith('fail');
}

async function addMagnetViaApi(magnetUrl) {
  const res = await qbtApiCall(() => qbtPost('/api/v2/torrents/add', { urls: magnetUrl }));
  return isQbtSuccess(res);
}

async function addTorrentFileViaApi(filePath) {
  let fileData;
  try { fileData = fs.readFileSync(filePath); } catch (e) { return false; }
  const res = await qbtApiCall(() =>
    qbtPostMultipart('/api/v2/torrents/add', [{ name: 'torrents', filename: path.basename(filePath), data: fileData }]),
  );
  return isQbtSuccess(res);
}

// ── Windows / Tray ──────────────────────────────────────────────────────────
let mainWindow = null;
let settingsWindow = null;
let magnetPopupWindow = null;
let pendingMagnetUrl = null;
let tray = null;
let clipboardInterval = null;
let lastClipboardText = '';
let isQuitting = false;
let updateDownloaded = false;
let dockerVersion = null; // version of the qBittorrent Docker image, if it advertises one

function getMagnetName(magnetUrl) {
  const match = magnetUrl.match(/[?&]dn=([^&]+)/);
  if (match) return decodeURIComponent(match[1].replace(/\+/g, ' ')).slice(0, 80);
  return 'Unknown Torrent';
}

function getIconPath() {
  for (const p of [
    path.join(process.resourcesPath || '', 'assets', 'icon.ico'),
    path.join(__dirname, 'assets', 'icon.ico'),
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function createMainWindow() {
  const bounds = config.windowBounds || { width: 1280, height: 800 };
  mainWindow = new BrowserWindow({
    width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y,
    minWidth: 800, minHeight: 600,
    title: 'qBittorrent Desktop',
    backgroundColor: '#1a1a2e',
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload-main.js'),
      contextIsolation: false, // needed so preload can patch prototypes before qBt's scripts
      nodeIntegration: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
    show: !config.startMinimized && !process.argv.includes('--hidden'),
    autoHideMenuBar: true,
  });

  loadQbittorrent();

  mainWindow.on('close', (e) => {
    if (!isQuitting && config.minimizeToTray) {
      e.preventDefault();
      mainWindow.hide();
      showTrayNotification('qBittorrent Desktop is running in the tray.');
    } else {
      saveWindowBounds();
    }
  });
  mainWindow.on('resize', saveWindowBounds);
  mainWindow.on('move', saveWindowBounds);

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    if (errorCode === -3) return;
    mainWindow.webContents.loadFile(path.join(__dirname, 'error.html'), {
      query: { url: config.qbUrl, error: errorDescription },
    });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http') && !url.startsWith(config.qbUrl)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Append the Docker image version (if the server exposes it) to the title bar.
  mainWindow.webContents.on('page-title-updated', (event, title) => {
    if (dockerVersion) {
      event.preventDefault();
      mainWindow.setTitle(`${title}  —  Docker ${dockerVersion}`);
    }
  });
}

function loadQbittorrent() {
  if (!mainWindow) return;
  qbtCookie = null; // reset session on reload/URL change
  if (!config.qbUrl) {
    mainWindow.loadFile(path.join(__dirname, 'error.html'));
    openSettings();
    return;
  }
  const url = config.qbUrl.replace(/\/$/, '');
  mainWindow.loadURL(url).catch(() => {});
  mainWindow.setTitle('qBittorrent Desktop — ' + url);
}

function saveWindowBounds() {
  if (!mainWindow || mainWindow.isMinimized() || mainWindow.isMaximized()) return;
  config.windowBounds = mainWindow.getBounds();
  saveConfig(config);
}

function createTray() {
  const iconPath = getIconPath();
  const trayIcon = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();
  tray = new Tray(trayIcon);
  tray.setToolTip('qBittorrent Desktop');
  tray.on('double-click', showMainWindow);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `qBittorrent Desktop v${app.getVersion()}`, enabled: false },
    ...(updateDownloaded
      ? [{ label: '⟳ Restart to Install Update', click: () => { isQuitting = true; autoUpdater.quitAndInstall(true, true); } }]
      : []),
    { type: 'separator' },
    { label: 'Open qBittorrent Desktop', click: showMainWindow },
    { type: 'separator' },
    { label: 'Add Magnet from Clipboard', click: addMagnetFromClipboard },
    { label: 'Add .torrent File…', click: addTorrentFromDialog },
    { type: 'separator' },
    { label: 'Settings', click: openSettings },
    { label: 'Check for Updates', click: checkForUpdatesManual },
    { label: 'Open in Browser', click: () => shell.openExternal(config.qbUrl) },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Showing a Windows toast makes Electron auto-create a Start-menu shortcut
// carrying our AppUserModelID. In dev that shortcut points at the bare
// electron.exe (no app path) and can hijack toast activation, so only ever
// show notifications from the packaged app.
function canNotify() {
  return app.isPackaged && Notification.isSupported();
}

function showTrayNotification(body, onClick) {
  if (!canNotify()) return;
  const n = new Notification({ title: 'qBittorrent Desktop', body, icon: getIconPath() || undefined, silent: true });
  n.on('click', onClick || showMainWindow);
  n.show();
}

// ── Magnet + torrent handling ────────────────────────────────────────────────
function isMagnetLink(text) {
  return typeof text === 'string' && text.trim().startsWith('magnet:?');
}

async function addMagnetFromClipboard() {
  const text = clipboard.readText().trim();
  if (!isMagnetLink(text)) {
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'info', title: 'No Magnet Link', message: 'No magnet link found in clipboard.',
    });
    return;
  }
  const ok = await addMagnetViaApi(text);
  if (ok) {
    showTrayNotification('Magnet link added to qBittorrent.');
    if (mainWindow && mainWindow.isVisible()) mainWindow.webContents.reload();
  } else {
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'error', title: 'Failed to Add Magnet',
      message: 'Could not add the magnet link.\n\nMake sure qBittorrent is reachable and credentials are correct in Settings.',
    });
  }
}

async function addTorrentFromDialog() {
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: 'Open Torrent File',
    filters: [{ name: 'Torrent Files', extensions: ['torrent'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || !result.filePaths.length) return;
  for (const filePath of result.filePaths) {
    const ok = await addTorrentFileViaApi(filePath);
    if (!ok) {
      dialog.showMessageBox(mainWindow || undefined, {
        type: 'error', title: 'Failed to Add Torrent',
        message: `Could not add: ${path.basename(filePath)}\n\nCheck that qBittorrent is reachable.`,
      });
      return;
    }
  }
  showTrayNotification(`Added ${result.filePaths.length} torrent(s) to qBittorrent.`);
  if (mainWindow && mainWindow.isVisible()) mainWindow.webContents.reload();
}

async function handleFileArg(filePath) {
  if (!filePath) return;
  filePath = filePath.trim().replace(/^"|"$/g, ''); // strip quotes Windows sometimes adds
  if (filePath.toLowerCase().endsWith('.torrent') && fs.existsSync(filePath)) {
    const ok = await addTorrentFileViaApi(filePath);
    showTrayNotification(ok ? `Added: ${path.basename(filePath)}` : `Failed to add: ${path.basename(filePath)}`);
    if (ok && mainWindow && mainWindow.isVisible()) mainWindow.webContents.reload();
  }
}

async function handleMagnetArg(magnetUrl) {
  if (!magnetUrl) return;
  showMagnetPopup(magnetUrl);
}

function parseCommandLine(argv) {
  const magnet = argv.find(a => isMagnetLink(a));
  const torrent = argv.find(a => a.toLowerCase().endsWith('.torrent'));
  return { magnet, torrent };
}

// ── Magnet popup window ──────────────────────────────────────────────────────
function showMagnetPopup(magnetUrl) {
  pendingMagnetUrl = magnetUrl;

  if (magnetPopupWindow && !magnetPopupWindow.isDestroyed()) {
    // Update existing popup instead of stacking new ones
    magnetPopupWindow.webContents.send('update-magnet', magnetUrl, getMagnetName(magnetUrl));
    return;
  }

  const { workAreaSize } = screen.getPrimaryDisplay();
  const W = 420, H = 172;
  magnetPopupWindow = new BrowserWindow({
    width: W, height: H,
    x: workAreaSize.width - W - 16,
    y: workAreaSize.height - H - 16,
    alwaysOnTop: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    focusable: true,
    backgroundColor: '#16213e',
    webPreferences: {
      preload: path.join(__dirname, 'preload-popup.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    roundedCorners: true,
  });

  magnetPopupWindow.loadFile(path.join(__dirname, 'magnet-popup.html'));
  magnetPopupWindow.once('ready-to-show', () => magnetPopupWindow.show());
  magnetPopupWindow.on('closed', () => { magnetPopupWindow = null; });

  const timer = setTimeout(() => {
    if (magnetPopupWindow && !magnetPopupWindow.isDestroyed()) magnetPopupWindow.close();
  }, 12000);
  magnetPopupWindow.on('closed', () => clearTimeout(timer));
}

// ── Completion notifications ─────────────────────────────────────────────────
const knownProgress = new Map();    // hash → last seen progress (0–1)
const completedHashes = new Set();  // hashes already counted as complete
let completionPollInterval = null;

async function checkCompletions(initialLoad = false) {
  try {
    const res = await qbtApiCall(() => qbtGet('/api/v2/torrents/info'));
    if (!res || res.status !== 200) return;
    const torrents = JSON.parse(res.body);
    // An empty list usually means the server is (re)starting — don't touch state,
    // otherwise the recheck on restart would look like fresh completions.
    if (!Array.isArray(torrents) || torrents.length === 0) return;

    for (const t of torrents) {
      const prev = knownProgress.get(t.hash);
      const done = t.progress >= 1;
      if (done) {
        // Notify only the first time we actually watch a torrent go from
        // incomplete → complete. Already-complete torrents (seeded on startup)
        // and torrents that merely re-check after a server restart are in
        // completedHashes, so they never re-notify.
        if (!initialLoad && !completedHashes.has(t.hash) && prev !== undefined && prev < 1 && canNotify()) {
          const n = new Notification({
            title: 'Download Complete',
            body: t.name,
            icon: getIconPath() || undefined,
          });
          n.on('click', showMainWindow);
          n.show();
        }
        completedHashes.add(t.hash);
      }
      knownProgress.set(t.hash, t.progress);
    }

    // Prune progress for removed torrents. Keep completedHashes — it's cheap and
    // prevents re-notifying if a torrent briefly disappears during a restart.
    const hashes = new Set(torrents.map(t => t.hash));
    for (const h of [...knownProgress.keys()]) {
      if (!hashes.has(h)) knownProgress.delete(h);
    }
  } catch {}
}

function startCompletionMonitor() {
  if (completionPollInterval) return;
  checkCompletions(true); // seed initial state, no notifications
  completionPollInterval = setInterval(() => checkCompletions(false), 30000);
}

// ── Clipboard monitor ────────────────────────────────────────────────────────
function startClipboardMonitor() {
  if (clipboardInterval) return;
  lastClipboardText = clipboard.readText();
  clipboardInterval = setInterval(() => {
    if (!config.clipboardMonitor) return;
    try {
      const text = clipboard.readText().trim();
      if (text === lastClipboardText) return;
      lastClipboardText = text;
      if (isMagnetLink(text)) showMagnetPopup(text);
    } catch (e) {}
  }, 1000);
}

// ── Settings window ──────────────────────────────────────────────────────────
function openSettings() {
  if (settingsWindow) { settingsWindow.focus(); return; }
  settingsWindow = new BrowserWindow({
    width: 520, height: 550,
    useContentSize: true, // size refers to the web content area (robust across Electron/DPI)
    title: 'qBittorrent Desktop — Settings',
    icon: getIconPath(),
    parent: mainWindow || undefined,
    resizable: false,
    backgroundColor: '#1a1a2e',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
    autoHideMenuBar: true,
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ── qBittorrent add-torrent dialog (via JS injection into the web UI) ────────
async function openQbtAddDialog(magnetUrl) {
  showMainWindow();
  await new Promise(r => setTimeout(r, 200));
  try {
    // Single script: observer fires the moment the textarea appears, no fixed delay needed
    const result = await mainWindow.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const url = ${JSON.stringify(magnetUrl)};

        function fillInput(el) {
          el.focus();
          const proto = el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value');
          if (setter && setter.set) setter.set.call(el, url);
          else el.value = url;
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Snapshot existing visible textareas so we only target the new dialog one
        function visibleInputs() {
          return new Set(Array.from(document.querySelectorAll('textarea, input[type="text"]')).filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 10 && r.height > 10;
          }));
        }

        const before = visibleInputs();

        const observer = new MutationObserver(() => {
          const newInputs = Array.from(document.querySelectorAll('textarea, input[type="text"]')).filter(el => {
            if (before.has(el)) return false;
            const r = el.getBoundingClientRect();
            return r.width > 10 && r.height > 10;
          });
          if (newInputs.length > 0) {
            observer.disconnect();
            fillInput(newInputs[0]);
            resolve('filled');
          }
        });

        // Watch for new elements and style/class changes (dialog may already exist, just shown)
        observer.observe(document.body, {
          childList: true, subtree: true,
          attributes: true, attributeFilter: ['style', 'class', 'hidden'],
        });
        setTimeout(() => { observer.disconnect(); resolve('timeout'); }, 5000);

        // Click the toolbar button to open the dialog
        const btn = document.querySelector(
          '#downloadButton, [id*="download"], [title*="link" i], [title*="URL" i], [title*="magnet" i], [aria-label*="link" i]'
        );
        if (btn) {
          btn.click();
        } else {
          observer.disconnect();
          resolve('no-btn');
        }
      })
    `);

    return result === 'filled';
  } catch (e) {}
  return false;
}

// ── IPC ──────────────────────────────────────────────────────────────────────
ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('get-config', () => config);
ipcMain.handle('save-config', (event, newConfig) => {
  const urlChanged = newConfig.qbUrl !== config.qbUrl;
  config = { ...config, ...newConfig };
  saveConfig(config);
  app.setLoginItemSettings({
    openAtLogin: !!config.runAtStartup,
    args: config.runAtStartup ? ['--hidden'] : [],
  });
  applyMagnetHandler();
  updateTrayMenu();
  if (urlChanged) loadQbittorrent();
  return { ok: true };
});
ipcMain.handle('open-settings', () => openSettings());
ipcMain.handle('reload', () => loadQbittorrent());

// The preload reads the X-Docker-Version response header (if the server sets it)
// and reports it here; append it to the window title.
ipcMain.on('docker-version', (event, version) => {
  const v = (version || '').toString().trim();
  if (!v || v === dockerVersion) return;
  dockerVersion = v;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const base = mainWindow.getTitle().split('  —  Docker ')[0];
    mainWindow.setTitle(`${base}  —  Docker ${dockerVersion}`);
  }
});

function mapRemoteToLocal(remotePath) {
  const remoteBase = (config.remoteDownloadPath || '/downloads').replace(/\/+$/, '');
  const localBase  = (config.localDownloadPath  || 'Z:\\qbittorrent').replace(/[/\\]+$/, '');
  if (remotePath.startsWith(remoteBase)) {
    const rel = remotePath.slice(remoteBase.length).replace(/\//g, path.sep);
    return localBase + rel;
  }
  return remotePath;
}

ipcMain.handle('open-local-path', (event, remotePath) => {
  const localPath = mapRemoteToLocal(remotePath);
  try {
    const stat = fs.statSync(localPath);
    if (stat.isDirectory()) shell.openPath(localPath);
    else shell.showItemInFolder(localPath);
  } catch {
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'error',
      title: 'Cannot Open Path',
      message: `Path not found:\n${localPath}\n\nCheck the path mapping in Settings.`,
    });
  }
});

// Contents tab: open the clicked file with its default app, or open the folder.
ipcMain.handle('open-content-path', async (event, remotePath) => {
  const localPath = mapRemoteToLocal(remotePath);
  try {
    if (!fs.existsSync(localPath)) throw new Error('not found');
    const err = await shell.openPath(localPath); // file → default app, folder → Explorer
    if (err) throw new Error(err);
  } catch {
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'error',
      title: 'Cannot Open',
      message: `Could not open:\n${localPath}\n\nCheck the path mapping in Settings.`,
    });
  }
});

// Popup IPC
ipcMain.handle('popup-get-magnet', () => ({
  url: pendingMagnetUrl,
  name: pendingMagnetUrl ? getMagnetName(pendingMagnetUrl) : '',
}));

ipcMain.handle('popup-open-dialog', async () => {
  const url = pendingMagnetUrl;
  if (!url) return;
  if (magnetPopupWindow && !magnetPopupWindow.isDestroyed()) magnetPopupWindow.close();
  // Keep lastClipboardText as the URL so it won't re-trigger while the link
  // is still in the clipboard, but will fire again if copied a second time.
  lastClipboardText = url;
  const ok = await addMagnetViaApi(url);
  if (ok && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
});

ipcMain.handle('popup-dismiss', () => {
  if (magnetPopupWindow && !magnetPopupWindow.isDestroyed()) magnetPopupWindow.close();
  lastClipboardText = pendingMagnetUrl || lastClipboardText;
});

// ── Magnet protocol handler ──────────────────────────────────────────────────
function applyMagnetHandler() {
  if (config.registerMagnetHandler !== false) {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('magnet', process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient('magnet');
    }
  } else {
    app.removeAsDefaultProtocolClient('magnet');
  }
}

// ── Auto-update (electron-updater + GitHub Releases) ─────────────────────────
function setupAutoUpdater() {
  if (!app.isPackaged) return; // updater needs a packaged build + published latest.yml

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true;
    updateTrayMenu();
    showTrayNotification(
      `Update ${info.version} is ready. Click to restart and install.`,
      () => { isQuitting = true; autoUpdater.quitAndInstall(true, true); },
    );
  });

  // Stay silent on errors — a failed update check shouldn't nag the user.
  autoUpdater.on('error', () => {});

  autoUpdater.checkForUpdates().catch(() => {});
  // Re-check periodically while the app stays open (every 6 hours).
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

function checkForUpdatesManual() {
  if (!app.isPackaged) {
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'info', title: 'Updates',
      message: 'Auto-update is only available in the installed version.',
    });
    return;
  }
  if (updateDownloaded) {
    isQuitting = true;
    autoUpdater.quitAndInstall(true, true);
    return;
  }
  autoUpdater.checkForUpdates()
    .then((r) => {
      const latest = r && r.updateInfo && r.updateInfo.version;
      if (latest && latest !== app.getVersion()) {
        showTrayNotification(`Downloading update ${latest}…`);
      } else {
        dialog.showMessageBox(mainWindow || undefined, {
          type: 'info', title: 'Up to Date',
          message: `You're on the latest version (v${app.getVersion()}).`,
        });
      }
    })
    .catch(() => {
      dialog.showMessageBox(mainWindow || undefined, {
        type: 'error', title: 'Update Check Failed',
        message: 'Could not check for updates. Please try again later.',
      });
    });
}

// ── App lifecycle ────────────────────────────────────────────────────────────
app.on('second-instance', async (event, commandLine) => {
  showMainWindow();
  const { magnet, torrent } = parseCommandLine(commandLine);
  if (magnet) await handleMagnetArg(magnet);
  if (torrent) await handleFileArg(torrent);
});

app.whenReady().then(async () => {
  createMainWindow();
  createTray();
  startClipboardMonitor();
  startCompletionMonitor();
  setupAutoUpdater();

  applyMagnetHandler();

  // Handle magnet/torrent passed on first launch
  const { magnet, torrent } = parseCommandLine(process.argv.slice(1));
  if (magnet) await handleMagnetArg(magnet);
  if (torrent) await handleFileArg(torrent);
});

// macOS: magnet links from browser
app.on('open-url', async (event, url) => {
  event.preventDefault();
  if (isMagnetLink(url)) await handleMagnetArg(url);
});

app.on('window-all-closed', () => { if (isQuitting) app.quit(); });
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  else showMainWindow();
});
app.on('before-quit', () => {
  isQuitting = true;
  if (clipboardInterval) clearInterval(clipboardInterval);
  if (completionPollInterval) clearInterval(completionPollInterval);
});
