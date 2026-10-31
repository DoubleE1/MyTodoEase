const { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeTheme, screen, shell, Tray } = require('electron');
const { execFile, execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// The app used to be called MyTodoEase. Electron derives its user-data folder from the product name, so carry the
// old folder (window settings, the signed-in cloud session, Firestore cache) over once instead of starting empty.
// Must run before anything touches userData, i.e. before app is ready.
try {
  const appData = app.getPath('appData');
  const oldDir = path.join(appData, 'MyTodoEase');
  const newDir = path.join(appData, 'TodoEase');
  if (!fs.existsSync(newDir) && fs.existsSync(oldDir)) fs.renameSync(oldDir, newDir);
} catch (error) {
  console.error('Could not carry over the MyTodoEase user-data folder:', error);
}

// Bundled native pieces live under desktop/build in development and under resources/ when packaged.
const resourcesDir = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'build');
const APP_ICON = path.join(__dirname, 'build', 'icon.ico');

// One taskbar button for the whole app: every window (main, sticky notes) and the installer's Start menu and
// pinned shortcuts share this ID (electron-builder's appId), so Windows stacks them under one TodoEase icon.
if (process.platform === 'win32') app.setAppUserModelId('com.mytodoease.desktop');
const QUICK_ADD_SIZE = { width: 600, height: 240 };

// One TodoEase at a time: with "Start with Windows" it is often already running in the tray, so opening it
// again just brings that window up. Development runs skip the lock so they can run beside the installed app.
if (app.isPackaged && !app.requestSingleInstanceLock()) {
  app.exit(0);
}
app.on('second-instance', () => showMainWindow());

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
  // Sticky notes popped out into their own windows: which are open (reopened on the next start) and where each sat.
  openNotes: [],
  noteBounds: {},
  // Closing the window keeps the app in the notification area, so the global shortcuts keep working.
  keepInTray: true,
  // Global shortcuts (Electron accelerators); null turns one off.
  globalHotkeys: { newTask: 'Control+Alt+T', newNote: 'Control+Alt+N' },
  ...loadSettings(),
};
settings.globalHotkeys = { newTask: 'Control+Alt+T', newNote: 'Control+Alt+N', ...settings.globalHotkeys };

// Started by Windows at sign-in ("Start with Windows"): stay in the tray until the user opens the window.
const startHidden = process.argv.includes('--hidden') && settings.keepInTray;
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

/**
 * Default placement for the mini window: top-right corner of the work area of the screen the window is on
 * (the primary screen before there is a window), so undocking on a second screen stays on that screen.
 */
function defaultCompactBounds() {
  const area = (win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()).workArea;
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

// The app's own light/dark choice (sent by the page with the title bar colours), which can differ from Windows'.
// New windows start in that colour, so a note or the quick-add box never flashes white while it loads.
let appTheme = settings.appTheme === 'dark' || settings.appTheme === 'light' ? settings.appTheme : null;
function windowBackground() {
  const dark = appTheme ? appTheme === 'dark' : nativeTheme.shouldUseDarkColors;
  return dark ? '#1f1f1f' : '#ffffff';
}

function createWindow({ show = true } = {}) {
  const compact = settings.compact;
  const minimum = compact ? COMPACT_MIN : NORMAL_MIN;
  const remembered = onScreen(compact ? settings.compactBounds : settings.normalBounds);
  const bounds = remembered ?? (compact ? defaultCompactBounds() : NORMAL_DEFAULT);

  win = new BrowserWindow({
    ...bounds,
    minWidth: minimum.width,
    minHeight: minimum.height,
    title: 'TodoEase',
    icon: APP_ICON,
    show,
    autoHideMenuBar: true,
    alwaysOnTop: settings.alwaysOnTop,
    // Window Controls Overlay: the page draws the title bar (see TitleBar.tsx); the OS keeps its buttons.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      ...TITLE_BAR_COLORS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'],
      height: TITLE_BAR_HEIGHT,
    },
    // Match the page's dark/light background so there is no white flash before React paints.
    backgroundColor: windowBackground(),
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

  // External links (e.g. in task descriptions) open in the system browser, never inside the app window.
  // Only web and mail links are handed over; anything else (file:, custom protocols) is dropped.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol } = new URL(url);
      if (protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:') void shell.openExternal(url);
    } catch {
      // Not a valid URL: ignore it.
    }
    return { action: 'deny' };
  });

  win.webContents.once('did-finish-load', () => {
    if (!dockOnStartup || process.platform !== 'win32') return;
    // A hidden start must not reserve a strip for a window nobody can see; it docks when first shown.
    if (win.isVisible()) void setDocked(true);
    else redockOnShow = true;
  });
  win.on('move', onDockedWindowChanged);
  win.on('resize', onDockedWindowChanged);
  // Mini mode is a narrow column; asking for the whole screen means the full app, maximized.
  win.on('maximize', () => {
    if (settings.compact && !settings.docked) applyCompact(false, { maximize: true });
  });

  win.on('close', (event) => {
    // Keep running in the tray: the close button hides the window; Quit (tray menu) or an update really closes it.
    if (settings.keepInTray && tray && !quitting) {
      event.preventDefault();
      hideMainWindow();
      return;
    }
    const wasDocked = settings.docked;
    if (wasDocked) {
      // Release the strip but do not record the strip as a window size: the remembered
      // mini bounds must stay the floating ones so undocking later restores them.
      releaseAppBarSync();
      restoreCaptionButtons();
    } else {
      rememberBounds();
    }
    // remember the preference for next launch (hidden in the tray while docked counts as docked)
    settings.docked = wasDocked || redockOnShow;
    saveSettings();
  });
  win.on('closed', () => {
    win = null;
    closeHelpersIfAlone();
  });
}

