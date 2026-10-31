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
  tasksChanged: () => ipcRenderer.send('tasks:changed'),
  onTasksChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('tasks:changed', listener);
    return () => ipcRenderer.removeListener('tasks:changed', listener);
  },
  // Background mode (Settings > Desktop app): start with Windows, the tray, global shortcuts.
  getDesktopPrefs: () => ipcRenderer.invoke('desktop:get-prefs'),
  setDesktopPrefs: (patch) => ipcRenderer.invoke('desktop:set-prefs', patch),
  setTrayLabels: (labels) => ipcRenderer.invoke('desktop:set-tray-labels', labels),
  // The quick-add popup (#quick-add): shown again, and put away.
  onQuickAddShown: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('quick-add:shown', listener);
    return () => ipcRenderer.removeListener('quick-add:shown', listener);
  },
  closeQuickAdd: () => ipcRenderer.invoke('quick-add:close'),
  resizeQuickAdd: (height) => ipcRenderer.invoke('quick-add:resize', Number(height)),
  // Note windows: the note is on screen (show the window now), and a spare window being handed its note.
  noteReady: () => ipcRenderer.send('note:ready'),
  noteSpareReady: () => ipcRenderer.send('note:spare-ready'),
  onNoteAssign: (callback) => {
    const listener = (_event, id) => callback(String(id));
    ipcRenderer.on('note:assign', listener);
    return () => ipcRenderer.removeListener('note:assign', listener);
  },
  // The "new sticky note" shortcut asks the main window's page to make one; a request made before the page
  // was ready is handed over when it subscribes.
  onNewNoteRequest: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('quick:new-note', listener);
    void ipcRenderer.invoke('quick:take-pending-note').then((pending) => pending && callback());
    return () => ipcRenderer.removeListener('quick:new-note', listener);
  },
});
