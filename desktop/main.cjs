const { app, BrowserWindow, ipcMain, nativeTheme, screen, shell } = require('electron');
const { execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Windows "app bar" helper (desktop/appbar): reserves a strip of the screen for the mini window so
// maximized apps stop at its edge instead of covering it. Built by `npm run build:appbar`.
const appBarExe = path.join(__dirname, 'build', 'appbar', 'MyTodoEase.AppBar.exe');

// Dev aid: MYTODOEASE_DEVTOOLS_PORT=9222 exposes the Chrome DevTools protocol for scripted testing.
if (process.env.MYTODOEASE_DEVTOOLS_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.MYTODOEASE_DEVTOOLS_PORT);
}

// Set by `npm run dev` so the window loads the Vite dev server with hot reload.
// Unset in a packaged build, where the compiled React app is loaded from disk.
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

const NORMAL_MIN = { width: 900, height: 600 };
const NORMAL_DEFAULT = { width: 1200, height: 800 };
const COMPACT_MIN = { width: 300, height: 360 };
const COMPACT_DEFAULT = { width: 380, height: 580 };
const TITLE_BAR_HEIGHT = 36;

// Native window buttons (minimize / maximize / close) are drawn by the OS over our own title bar,
// so the colors must follow the app theme. Values mirror --bg-sidebar / --text in styles.css.
const TITLE_BAR_COLORS = {
  light: { color: '#fcfaf8', symbolColor: '#202020' },
  dark: { color: '#282828', symbolColor: '#e8e8e8' },
};

// Window preferences survive restarts: pinned state, mini mode, and the bounds of each mode.
const settingsPath = path.join(app.getPath('userData'), 'window-settings.json');
const settings = {
  alwaysOnTop: false,
  compact: false,
  docked: false,
  dockWhenCompact: false, // set when leaving mini mode while docked; re-docks on return
  normalBounds: null,
  compactBounds: null,
  ...loadSettings(),
};
// Docking is re-applied on startup, never assumed: the shell forgets app bars when the window goes away.
const dockOnStartup = settings.docked === true;
settings.docked = false;

function loadSettings() {
  try {
    // Tolerate a UTF-8 BOM (hand-edited files); JSON.parse rejects it otherwise.
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^﻿/, ''));
  } catch {
    return {};
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Could not save window settings:', error);
  }
}

/** Default placement for the mini window: top-right corner of the primary work area. */
function defaultCompactBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    ...COMPACT_DEFAULT,
    x: area.x + area.width - COMPACT_DEFAULT.width - 16,
    y: area.y + 16,
  };
}

/** Keep remembered bounds on a visible display; monitors may have changed since last run. */
function onScreen(bounds) {
  if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number') return null;
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  const intersects =
    bounds.x < area.x + area.width &&
    bounds.x + bounds.width > area.x &&
    bounds.y < area.y + area.height &&
    bounds.y + bounds.height > area.y;
  if (!intersects) return null;
  // A full-height sliver is the docked strip, never a size the user chose; ignore it.
  const stripLike = bounds.height >= area.height - 8 && bounds.width < 600;
  return stripLike ? null : bounds;
}

let win = null;

function createWindow() {
  const compact = settings.compact;
  const minimum = compact ? COMPACT_MIN : NORMAL_MIN;
  const remembered = onScreen(compact ? settings.compactBounds : settings.normalBounds);
  const bounds = remembered ?? (compact ? defaultCompactBounds() : NORMAL_DEFAULT);

  win = new BrowserWindow({
    ...bounds,
    minWidth: minimum.width,
    minHeight: minimum.height,
    title: 'MyTodoEase',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    alwaysOnTop: settings.alwaysOnTop,
    // Window Controls Overlay: the page draws the title bar (see TitleBar.tsx); the OS keeps its buttons.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      ...TITLE_BAR_COLORS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'],
      height: TITLE_BAR_HEIGHT,
    },
    // Match the page's dark/light background so there is no white flash before React paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f1f1f' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (settings.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');

  if (devServerUrl) {
    win.loadURL(devServerUrl);
  } else {
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  }

  // External links open in the system browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.once('did-finish-load', () => {
    if (dockOnStartup && process.platform === 'win32') void setDocked(true);
  });
  win.on('move', onDockedWindowChanged);
  win.on('resize', onDockedWindowChanged);

  win.on('close', () => {
    const wasDocked = settings.docked;
    if (wasDocked) {
      // Release the strip but do not record the strip as a window size: the remembered
      // mini bounds must stay the floating ones so undocking later restores them.
      releaseAppBarSync();
      restoreCaptionButtons();
    } else {
      rememberBounds();
    }
    settings.docked = wasDocked; // remember the preference for next launch
    saveSettings();
  });
  win.on('closed', () => {
    win = null;
  });
}