// ---------- Sticky notes in their own windows ----------

const NOTE_DEFAULT = { width: 320, height: 320 };
const noteWindows = new Map(); // note id -> BrowserWindow

/** First spot for a new note window: beside the main window, stepped so several do not stack exactly. */
function defaultNoteBounds() {
  const anchor = win && !win.isDestroyed() ? win.getBounds() : null;
  const area = (anchor ? screen.getDisplayMatching(anchor) : screen.getPrimaryDisplay()).workArea;
  const step = 28 * (noteWindows.size % 8);
  const leftOfMain = anchor ? anchor.x - NOTE_DEFAULT.width - 12 : area.x + area.width - NOTE_DEFAULT.width - 40;
  const x = Math.max(area.x + 8, Math.min(leftOfMain - step, area.x + area.width - NOTE_DEFAULT.width - 8));
  const y = Math.max(area.y + 8, Math.min((anchor ? anchor.y : area.y + 40) + step, area.y + area.height - NOTE_DEFAULT.height - 8));
  return { ...NOTE_DEFAULT, x, y };
}

function rememberOpenNotes() {
  settings.openNotes = [...noteWindows.keys()];
  saveSettings();
}

/** A frameless note window, hidden until its page says the note is on screen ('note:ready'). */
function makeNoteWindow(bounds, hash) {
  const note = new BrowserWindow({
    ...bounds,
    minWidth: 220,
    minHeight: 180,
    frame: false,
    show: false,
    title: 'Sticky note',
    icon: APP_ICON,
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (devServerUrl) note.loadURL(`${devServerUrl}#${hash}`);
  else note.loadFile(path.join(__dirname, 'renderer', 'index.html'), { hash });
  note.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const { protocol } = new URL(url);
      if (protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:') void shell.openExternal(url);
    } catch {
      // Not a valid URL: ignore it.
    }
    return { action: 'deny' };
  });
  return note;
}

/** Show a note window that has drawn its note; one made with the global shortcut also takes the focus. */
function revealNoteWindow(note) {
  if (note.isDestroyed() || note.isVisible()) return;
  if (Date.now() - newNoteRequestedAt < 5000) bringToFront(note);
  else note.show();
}

// A spare note window, loaded in the background (#note-spare) and handed the next note to open, so a new note
// appears at once instead of after a page load. Kept only while the "New sticky note" shortcut is on.
// Notes asked for while the spare is still loading wait for it, so only one note page loads at a time even when
// the shortcut is pressed over and over; a fresh spare starts loading as soon as one is used.
let spareNote = null;
/** The spare's page is listening for its note ('note:spare-ready'). */
let spareNoteReady = false;
/** Notes waiting for the spare, oldest first. */
const waitingForSpare = [];
const SPARE_WAIT_MS = 8000;

