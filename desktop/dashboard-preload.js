const { contextBridge, ipcRenderer } = require('electron');

// The dashboard is the server's web page; inside the desktop app it may only ask to open Settings.
contextBridge.exposeInMainWorld('fixflowDesktop', {
  openSettings: () => ipcRenderer.invoke('app:openSettings'),
});
