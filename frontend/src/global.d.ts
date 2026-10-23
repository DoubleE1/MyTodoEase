// Exposed by desktop/preload.cjs when running inside Electron; absent in a plain browser.
interface DesktopWindowState {
  alwaysOnTop: boolean;
  compact: boolean;
  /** Mini window reserved as a Windows app bar on the right edge. */
  docked: boolean;
  /** Whether docking is available (Windows with the helper built). */
  canDock: boolean;
}

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
  };
}
