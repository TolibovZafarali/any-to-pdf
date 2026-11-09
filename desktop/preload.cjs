const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopReader', {
  getLibrary: () => ipcRenderer.invoke('reader:get-library'),
  importBooks: () => ipcRenderer.invoke('reader:import-books'),
  readBook: id => ipcRenderer.invoke('reader:read-book', id),
  saveProgress: progress => ipcRenderer.invoke('reader:save-progress', progress),
  removeBook: id => ipcRenderer.invoke('reader:remove-book', id),
  setAlwaysOnTop: value => ipcRenderer.invoke('reader:set-always-on-top', value),
});
