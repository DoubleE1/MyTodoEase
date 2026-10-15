// Exposed by desktop/preload.cjs when running inside Electron; absent in a plain browser.
interface DesktopWindowState {
  alwaysOnTop: boolean;
  compact: boolean;
}

interface Window {
  mytodoease?: {
    platform: string;
    isDesktop: boolean;
    getWindowState: () => Promise<DesktopWindowState>;
    setAlwaysOnTop: (flag: boolean) => Promise<boolean>;
    setCompact: (flag: boolean) => Promise<boolean>;
    setTitleBarTheme: (theme: 'light' | 'dark') => Promise<void>;
  };
}
