const { ipcRenderer } = require('electron');

// Keep a reference to the real addEventListener before we patch the prototype
// below, so our own Contents-tab listener isn't wrapped by that patch.
const nativeAddEventListener = EventTarget.prototype.addEventListener;

// ── Intercept ALL dblclick listeners before qBittorrent's page scripts run ──
// We wrap every addEventListener('dblclick', ...) call so that when the click
// lands on a table row, our handler runs and qBt's never does.
;(function() {
  const orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (type === 'dblclick' && typeof listener === 'function') {
      const wrapped = function(e) {
        const row = e.target.closest('tr');
        if (row && !row.closest('thead')) {
          e.stopImmediatePropagation();
          e.preventDefault();
          openRowPath(row);
          return; // do NOT call qBt's original listener
        }
        listener.call(this, e);
      };
      return orig.call(this, type, wrapped, options);
    }
    return orig.call(this, type, listener, options);
  };
})();

// ── Open the local mapped path for a clicked torrent/file row ─────────────
async function openRowPath(row) {
  // Rows in the Contents tab are handled by the dedicated listener below.
  if (row.closest('#torrentFilesTableDiv')) return;

  // Strategy 1: hash in a data attribute or element id
  let hash = row.dataset.hash
    || row.getAttribute('data-hash')
    || row.closest('[data-hash]')?.dataset.hash;
  if (!hash && /^[0-9a-f]{40}$/i.test(row.id)) hash = row.id;

  if (hash) {
    try {
      const r = await fetch('/api/v2/torrents/info?hashes=' + hash);
      const list = await r.json();
      if (list.length) {
        ipcRenderer.invoke('open-local-path', list[0].content_path || list[0].save_path);
        return;
      }
    } catch {}
  }

  // Strategy 2: extract name from row cells and match via API
  let name = '';
  const cells = Array.from(row.querySelectorAll('td'));

  for (const cell of cells) {
    const t = (cell.title || '').trim();
    if (t.length > 5
      && !/^[\d.,]+\s*(GiB|MiB|KiB|B|%|\/s)/.test(t)
      && !/^\d{4}\//.test(t)) {
      name = t; break;
    }
  }
  if (!name) {
    for (const cell of cells) {
      const t = cell.textContent.trim();
      if (t.length > name.length && t.length > 5
        && !/^[\d.,]+\s*(GiB|MiB|KiB|B|%|\/s)/.test(t)
        && !/^\d{4}\//.test(t)) {
        name = t;
      }
    }
  }

  if (!name) return;

  try {
    const r = await fetch('/api/v2/torrents/info');
    const list = await r.json();
    const t = list.find(x => x.name === name)
      || list.find(x => name.startsWith(x.name) || x.name.startsWith(name));
    if (t) ipcRenderer.invoke('open-local-path', t.content_path || t.save_path);
  } catch {}
}

// ── App-version badge in the bottom-right corner ───────────────────────────
// Injected into the qBittorrent page; re-runs on every load/navigation since
// the preload runs each time. Subtle and click-through so it never blocks UI.
async function addVersionBadge() {
  try {
    if (document.getElementById('qbd-version-badge')) return;
    const version = await ipcRenderer.invoke('get-version');
    const badge = document.createElement('div');
    badge.id = 'qbd-version-badge';
    badge.textContent = 'Desktop v' + version;
    badge.style.cssText = [
      'position:fixed', 'bottom:6px', 'left:8px', 'z-index:2147483647',
      'font:11px/1 "Segoe UI",system-ui,sans-serif', 'color:#9fb0c3',
      'background:rgba(13,27,42,0.55)', 'padding:3px 7px', 'border-radius:5px',
      'opacity:0.6', 'pointer-events:none', 'user-select:none',
    ].join(';');
    document.body.appendChild(badge);
  } catch {}
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', addVersionBadge);
} else {
  addVersionBadge();
}

// ── Contents tab: double-click a folder to open it, a file to open it ──────
// qBittorrent's Content tab is a tree table (#torrentFilesTableDiv). We grab
// the table instance (it isn't global) by wrapping its populateTable, then on
// double-click resolve the clicked node's full path from qBt's own file tree.
let contentTable = null;
(function captureContentTable() {
  const patch = () => {
    const TFT = window.qBittorrent
      && window.qBittorrent.DynamicTable
      && window.qBittorrent.DynamicTable.TorrentFilesTable;
    if (!TFT) return false;
    if (!TFT.prototype.__qbdContentPatched) {
      const orig = TFT.prototype.populateTable;
      TFT.prototype.populateTable = function () { contentTable = this; return orig.apply(this, arguments); };
      TFT.prototype.__qbdContentPatched = true;
    }
    return true;
  };
  if (patch()) return;
  const iv = setInterval(() => { if (patch()) clearInterval(iv); }, 500);
  setTimeout(() => clearInterval(iv), 60000);
})();

