const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popupApi', {
  getItem: () => ipcRenderer.invoke('popup-get-item'),
  add: () => ipcRenderer.invoke('popup-add'),
  dismiss: () => ipcRenderer.invoke('popup-dismiss'),
  onUpdate: (cb) => ipcRenderer.on('popup-update', (e, kind, name) => cb(kind, name)),
});
