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
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', String(url)),
  getMcpSetup: () => ipcRenderer.invoke('mcp:get-setup'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write-text', String(text)),
  // Automatic updates (main.cjs, electron-updater): current state, a manual check, and "Restart to update".
  getUpdateState: () => ipcRenderer.invoke('update:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update:state', listener);
    return () => ipcRenderer.removeListener('update:state', listener);
  },
  // Sticky notes in their own windows, and keeping every window's notes in step.
  openNote: (id) => ipcRenderer.invoke('note:open', String(id)),
  showMainWindow: () => ipcRenderer.invoke('app:show-main'),
  notesChanged: () => ipcRenderer.send('notes:changed'),
  onNotesChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('notes:changed', listener);
    return () => ipcRenderer.removeListener('notes:changed', listener);
  },
});
