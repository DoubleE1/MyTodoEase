// Exposed by desktop/preload.cjs when running inside Electron; absent in a plain browser.
interface DesktopWindowState {
  alwaysOnTop: boolean;
  compact: boolean;
  /** Mini window reserved as a Windows app bar on the right edge. */
  docked: boolean;
  /** Whether docking is available (Windows with the helper built). */
  canDock: boolean;
}

/** How an MCP client should launch the TodoEase MCP server on this machine. */
interface DesktopMcpSetup {
  /** False when the server script is missing (e.g. a dev checkout that has not run npm run build:mcp). */
  available: boolean;
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** Progress of the desktop app's automatic update, pushed by the shell (electron-updater). */
interface DesktopUpdateState {
  /** 'unavailable' in a development run, where electron-updater does nothing. */
  status: 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'error' | 'unavailable';
  currentVersion: string;
  /** The newer version, once one has been found. */
  version: string | null;
  /** Download percentage while status is 'downloading'. */
  progress: number;
  /** Short reason while status is 'error'. */
  error: string | null;
}

/** Background mode of the desktop app (Settings > Desktop app). Hotkeys are Electron accelerators, e.g. "Control+Alt+T". */
interface DesktopPrefs {
  /** Only the installed app can register itself to start with Windows. */
  startWithWindowsAvailable: boolean;
  startWithWindows: boolean;
  /** Turned on here but switched off in Windows Settings > Apps > Startup. */
  startupBlockedByWindows: boolean;
  keepInTray: boolean;
  hotkeys: { newTask: string | null; newNote: string | null };
  /** Shortcuts another app already holds. */
  hotkeyErrors: { newTask?: boolean; newNote?: boolean };
}

/** App version baked in at build time (frontend/vite.config.ts); the desktop shell reports its own in DesktopUpdateState. */
declare const __APP_VERSION__: string;

interface Window {
  mytodoease?: {
    platform: string;
    isDesktop: boolean;
    getWindowState: () => Promise<DesktopWindowState>;
    setAlwaysOnTop: (flag: boolean) => Promise<boolean>;
    setCompact: (flag: boolean) => Promise<boolean>;
    setDocked: (flag: boolean) => Promise<boolean>;
    /** Subscribe to state pushed by the shell; returns an unsubscribe function. */
    onWindowState?: (callback: (state: DesktopWindowState) => void) => () => void;
    setTitleBarTheme: (theme: 'light' | 'dark') => Promise<void>;
    /** Native save dialog; resolves to the chosen path, or null when cancelled. */
    saveTextFile?: (defaultName: string, content: string) => Promise<string | null>;
    /** Open an https link in the system browser; resolves false when the host refused it. */
    openExternal?: (url: string) => Promise<boolean>;
    getMcpSetup?: () => Promise<DesktopMcpSetup>;
    /** Put text on the system clipboard. */
    copyText?: (text: string) => Promise<boolean>;
    /** The system clipboard's text. */
    readText?: () => Promise<string>;
    getUpdateState?: () => Promise<DesktopUpdateState>;
    /** Ask for a newer release now; resolves with the state reached (a download continues in the background). */
    checkForUpdates?: () => Promise<DesktopUpdateState>;
    /** Quit and install the downloaded update; the installer relaunches the app. False when nothing is ready. */
    installUpdate?: () => Promise<boolean>;
    /** Subscribe to update state pushed by the shell; returns an unsubscribe function. */
    onUpdateState?: (callback: (state: DesktopUpdateState) => void) => () => void;
    /** Pop a sticky note out into its own window (or bring that window forward). */
    openNote?: (id: string) => Promise<void>;
    /** Bring the main TodoEase window up, opening it again if it was closed. */
    showMainWindow?: () => Promise<void>;
    /** Tell the other windows that notes changed. */
    notesChanged?: () => void;
    /** Called when another window changed notes; returns an unsubscribe function. */
    onNotesChanged?: (callback: () => void) => () => void;
    /** Tell the other windows that tasks changed (the quick-add popup). */
    tasksChanged?: () => void;
    onTasksChanged?: (callback: () => void) => () => void;
    getDesktopPrefs?: () => Promise<DesktopPrefs>;
    setDesktopPrefs?: (patch: Partial<Pick<DesktopPrefs, 'startWithWindows' | 'keepInTray'>> & { hotkeys?: Partial<DesktopPrefs['hotkeys']> }) => Promise<DesktopPrefs>;
    /** Tray menu labels in the app's language. */
    setTrayLabels?: (labels: { open: string; newTask: string; newNote: string; quit: string }) => Promise<void>;
    /** The quick-add popup was shown again (reset the form). */
    onQuickAddShown?: (callback: () => void) => () => void;
    closeQuickAdd?: () => Promise<void>;
    /** The popup's content height, so the window fits it. */
    resizeQuickAdd?: (height: number) => Promise<void>;
    /** A note window has its note on screen; the shell shows the window then (no blank frame). */
    noteReady?: () => void;
    /** A spare note window is loaded and listening for its note. */
    noteSpareReady?: () => void;
    /** A spare note window (#note-spare) is handed the note to show. */
    onNoteAssign?: (callback: (id: string) => void) => () => void;
    /** The "new sticky note" global shortcut was pressed. */
    onNewNoteRequest?: (callback: () => void) => () => void;
  };
}
