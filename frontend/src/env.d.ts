/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** 'firebase' for the hosted web app; anything else means the local REST API. */
  readonly VITE_BACKEND?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  /** Landing page download links; a button is shown as "coming soon" when its URL is empty. */
  readonly VITE_DOWNLOAD_WINDOWS_URL?: string;
  readonly VITE_DOWNLOAD_MAC_URL?: string;
  /** '1' connects to the local Auth and Firestore emulators. */
  readonly VITE_FIREBASE_EMULATOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