function prepareSpareNote() {
  if (spareNote || quitting || !settings.globalHotkeys.newNote) return;
  const spare = makeNoteWindow({ ...NOTE_DEFAULT, x: 0, y: 0 }, 'note-spare');
  spareNote = spare;
  spareNoteReady = false;
  spare.on('closed', () => {
    if (spareNote === spare) spareNote = null;
  });
}

ipcMain.on('note:spare-ready', (event) => {
  if (!spareNote || spareNote.isDestroyed() || event.sender !== spareNote.webContents) return;
  spareNoteReady = true;
  const next = waitingForSpare.shift();
  if (next) openNoteWindow(next);
});

function dropSpareNote() {
  const spare = spareNote;
  spareNote = null;
  spareNoteReady = false;
  // Anything still waiting for it opens on its own.
  for (const id of waitingForSpare.splice(0)) setTimeout(() => openNoteWindow(id), 0);
  if (spare && !spare.isDestroyed()) spare.destroy();
}

/** Open a sticky note in its own small frameless window (or bring it forward if it is already open). */
function openNoteWindow(id) {
  if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) return;
  const existing = noteWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return;
  }
  if (waitingForSpare.includes(id)) return;
  // The spare is still loading: wait for it rather than load a second page alongside (see 'note:spare-ready').
  // Should it never get ready, the note opens in a window of its own after a while.
  if (spareNote && !spareNote.isDestroyed() && !spareNoteReady) {
    waitingForSpare.push(id);
    setTimeout(() => {
      const index = waitingForSpare.indexOf(id);
      if (index < 0) return;
      waitingForSpare.splice(index, 1);
      openNoteWindow(id);
    }, SPARE_WAIT_MS);
    return;
  }
  const bounds = onScreen(settings.noteBounds?.[id]) ?? defaultNoteBounds();
  let note;
  if (spareNote && !spareNote.isDestroyed() && spareNoteReady) {
    note = spareNote;
    spareNote = null;
    spareNoteReady = false;
    note.setBounds(bounds);
    note.webContents.send('note:assign', id);
    prepareSpareNote();
  } else {
    note = makeNoteWindow(bounds, `note=${id}`);
  }
  noteWindows.set(id, note);
  rememberOpenNotes();
  // Normally the page reports 'note:ready'; this is only a fallback so a slow page never stays invisible.
  setTimeout(() => revealNoteWindow(note), 2500);

  let saveTimer = null;
  const saveBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (note.isDestroyed() || note.isMinimized()) return;
      settings.noteBounds = { ...settings.noteBounds, [id]: note.getBounds() };
      saveSettings();
    }, 400);
  };
  note.on('move', saveBounds);
  note.on('resize', saveBounds);
  note.on('closed', () => {
    clearTimeout(saveTimer);
    noteWindows.delete(id);
    // Closing a note forgets it; quitting the app keeps the list, so those notes come back next time.
    if (!quitting) rememberOpenNotes();
    closeHelpersIfAlone();
  });
}

/**
 * The spare note and the quick-add popup are hidden helpers; once the main window and every note are closed
 * (background mode off), they go too so the app can quit.
 */
function closeHelpersIfAlone() {
  if ((win && !win.isDestroyed()) || noteWindows.size > 0) return;
  dropSpareNote();
  if (quickAddWindow && !quickAddWindow.isDestroyed()) quickAddWindow.destroy();
}

/** Bring the main window up again, recreating it if it was closed while notes stayed open. */
function showMainWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  bringToFront(win);
  if (redockOnShow) {
    redockOnShow = false;
    void setDocked(true);
  }
}

/** Hide the main window to the tray. A docked window gives its strip back first and docks again when shown. */
function hideMainWindow() {
  if (!win || win.isDestroyed()) return;
  if (settings.docked) {
    releaseAppBarSync();
    restoreCaptionButtons();
    redockOnShow = true;
  } else {
    rememberBounds();
  }
  saveSettings();
  win.hide();
}

/**
 * Show and focus a window even when another app is in front. Windows only lets the foreground app take the
 * focus; briefly raising the window above everything gets it there after a global shortcut or tray click.
 */
function bringToFront(target) {
  if (!target || target.isDestroyed()) return;
  const wasOnTop = target.isAlwaysOnTop();
  if (!wasOnTop) target.setAlwaysOnTop(true);
  target.show();
  target.focus();
  if (!wasOnTop) target.setAlwaysOnTop(false);
}

