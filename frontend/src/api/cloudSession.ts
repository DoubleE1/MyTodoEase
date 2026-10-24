/**
 * Cloud sync for the desktop app (and a plain-browser dev run): one Firebase session shared between this
 * renderer, which reads and writes Firestore directly, and the local API, which does the same for the MCP
 * server and Google Calendar sync.
 *
 * Firebase's Google popup cannot run inside Electron, so sign-in goes through the system browser: the local
 * API serves a small page on http://localhost that runs the popup and hands the Google ID token back; the
 * renderer polls for it and finishes with signInWithCredential. See CloudEndpoints.cs.
 */
import { GoogleAuthProvider, signInWithCredential, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { IS_WEB_APP } from './backend';
import { ApiError, desktopCloud, firebaseWebConfig } from './client';
import { firebase } from '../firebase/app';

const POLL_MS = 1500;
const POLL_TIMEOUT_MS = 10 * 60_000;

/** Open a link in the system browser (Electron) or a new tab (plain browser). */
async function openInBrowser(url: string): Promise<boolean> {
  const desktop = window.mytodoease;
  if (desktop?.openExternal) return desktop.openExternal(url);
  return window.open(url, '_blank', 'noopener') !== null;
}

export class SignInCancelled extends Error {
  constructor() {
    super('Sign-in cancelled.');
    this.name = 'SignInCancelled';
  }
}

export interface DesktopSignIn {
  /** Resolves with the signed-in user once the browser hands the token back. */
  done: Promise<User>;
  /** Stops waiting (the browser tab, if still open, says the attempt expired). */
  cancel: () => void;
}

/** Desktop sign-in: opens the browser page and waits for it. Throws SignInCancelled when cancelled. */
export function startDesktopSignIn(): DesktopSignIn {
  let cancelled = false;
  let resolveCancel: (() => void) | undefined;
  const cancelledPromise = new Promise<never>((_, reject) => {
    resolveCancel = () => reject(new SignInCancelled());
  });

  const run = async (): Promise<User> => {
    const { state, url } = await desktopCloud.startSignIn();
    if (!(await openInBrowser(url))) throw new Error('Could not open the browser. Open this link yourself: ' + url);

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (!cancelled) {
      if (Date.now() > deadline) throw new Error('Sign-in timed out. Try again from Settings.');
      await new Promise((r) => setTimeout(r, POLL_MS));
      let delivered: { idToken: string } | null;
      try {
        delivered = await desktopCloud.pollSignIn(state);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) throw new Error('The sign-in attempt expired. Try again.');
        if (error instanceof ApiError && error.status === 0) continue; // API hiccup: keep waiting
        throw error;
      }
      if (!delivered) continue;
      const credential = GoogleAuthProvider.credential(delivered.idToken);
      const result = await signInWithCredential(firebase().auth, credential);
      return result.user;
    }
    throw new SignInCancelled();
  };

  return {
    done: Promise.race([run(), cancelledPromise]),
    cancel: () => {
      cancelled = true;
      resolveCancel?.();
      void desktopCloud.cancelSignIn().catch(() => undefined);
    },
  };
}

/** Tell the local API about the current Firebase user so MCP and Calendar sync use the same data. Desktop only. */
export async function shareSessionWithApi(user: User): Promise<void> {
  if (IS_WEB_APP) return;
  const config = firebaseWebConfig();
  try {
    await desktopCloud.setSession({
      projectId: config.projectId,
      apiKey: config.apiKey,
      uid: user.uid,
      email: user.email,
      name: user.displayName,
      refreshToken: user.refreshToken,
    });
  } catch (error) {
    // The app itself keeps working against Firestore; only the MCP server and Calendar mirror would lag.
    console.warn('Could not share the cloud session with the local API:', error);
  }
}

/** Sign out of cloud sync. The desktop goes back to its local data; the cloud data stays in the account. */
export async function signOutOfCloud(): Promise<void> {
  if (!IS_WEB_APP) await desktopCloud.clearSession().catch(() => undefined);
  await firebaseSignOut(firebase().auth);
}
