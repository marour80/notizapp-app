const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('notes:load'),
  save: (data) => ipcRenderer.invoke('notes:save', data),
  onChanged: (cb) => ipcRenderer.on('notes:changed', cb),
  // widget controls
  togglePin: () => ipcRenderer.invoke('widget:toggle-pin'),
  isPinned: () => ipcRenderer.invoke('widget:is-pinned'),
  closeWidget: () => ipcRenderer.invoke('widget:close'),
  openFull: () => ipcRenderer.invoke('app:open-full'),
  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  setAutostart: (v) => ipcRenderer.invoke('autostart:set', v)
});