let redockOnShow = false;

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
    // The helper docks on the screen nearest the window's centre; use that screen's scaling for the width.
    const centre = { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) };
    const scale = screen.getDisplayNearestPoint(centre).scaleFactor || 1;
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
    // Convert with the scaling of the screen the strip is on (it can differ from the main screen's).
    const dip = screen.screenToDipRect(null, { x: l, y: t, width: w, height: h });
    const strip = {
      x: Math.round(dip.x),
      y: Math.round(dip.y),
      width: Math.round(dip.width),
      height: Math.round(dip.height),
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

/** `maximize`: end maximized in the new mode (used when the mini window's maximize button asks for the full app). */
function applyCompact(flag, { maximize = false } = {}) {
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
  // Maximize only after placeWindow has re-applied the bounds, or that second setBounds would undo it.
  placeWindow(target, () => {
    if (wasDocked) restoreCaptionButtons();
    if (maximize) win.maximize();
  });
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

ipcMain.handle('note:open', (_event, id) => openNoteWindow(String(id)));
ipcMain.handle('app:show-main', () => showMainWindow());
// A window changed notes: every other window refetches (the main app, the mini list, other note windows).
ipcMain.on('notes:changed', (event) => {
  for (const other of BrowserWindow.getAllWindows()) {
    if (!other.isDestroyed() && other.webContents !== event.sender) other.webContents.send('notes:changed');
  }
});

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
  const next = theme === 'dark' ? 'dark' : 'light';
  if (next !== appTheme) {
    appTheme = next;
    settings.appTheme = next;
    saveSettings();
    // The windows waiting in the background take the new colour too.
    for (const helper of [spareNote, quickAddWindow]) {
      if (helper && !helper.isDestroyed()) helper.setBackgroundColor(windowBackground());
    }
  }
});

// A note window's page has its note on screen: show the window now (no blank frame first).
ipcMain.on('note:ready', (event) => {
  const note = BrowserWindow.fromWebContents(event.sender);
  if (note && note !== spareNote) revealNoteWindow(note);
});

// ---------------------------------------------------------------------------------------------------------
// Background mode: start with Windows, the tray icon, and global shortcuts (Settings > Desktop app).
// With "Keep running in the background" on, closing the window hides it to the notification area so the
// shortcuts keep working; "Start with Windows" launches the app hidden there (--hidden) at sign-in.
// ---------------------------------------------------------------------------------------------------------
let tray = null;
/** Tray menu labels in the app's language; the page sends them once it has loaded (English until then). */
const trayLabels = { open: 'Open TodoEase', newTask: 'New task', newNote: 'New sticky note', quit: 'Quit TodoEase' };
/** Shortcuts the system refused (another app holds them), by action. */
let hotkeyErrors = {};
let newNoteRequestedAt = 0;
let pendingNewNote = false;
let quickAddWindow = null;
/** Last height the popup's content asked for; the first showing guesses. */
let quickAddHeight = QUICK_ADD_SIZE.height;

function updateTray() {
  if (!settings.keepInTray) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (!tray) {
    tray = new Tray(APP_ICON);
    tray.setToolTip('TodoEase');
    tray.on('click', () => showMainWindow());
  }
  const hotkeys = settings.globalHotkeys;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: trayLabels.open, click: () => showMainWindow() },
      { type: 'separator' },
      { label: trayLabels.newTask, accelerator: hotkeys.newTask || undefined, registerAccelerator: false, click: () => openQuickAdd() },
      { label: trayLabels.newNote, accelerator: hotkeys.newNote || undefined, registerAccelerator: false, click: () => requestNewNote() },
      { type: 'separator' },
      { label: trayLabels.quit, click: () => app.quit() },
    ]),
  );
}

const HOTKEY_ACTIONS = { newTask: () => openQuickAdd(), newNote: () => requestNewNote() };

// Dev aid: MYTODOEASE_DEV_HOTKEYS='{"newTask":"Control+Alt+F9"}' registers other keys for this run only (never saved),
// so a development copy can be tried while the installed app holds the real shortcuts.
const devHotkeys = (() => {
  try {
    return process.env.MYTODOEASE_DEV_HOTKEYS ? JSON.parse(process.env.MYTODOEASE_DEV_HOTKEYS) : {};
  } catch {
    return {};
  }
})();

