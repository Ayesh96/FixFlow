const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fixflow', {
  saveConfig: (values) => ipcRenderer.invoke('setup:save', values),
});
