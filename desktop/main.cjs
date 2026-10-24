const { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, screen, shell } = require('electron');
const { execFile, execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Bundled native pieces live under desktop/build in development and under resources/ when packaged.
const resourcesDir = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'build');

// Windows "app bar" helper (desktop/appbar): reserves a strip of the screen for the mini window so
// maximized apps stop at its edge instead of covering it. Built by `npm run build:appbar`.
const appBarExe = path.join(resourcesDir, 'appbar', 'MyTodoEase.AppBar.exe');

// The ASP.NET Core API, published self-contained by `npm run build:api`. In development it is run
// separately (`npm run api`); the packaged app starts and stops it itself.
const apiExe = path.join(resourcesDir, 'api', 'MyTodoEase.Api.exe');
const API_URL = process.env.MYTODOEASE_API_URL || 'http://localhost:5080';
let apiProcess = null;

async function apiHealthy() {
  try {
    const response = await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Start the bundled API unless one is already answering on the port; resolves once it is healthy. */
async function ensureApi() {
  if (await apiHealthy()) return true;
  if (!fs.existsSync(apiExe)) {
    console.error('API executable missing:', apiExe);
    return false;
  }
  apiProcess = spawn(apiExe, [], {
    cwd: path.dirname(apiExe),
    env: { ...process.env, ASPNETCORE_URLS: API_URL, ASPNETCORE_ENVIRONMENT: 'Production' },
    windowsHide: true,
    stdio: 'ignore',
  });
  apiProcess.on('exit', (code) => {
    console.error('API process exited with code', code);
    apiProcess = null;
  });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await apiHealthy()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

/**
 * Stop the bundled API gracefully: ask it to shut down (so LiteDB flushes its write-ahead log),
 * wait briefly for the process to exit, and only then fall back to killing it.
 */
async function stopApi() {
  const proc = apiProcess;
  apiProcess = null;
  if (!proc || proc.exitCode !== null || proc.killed) return;
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  try {
    await fetch(`${API_URL}/api/shutdown`, { method: 'POST', signal: AbortSignal.timeout(1000) });
  } catch {
    // Not reachable: fall through to the timeout and kill below.
  }
  const result = await Promise.race([exited.then(() => 'exited'), new Promise((r) => setTimeout(() => r('timeout'), 5000))]);
  if (result === 'timeout') {
    try {
      proc.kill();
    } catch (error) {
      console.error('Could not stop the API process:', error);
    }
  }
}

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
  light: { color: '#f7f7fb', symbolColor: '#202020' },
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

app.whenReady().then(async () => {
  if (app.isPackaged) {
    const ok = await ensureApi();
    if (!ok) {
      dialog.showErrorBox(
        'MyTodoEase could not start its service',
        `The task service did not respond at ${API_URL}.\n\nAnother program may be using that port, or the service failed to start. ` +
          'Close the app and open it again; the window will keep retrying meanwhile.',
      );
    }
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let apiStopped = false;
app.on('will-quit', (event) => {
  if (apiStopped) return;
  // Hold the quit until the API has been asked to shut down and has exited (or timed out).
  event.preventDefault();
  stopApi().finally(() => {
    apiStopped = true;
    app.quit();
  });
});

// Open a link in the system browser: Google consent pages, and the local API's sign-in page for cloud sync
// (http://localhost:<port>/api/auth/firebase/page, which runs the Firebase Google popup the window itself cannot).
ipcMain.handle('shell:open-external', async (_event, url) => {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return false;
  }
  const apiHost = new URL(API_URL).hostname;
  const loopback = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', apiHost].includes(parsed.hostname);
  const allowed = loopback || (parsed.protocol === 'https:' && /(^|\.)google\.com$/.test(parsed.hostname));
  if (!allowed) return false;
  await shell.openExternal(parsed.toString());
  return true;
});

// How an AI client should launch the bundled MCP server. Packaged builds run the bundled script through
// this very executable in Node mode (ELECTRON_RUN_AS_NODE), so end users need no separate Node install;
// a development checkout points at mcp/dist/index.js with the system node.
ipcMain.handle('mcp:get-setup', () => {
  const env = {};
  if (process.env.MYTODOEASE_API_URL) env.MYTODOEASE_API_URL = process.env.MYTODOEASE_API_URL;
  if (app.isPackaged) {
    const script = path.join(process.resourcesPath, 'mcp', 'index.mjs');
    return {
      available: fs.existsSync(script),
      command: process.execPath,
      args: [script],
      env: { ELECTRON_RUN_AS_NODE: '1', ...env },
    };
  }
  const script = path.join(__dirname, '..', 'mcp', 'dist', 'index.js');
  return { available: fs.existsSync(script), command: 'node', args: [script], env };
});

ipcMain.handle('clipboard:write-text', (_event, text) => {
  clipboard.writeText(String(text));
  return true;
});

// Save text (a backup) where the user chooses. Returns the path, or null when they cancel.
ipcMain.handle('file:save-text', async (_event, { defaultName, content }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win ?? undefined, {
    title: 'Save backup',
    defaultPath: path.join(app.getPath('documents'), String(defaultName || 'backup.json')),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return null;
  await fs.promises.writeFile(filePath, String(content), 'utf8');
  return filePath;
});