/** (Re)register every global shortcut; remembers which ones another app already holds. */
function registerGlobalHotkeys() {
  globalShortcut.unregisterAll();
  hotkeyErrors = {};
  for (const [action, run] of Object.entries(HOTKEY_ACTIONS)) {
    const accelerator = devHotkeys[action] ?? settings.globalHotkeys[action];
    if (!accelerator) continue;
    let ok = false;
    try {
      ok = globalShortcut.register(accelerator, run);
    } catch (error) {
      console.error('[hotkey] invalid shortcut', accelerator, error.message);
    }
    if (!ok) hotkeyErrors[action] = true;
  }
}

/**
 * The quick-add popup: a small frameless window over everything, made on first use and then kept hidden
 * between uses so the shortcut opens it at once. It loads the app page with #quick-add.
 */
function openQuickAdd({ show = true } = {}) {
  const cursor = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(cursor).workArea;
  const width = Math.min(QUICK_ADD_SIZE.width, area.width - 32);
  const bounds = {
    width,
    height: quickAddHeight,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + area.height * 0.18),
  };
  if (quickAddWindow && !quickAddWindow.isDestroyed()) {
    if (!show) return;
    quickAddWindow.setContentBounds(bounds);
    quickAddWindow.webContents.send('quick-add:shown');
    bringToFront(quickAddWindow);
    return;
  }
  quickAddWindow = new BrowserWindow({
    ...bounds,
    // The size is the page's: a frameless window on Windows otherwise loses its invisible borders from it.
    useContentSize: true,
    frame: false,
    // Resizable on purpose: a frameless window that cannot be resized comes out smaller than asked on Windows.
    minWidth: 420,
    minHeight: 120,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: 'New task',
    icon: APP_ICON,
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (devServerUrl) quickAddWindow.loadURL(`${devServerUrl}#quick-add`);
  else quickAddWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'), { hash: 'quick-add' });
  if (show) quickAddWindow.once('ready-to-show', () => bringToFront(quickAddWindow));
  // Clicking anywhere else puts it away, like a launcher.
  quickAddWindow.on('blur', () => quickAddWindow?.hide());
  quickAddWindow.on('closed', () => {
    quickAddWindow = null;
  });
}

/** New sticky note: the main window's page creates it (it knows local vs cloud) and pops it out. */
function requestNewNote() {
  // Holding the keys repeats the shortcut many times a second; one note per 0.4 s is plenty.
  if (Date.now() - newNoteRequestedAt < 400) return;
  newNoteRequestedAt = Date.now();
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
    win.webContents.send('quick:new-note');
    return;
  }
  // No page to ask yet: it picks the request up when it subscribes (see 'quick:take-pending-note').
  pendingNewNote = true;
  if (!win || win.isDestroyed()) createWindow({ show: false });
}

function loginItem() {
  const state = app.getLoginItemSettings({ args: ['--hidden'] });
  return { openAtLogin: state.openAtLogin, blockedByWindows: state.openAtLogin && state.executableWillLaunchAtLogin === false };
}

function desktopPrefs() {
  const login = app.isPackaged ? loginItem() : { openAtLogin: false, blockedByWindows: false };
  return {
    // Only the installed app can register itself; a development run would register electron.exe.
    startWithWindowsAvailable: app.isPackaged && process.platform === 'win32',
    startWithWindows: login.openAtLogin,
    startupBlockedByWindows: login.blockedByWindows,
    keepInTray: settings.keepInTray,
    hotkeys: { ...settings.globalHotkeys },
    hotkeyErrors: { ...hotkeyErrors },
  };
}

