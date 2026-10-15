// Exposed by desktop/preload.cjs when running inside Electron; absent in a plain browser.
interface Window {
  mytodoease?: {
    platform: string;
    isDesktop: boolean;
  };
}
