const { contextBridge } = require('electron');

// Minimal, read-only bridge. Add IPC here (e.g. native notifications) as features need it.
contextBridge.exposeInMainWorld('mytodoease', {
  platform: process.platform,
  isDesktop: true,
});