const ACCELERATOR = /^((Control|Alt|Shift)\+){1,3}([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Space|Up|Down|Left|Right|[`\-=[\]\\;',./])$/;

ipcMain.handle('desktop:get-prefs', () => desktopPrefs());
ipcMain.handle('desktop:set-prefs', (_event, patch) => {
  if (patch && typeof patch === 'object') {
    if (typeof patch.startWithWindows === 'boolean' && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: patch.startWithWindows, args: ['--hidden'] });
    }
    if (typeof patch.keepInTray === 'boolean') {
      settings.keepInTray = patch.keepInTray;
      updateTray();
    }
    if (patch.hotkeys && typeof patch.hotkeys === 'object') {
      for (const action of Object.keys(HOTKEY_ACTIONS)) {
        if (!(action in patch.hotkeys)) continue;
        const value = patch.hotkeys[action];
        if (value === null || (typeof value === 'string' && ACCELERATOR.test(value))) settings.globalHotkeys[action] = value;
      }
      registerGlobalHotkeys();
      updateTray();
      if (settings.globalHotkeys.newNote) prepareSpareNote();
      else dropSpareNote();
    }
    saveSettings();
  }
  return desktopPrefs();
});
ipcMain.handle('desktop:set-tray-labels', (_event, labels) => {
  if (!labels || typeof labels !== 'object') return;
  for (const key of Object.keys(trayLabels)) {
    if (typeof labels[key] === 'string' && labels[key].length <= 60) trayLabels[key] = labels[key];
  }
  updateTray();
});
ipcMain.handle('quick-add:close', () => quickAddWindow?.hide());
// The popup's page reports how tall its content is (taller while a date or label picker is open).
ipcMain.handle('quick-add:resize', (_event, height) => {
  if (!quickAddWindow || quickAddWindow.isDestroyed() || !Number.isFinite(height)) return;
  quickAddHeight = Math.max(120, Math.min(720, Math.round(height)));
  const [width] = quickAddWindow.getContentSize();
  quickAddWindow.setContentSize(width, quickAddHeight);
});
ipcMain.handle('quick:take-pending-note', () => {
  const pending = pendingNewNote;
  pendingNewNote = false;
  return pending;
});
// A window changed tasks (the quick-add popup): the others refetch.
ipcMain.on('tasks:changed', (event) => {
  for (const other of BrowserWindow.getAllWindows()) {
    if (!other.isDestroyed() && other.webContents !== event.sender) other.webContents.send('tasks:changed');
  }
});

app.whenReady().then(async () => {
  if (app.isPackaged) {
    const ok = await ensureApi();
    if (!ok) {
      dialog.showErrorBox(
        'TodoEase could not start its service',
        `The task service did not respond at ${API_URL}.\n\nAnother program may be using that port, or the service failed to start. ` +
          'Close the app and open it again; the window will keep retrying meanwhile.',
      );
    }
  }
  createWindow({ show: !startHidden });
  updateTray();
  registerGlobalHotkeys();
  // Load the shortcut windows in the background once the app has settled, so the first press is instant too.
  setTimeout(() => {
    if (settings.globalHotkeys.newTask) openQuickAdd({ show: false });
    prepareSpareNote();
  }, 4000);
  // Notes that were open in their own windows at the last quit come back.
  // One after another, so a dozen restored notes do not all load at the same moment.
  const restore = Array.isArray(settings.openNotes) ? [...settings.openNotes] : [];
  restore.forEach((id, i) => setTimeout(() => openNoteWindow(id), i * 350));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // A screen plugged in, unplugged, rescaled or resized while docked: fit the strip to its screen again.
  // Windows moves the window off a screen that goes away, so this also re-docks it on the screen it lands on.
  const refitDock = () => {
    if (!settings.docked) return;
    clearTimeout(dockReassertTimer);
    dockReassertTimer = setTimeout(() => {
      if (settings.docked) void applyAppBar();
    }, 500);
  };
  screen.on('display-added', refitDock);
  screen.on('display-removed', refitDock);
  screen.on('display-metrics-changed', refitDock);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let apiStopped = false;
app.on('will-quit', (event) => {
  globalShortcut.unregisterAll();
  if (apiStopped) return;
  // Hold the quit until the API has been asked to shut down and has exited (or timed out).
  event.preventDefault();
  stopApi().finally(() => {
    apiStopped = true;
    app.quit();
  });
});

// Open a link in the system browser (Google sign-in and consent pages). Only https links to Google hosts are allowed.
ipcMain.handle('shell:open-external', async (_event, url) => {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return false;
  }
  const allowed = parsed.protocol === 'https:' && /(^|\.)google\.com$/.test(parsed.hostname);
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

// The clipboard's text (Paste as note): read here, where no permission prompt applies.
ipcMain.handle('clipboard:read-text', () => clipboard.readText());

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

// ---------------------------------------------------------------------------------------------------------
// Automatic updates (electron-updater, fed by GitHub Releases: desktop/package.json "build.publish").
// Once per launch the installed app checks for a newer release in the background and downloads it silently;
// nothing is installed until the user clicks "Restart to update" (no install on a plain quit either). Offline
// or with GitHub unreachable the check fails quietly: the state carries the error for Settings > About, but
// nothing pops up. In a development run electron-updater is a no-op (there is no app-update.yml), logged only.
// ---------------------------------------------------------------------------------------------------------
const { autoUpdater } = require('electron-updater');

/** Mirrored to the page over 'update:state'. status: idle | checking | up-to-date | downloading | ready | error | unavailable */
const updateState = {
  status: app.isPackaged ? 'idle' : 'unavailable',
  currentVersion: app.getVersion(),
  version: null, // the newer version once one is known
  progress: 0, // download percentage
  error: null,
};
let quitting = false;

function setUpdateState(patch) {
  Object.assign(updateState, patch);
  if (win && !win.isDestroyed()) win.webContents.send('update:state', { ...updateState });
}

/** Short, user-facing reason; the full error goes to the log. */
function updateErrorMessage(error) {
  const text = String(error?.message ?? error ?? 'Unknown error');
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|net::ERR_|ERR_INTERNET_DISCONNECTED|socket hang up/i.test(text)) {
    return 'Could not reach the update server. Check your connection and try again.';
  }
  if (/latest\.yml|HttpError: 404|status code 404/i.test(text)) {
    return 'No update information has been published for the latest release yet.';
  }
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false; // only on the user's explicit "Restart to update"
autoUpdater.logger = {
  info: (message) => console.log('[update]', message),
  warn: (message) => console.warn('[update]', message),
  error: (message) => console.error('[update]', message),
  debug: () => {},
};

autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking', error: null }));
autoUpdater.on('update-available', (info) => setUpdateState({ status: 'downloading', version: info.version, progress: 0, error: null }));
autoUpdater.on('update-not-available', () => setUpdateState({ status: 'up-to-date', version: null, progress: 0, error: null }));
autoUpdater.on('download-progress', (progress) => setUpdateState({ status: 'downloading', progress: Math.round(progress.percent) }));
autoUpdater.on('update-downloaded', (info) => setUpdateState({ status: 'ready', version: info.version, progress: 100, error: null }));
autoUpdater.on('error', (error) => {
  console.error('[update] failed:', error);
  if (updateState.status === 'ready') return; // a downloaded update stays installable
  setUpdateState({ status: 'error', error: updateErrorMessage(error), progress: 0 });
});

/** Ask GitHub for a newer release; resolves to the state reached so far (the download continues in the background). */
async function checkForUpdates() {
  if (!app.isPackaged) {
    console.log('[update] skipped: not a packaged build (electron-updater is a no-op in development)');
    return { ...updateState };
  }
  if (['checking', 'downloading', 'ready'].includes(updateState.status)) return { ...updateState };
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    // Also reported through the 'error' event above; this keeps a rejected promise from going unhandled.
    console.error('[update] check failed:', error?.message ?? error);
    if (updateState.status !== 'ready') setUpdateState({ status: 'error', error: updateErrorMessage(error), progress: 0 });
  }
  return { ...updateState };
}

app.on('before-quit', () => {
  quitting = true;
});

app.whenReady().then(() => {
  // Background work: give the window a few seconds to load first. Once per start, no retries, no nagging.
  setTimeout(() => void checkForUpdates(), 5000);
});

ipcMain.handle('update:get-state', () => ({ ...updateState }));
ipcMain.handle('update:check', () => checkForUpdates());

// "Restart to update": stop the bundled API first, exactly as a normal quit does (so LiteDB flushes and the
// installer can replace resources/api), then hand over to the silently running installer, which relaunches the app.
ipcMain.handle('update:install', async () => {
  if (updateState.status !== 'ready') return false;
  await stopApi();
  apiStopped = true; // will-quit must not hold the quit again
  autoUpdater.quitAndInstall(true, true);
  setTimeout(() => {
    if (quitting) return;
    // The installer could not be started (electron-updater reported it on 'error'); bring the API back so the app keeps working.
    console.error('[update] install did not start; restarting the API');
    apiStopped = false;
    void ensureApi();
    if (updateState.status === 'ready') setUpdateState({ status: 'error', error: 'The update could not be installed. Try again later.' });
  }, 5000);
  return true;
});
