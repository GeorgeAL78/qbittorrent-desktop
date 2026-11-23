const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popupApi', {
  add: () => ipcRenderer.invoke('popup-add'),
  dismiss: () => ipcRenderer.invoke('popup-dismiss'),
  onShow: (cb) => ipcRenderer.on('popup-show', (e, kind, name, timeout) => cb(kind, name, timeout)),
});
