const { contextBridge, ipcRenderer } = require('electron');

// Narrow, typed bridge between the React app and the Electron main process.
// Only these functions are reachable from the page; no raw ipcRenderer access.
contextBridge.exposeInMainWorld('mytodoease', {
  platform: process.platform,
  isDesktop: true,
  getWindowState: () => ipcRenderer.invoke('window:get-state'),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('window:set-always-on-top', Boolean(flag)),
  setCompact: (flag) => ipcRenderer.invoke('window:set-compact', Boolean(flag)),
  setDocked: (flag) => ipcRenderer.invoke('window:set-docked', Boolean(flag)),
  onWindowState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('window:state', listener);
    return () => ipcRenderer.removeListener('window:state', listener);
  },
  setTitleBarTheme: (theme) => ipcRenderer.invoke('window:set-title-bar-theme', theme === 'dark' ? 'dark' : 'light'),
  saveTextFile: (defaultName, content) =>
    ipcRenderer.invoke('file:save-text', { defaultName: String(defaultName), content: String(content) }),
});
