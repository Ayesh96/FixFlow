const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fixflow', {
  saveConfig: (values) => ipcRenderer.invoke('setup:save', values),
  checkOllama: (url) => ipcRenderer.invoke('setup:checkOllama', url),
  checkDeepseek: (apiKey) => ipcRenderer.invoke('setup:checkDeepseek', apiKey),
  checkAnthropic: (apiKey) => ipcRenderer.invoke('setup:checkAnthropic', apiKey),
  checkPort: (port) => ipcRenderer.invoke('setup:checkPort', port),
  pickFolder: () => ipcRenderer.invoke('setup:pickFolder'),
  constants: () => ipcRenderer.invoke('setup:constants'),
  current: () => ipcRenderer.invoke('setup:current'),
});
