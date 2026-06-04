const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qbDesktop', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  openSettings: () => ipcRenderer.invoke('open-settings'),
  reload: () => ipcRenderer.invoke('reload'),
  openLocalPath: (remotePath) => ipcRenderer.invoke('open-local-path', remotePath),
});
