const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popupApi', {
  getMagnet: () => ipcRenderer.invoke('popup-get-magnet'),
  openDialog: () => ipcRenderer.invoke('popup-open-dialog'),
  dismiss: () => ipcRenderer.invoke('popup-dismiss'),
  onUpdate: (cb) => ipcRenderer.on('update-magnet', (e, url, name) => cb(url, name)),
});
