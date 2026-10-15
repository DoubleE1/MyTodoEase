const { app, BrowserWindow, ipcMain, nativeTheme, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

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
  normalBounds: null,
  compactBounds: null,
  ...loadSettings(),
};

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
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
  return intersects ? bounds : null;
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

  win.on('close', () => {
    rememberBounds();
    saveSettings();
  });
  win.on('closed', () => {
    win = null;
  });
}

function rememberBounds() {
  if (!win || win.isMinimized() || win.isMaximized() || win.isFullScreen()) return;
  if (settings.compact) settings.compactBounds = win.getBounds();
  else settings.normalBounds = win.getBounds();
}

function applyCompact(flag) {
  if (!win || flag === settings.compact) return settings.compact;
  rememberBounds();
  if (win.isMaximized()) win.unmaximize();

  settings.compact = flag;
  const minimum = flag ? COMPACT_MIN : NORMAL_MIN;
  win.setMinimumSize(minimum.width, minimum.height);

  const remembered = onScreen(flag ? settings.compactBounds : settings.normalBounds);
  if (remembered) {
    win.setBounds(remembered);
  } else if (flag) {
    win.setBounds(defaultCompactBounds());
  } else {
    win.setSize(NORMAL_DEFAULT.width, NORMAL_DEFAULT.height);
    win.center();
  }
  saveSettings();
  return settings.compact;
}

ipcMain.handle('window:get-state', () => ({ alwaysOnTop: settings.alwaysOnTop, compact: settings.compact }));

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
