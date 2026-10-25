/**
 * Firebase bootstrap, shared by the hosted web app and the desktop renderer (which uses it once the user
 * signs in for cloud sync). Config comes from VITE_FIREBASE_* (frontend/.env); these values are public
 * identifiers, not secrets: access is enforced by Firestore rules and Firebase Auth.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
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
  projectId: string;
}

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
  // App Check (web only): with a reCAPTCHA v3 site key configured, every Firestore and Auth request carries a
  // token proving it comes from this app, so scripted clients cannot spend the project's quota. Until
  // enforcement is switched on in the Firebase console this only reports; see docs/DEVELOPMENT.md.
  if (env.VITE_RECAPTCHA_SITE_KEY && env.VITE_BACKEND === 'firebase') {
    try {
      initializeAppCheck(app, { provider: new ReCaptchaV3Provider(env.VITE_RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
    } catch (error) {
      console.warn('App Check could not start:', error);
    }
  }
  // Offline cache shared across tabs: the app keeps working without a connection and syncs when back.
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  const auth = getAuth(app);
  if (env.VITE_FIREBASE_EMULATOR === '1') {
    // Local Firebase emulators (npm run emulators); never set in a production build.
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  services = { app, auth, db, projectId: config.projectId };
  return services;
}

export function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}