function windowHandle() {
  const buf = win.getNativeWindowHandle();
  return (buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0))).toString();
}

function runAppBar(args) {
  return new Promise((resolve) => {
    execFile(appBarExe, args, { windowsHide: true }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: String(stdout || '').trim(), error: error ? String(stderr || error.message).trim() : '' });
    });
  });
}

function releaseAppBarSync() {
  clearTimeout(dockReassertTimer);
  try {
    execFileSync(appBarExe, ['remove', windowHandle()], { windowsHide: true, timeout: 3000 });
  } catch (error) {
    console.error('Could not release the app bar:', error.message);
  }
  settings.docked = false;
  dockedBounds = null;
  // Caller restores the caption buttons: flipping window styles in the same tick as a resize makes
  // Chromium reapply the old frame bounds afterwards, so that must happen after the resize settles.
}

function restoreCaptionButtons() {
  if (!win || win.isDestroyed()) return;
  win.setMinimizable(true);
  win.setMaximizable(true);
  win.setMovable(true);
}

/** Apply bounds now and once more shortly after, in case a deferred frame update overrides them. */
function placeWindow(bounds, afterwards) {
  if (!win) return;
  win.setBounds(bounds);
  setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    if (b.width !== bounds.width || b.height !== bounds.height) win.setBounds(bounds);
    afterwards?.();
  }, 120);
}

let dockedBounds = null; // DIP bounds the window must keep while docked
let dockApplying = false;
let dockReassertTimer = null;

/** Register (or re-register) the app bar for the window's current width and lock the window to the strip. */
async function applyAppBar() {
  if (!win) return false;
  dockApplying = true;
  try {
    const bounds = win.getBounds();
    const scale = screen.getDisplayMatching(bounds).scaleFactor || 1;
    const width = dockedBounds ? dockedBounds.width : bounds.width;
    const result = await runAppBar(['set', windowHandle(), String(Math.round(width * scale))]);
    console.log('[dock] helper set ->', result.ok ? result.stdout : result.error);
    if (!result.ok) {
      console.error('Docking failed:', result.error);
      return false;
    }
    // The helper prints the strip it reserved (physical pixels). Chromium has not necessarily processed the
    // helper's move yet, so getBounds() would be stale; place the window ourselves from that rect instead.
    const [l, t, w, h] = result.stdout.split(',').map(Number);
    if ([l, t, w, h].some((n) => !Number.isFinite(n))) {
      console.error('Docking failed: unexpected helper output', result.stdout);
      return false;
    }
    const origin = screen.screenToDipPoint({ x: l, y: t });
    const strip = {
      x: Math.round(origin.x),
      y: Math.round(origin.y),
      width: Math.round(w / scale),
      height: Math.round(h / scale),
    };
    // Put the *visible* area exactly on the strip. Windows adds invisible resize borders around the
    // frame; positioning the frame instead would leave a thin gap next to the neighbouring window.
    // No size lock: Chromium's size constraints proved sticky after unlocking, and the re-assert
    // handler already snaps the window back if the user drags or resizes it.
    win.setContentBounds(strip);
    dockedBounds = win.getBounds();
    return true;
  } finally {
    dockApplying = false;
  }
}

/** While docked, anything that nudges the window (snap, drag, DPI change) gets corrected and the strip re-reserved. */
function onDockedWindowChanged() {
  if (!settings.docked || dockApplying || !dockedBounds || !win) return;
  const b = win.getBounds();
  if (b.x === dockedBounds.x && b.y === dockedBounds.y && b.width === dockedBounds.width && b.height === dockedBounds.height) return;
  clearTimeout(dockReassertTimer);
  dockReassertTimer = setTimeout(() => {
    if (!settings.docked) return; // undocked meanwhile
    console.log('[dock] re-asserting after external move/resize', b);
    void applyAppBar();
  }, 250);
}

function unlockSize() {
  if (!win) return;
  const minimum = settings.compact ? COMPACT_MIN : NORMAL_MIN;
  win.setMinimumSize(minimum.width, minimum.height);
}

