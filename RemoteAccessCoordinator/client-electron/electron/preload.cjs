const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rdpDesk', {
  localIp: () => ipcRenderer.invoke('network:local-ip'),
  connect: () => ipcRenderer.invoke('rdp:connect'),
  notify: (payload) => ipcRenderer.invoke('app:notify', payload),
  show: () => ipcRenderer.invoke('app:show'),
});
