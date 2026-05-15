const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qbDesktop', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  reload: () => ipcRenderer.invoke('reload'),
  openLocalPath: (remotePath) => ipcRenderer.invoke('open-local-path', remotePath),
});
