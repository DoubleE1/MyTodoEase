/**
 * Firebase bootstrap, shared by the hosted web app and the desktop renderer (which uses it once the user
 * signs in for cloud sync). Config comes from VITE_FIREBASE_* (frontend/.env); these values are public
 * identifiers, not secrets: access is enforced by Firestore rules and Firebase Auth.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  /** Cloud Functions (Google Calendar sync), deployed next to the Firestore database. */
  functions: Functions;
  projectId: string;
}

/** Must match setGlobalOptions in functions/src/index.ts. */
export const FUNCTIONS_REGION = 'asia-southeast1';

let services: FirebaseServices | undefined;

export function firebase(): FirebaseServices {
  if (services) return services;
  const env = import.meta.env;
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
  if (!config.apiKey || !config.projectId || !config.appId) {
    throw new Error('Firebase is not configured. Fill in the VITE_FIREBASE_* values in frontend/.env with your Firebase web app config.');
  }
  const app = initializeApp(config);
  // Offline cache shared across tabs: the app keeps working without a connection and syncs when back.
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  const auth = getAuth(app);
  const functions = getFunctions(app, FUNCTIONS_REGION);
  if (env.VITE_FIREBASE_EMULATOR === '1') {
    // Local Firebase emulators (npm run emulators); never set in a production build.
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  }
  services = { app, auth, db, functions, projectId: config.projectId };
  return services;
}

export function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}
