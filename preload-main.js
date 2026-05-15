const { ipcRenderer } = require('electron');

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

// ── Expose desktop API to the page (direct assignment; no contextBridge) ───
window.qbDesktop = {
  getConfig:     ()    => ipcRenderer.invoke('get-config'),
  saveConfig:    (cfg) => ipcRenderer.invoke('save-config', cfg),
  openSettings:  ()    => ipcRenderer.invoke('open-settings'),
  reload:        ()    => ipcRenderer.invoke('reload'),
  openLocalPath: (p)   => ipcRenderer.invoke('open-local-path', p),
};