/** Dock the mini window to the right screen edge as an app bar (reserved space), or release it. */
async function setDocked(flag) {
  if (!win || process.platform !== 'win32') return false;
  if (flag === settings.docked) return settings.docked;
  if (!fs.existsSync(appBarExe)) {
    console.error('App bar helper missing; run `npm run build:appbar`.');
    return settings.docked;
  }

  try {
    if (flag) {
      if (!settings.compact) applyCompact(true);
      rememberBounds();
      if (win.isMaximized()) win.unmaximize();
      // Caption styles first (they nudge the frame); then position and lock on the strip.
      // An app bar neither minimizes nor maximizes; dropping both boxes leaves only Close in the caption.
      win.setMinimizable(false);
      win.setMaximizable(false);
      dockedBounds = null;
      if (!(await applyAppBar())) {
        win.setMinimizable(true);
        win.setMaximizable(true);
        return settings.docked;
      }
      settings.docked = true;
      settings.dockWhenCompact = false;
      win.setMovable(false); // pinned to the edge; the page also drops its drag region
      console.log('[dock] docked', dockedBounds);
    } else {
      // Flag off first: releasing the strip fires resize events that must not re-assert the dock.
      settings.docked = false;
      settings.dockWhenCompact = false; // an explicit undock is the user's choice
      dockedBounds = null;
      clearTimeout(dockReassertTimer);
      const result = await runAppBar(['remove', windowHandle()]);
      clearTimeout(dockReassertTimer);
      console.log('[dock] remove ->', result.ok ? 'ok' : result.error);
      unlockSize();
      const target = onScreen(settings.compactBounds) ?? defaultCompactBounds();
      placeWindow(target, restoreCaptionButtons);
      console.log('[dock] undocked ->', target);
    }
  } catch (error) {
    console.error('[dock] failed:', error);
  }
  saveSettings();
  broadcastState();
  return settings.docked;
}

function rememberBounds() {
  if (!win || settings.docked || win.isMinimized() || win.isMaximized() || win.isFullScreen()) return;
  if (settings.compact) settings.compactBounds = win.getBounds();
  else settings.normalBounds = win.getBounds();
}

function applyCompact(flag) {
  if (!win || flag === settings.compact) return settings.compact;
  // Leaving mini mode releases the reserved strip (never remembered as a size) but keeps the wish to be
  // docked, so coming back to mini mode docks again until the user undocks explicitly.
  const wasDocked = settings.docked;
  if (!flag && wasDocked) {
    releaseAppBarSync();
    settings.dockWhenCompact = true;
  } else {
    rememberBounds();
  }
  if (win.isMaximized()) win.unmaximize();

  settings.compact = flag;
  const minimum = flag ? COMPACT_MIN : NORMAL_MIN;
  win.setMinimumSize(minimum.width, minimum.height);

  const remembered = onScreen(flag ? settings.compactBounds : settings.normalBounds);
  const target = remembered ?? (flag ? defaultCompactBounds() : centeredNormalBounds());
  placeWindow(target, wasDocked ? restoreCaptionButtons : undefined);
  console.log('[mode]', flag ? 'mini' : 'full', 'target', target);
  saveSettings();
  broadcastState();
  if (flag && settings.dockWhenCompact) void setDocked(true);
  return settings.compact;
}

/** Default full-size window, centred on the display the window is currently on. */
function centeredNormalBounds() {
  const current = win ? win.getBounds() : { x: 0, y: 0, width: 1, height: 1 };
  const area = screen.getDisplayMatching(current).workArea;
  const width = Math.min(NORMAL_DEFAULT.width, area.width);
  const height = Math.min(NORMAL_DEFAULT.height, area.height);
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

function windowState() {
  return {
    alwaysOnTop: settings.alwaysOnTop,
    compact: settings.compact,
    docked: settings.docked,
    canDock: process.platform === 'win32' && fs.existsSync(appBarExe),
  };
}

/** Push the current state to the page so the title bar stays right even when the shell changed it (startup dock). */
function broadcastState() {
  if (win && !win.isDestroyed()) win.webContents.send('window:state', windowState());
}

ipcMain.handle('window:get-state', () => windowState());

ipcMain.handle('window:set-docked', (_event, flag) => setDocked(Boolean(flag)));

ipcMain.handle('window:set-always-on-top', (_event, flag) => {
  settings.alwaysOnTop = Boolean(flag);
  if (win) win.setAlwaysOnTop(settings.alwaysOnTop, 'floating');
  saveSettings();
  return settings.alwaysOnTop;
});

ipcMain.handle('window:set-compact', (_event, flag) => applyCompact(Boolean(flag)));

ipcMain.handle('window:set-title-bar-theme', (_event, theme) => {
  const colors = TITLE_BAR_COLORS[theme === 'dark' ? 'dark' : 'light'];
  if (win && typeof win.setTitleBarOverlay === 'function') {
    win.setTitleBarOverlay({ ...colors, height: TITLE_BAR_HEIGHT });
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