// Hash of the torrent whose contents are shown = the selected torrent row.
function selectedTorrentHash() {
  for (const tr of document.querySelectorAll('tr.selected')) {
    const id = String(tr.dataset.rowId ?? tr.rowId ?? '');
    if (/^[0-9a-f]{40}$/i.test(id)) return id.toLowerCase();
  }
  return null;
}

// Files carry a full .path; folders don't, so walk up the tree via .root/.name.
function nodeRelativePath(node) {
  if (node.path) return node.path;
  const parts = [];
  for (let n = node; n && n.name; n = n.root) parts.unshift(n.name);
  return parts.join('/');
}

async function openContentNode(row) {
  if (!contentTable) return;
  const rowId = row.dataset.rowId ?? row.rowId;
  if (rowId === undefined || rowId === null || rowId === '') return;
  const node = contentTable.getNode(rowId)
    ?? contentTable.getNode(Number(rowId))
    ?? contentTable.getNode(String(rowId));
  if (!node) return;
  const rel = nodeRelativePath(node);
  if (!rel) return;
  const hash = selectedTorrentHash();
  if (!hash) return;
  try {
    const r = await fetch('/api/v2/torrents/info?hashes=' + hash);
    const list = await r.json();
    if (!list.length) return;
    const savePath = String(list[0].save_path || '').replace(/[/\\]+$/, '');
    if (!savePath) return;
    ipcRenderer.invoke('open-content-path', savePath + '/' + rel);
  } catch {}
}

// Registered via the native addEventListener (capture phase) so it isn't
// wrapped by the dblclick patch above and always fires for Contents rows.
nativeAddEventListener.call(document, 'dblclick', (e) => {
  const row = e.target.closest('tr');
  if (!row || row.closest('thead') || !row.closest('#torrentFilesTableDiv')) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  openContentNode(row);
}, true);

// ── Report the qBittorrent Docker image version (custom response header) ───
// pia-qbittorrent-docker sets an "X-Docker-Version" header; read it from any
// WebUI response and hand it to the main process to show in the title bar.
(function reportDockerVersion() {
  const attempt = (n) => {
    fetch('/api/v2/app/version', { cache: 'no-store' })
      .then((r) => r.headers.get('X-Docker-Version'))
      .then((v) => {
        if (v) ipcRenderer.send('docker-version', v);
        else if (n < 3) setTimeout(() => attempt(n + 1), 2000);
      })
      .catch(() => { if (n < 3) setTimeout(() => attempt(n + 1), 2000); });
  };
  attempt(0);
})();

// ── Inject a "Desktop" menu into qBittorrent's menu bar ────────────────────
// The navbar is a CSS-hover menu (#desktopNavbar > ul > li), so a matching <li>
// gets qBittorrent's styling and open-on-hover behaviour for free.
(function injectDesktopMenu() {
  const build = () => {
    const navUl = document.querySelector('#desktopNavbar > ul');
    if (!navUl) return false;
    if (document.getElementById('qbd-desktop-menu')) return true;

    const li = document.createElement('li');
    li.id = 'qbd-desktop-menu';
    li.innerHTML =
      '<a class="returnFalse">Desktop</a>' +
      '<ul>' +
        '<li><a id="qbd-menu-settings">Settings</a></li>' +
        '<li><a id="qbd-menu-update">Check for Updates</a></li>' +
        '<li class="divider"><a id="qbd-menu-browser">Open in Browser</a></li>' +
      '</ul>';
    navUl.appendChild(li);

    li.querySelector('#qbd-menu-settings').addEventListener('click', () => ipcRenderer.invoke('open-settings'));
    li.querySelector('#qbd-menu-update').addEventListener('click', () => ipcRenderer.invoke('check-for-updates'));
    li.querySelector('#qbd-menu-browser').addEventListener('click', () => ipcRenderer.invoke('open-in-browser'));
    return true;
  };
  if (build()) return;
  const iv = setInterval(() => { if (build()) clearInterval(iv); }, 500);
  setTimeout(() => clearInterval(iv), 30000);
})();

// ── Expose desktop API to the page (direct assignment; no contextBridge) ───
window.qbDesktop = {
  getConfig:     ()    => ipcRenderer.invoke('get-config'),
  saveConfig:    (cfg) => ipcRenderer.invoke('save-config', cfg),
  openSettings:  ()    => ipcRenderer.invoke('open-settings'),
  reload:        ()    => ipcRenderer.invoke('reload'),
  openLocalPath: (p)   => ipcRenderer.invoke('open-local-path', p),
};
