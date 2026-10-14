const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gideon', Object.freeze({
  getStatus: () => ipcRenderer.invoke('gideon:status'),
  saveKey: key => ipcRenderer.invoke('gideon:save-key', key),
  start: () => ipcRenderer.invoke('gideon:start'),
  stop: () => ipcRenderer.invoke('gideon:stop'),
  forgetKey: () => ipcRenderer.invoke('gideon:forget-key'),
  openPanel: () => ipcRenderer.invoke('gideon:open-panel'),
  openKeyPage: () => ipcRenderer.invoke('gideon:key-page'),
  onStatus: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('gideon:status-changed', listener);
    return () => ipcRenderer.removeListener('gideon:status-changed', listener);
  },
}));
