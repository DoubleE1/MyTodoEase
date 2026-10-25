/**
 * Cloud sync sign-in for the desktop app (and a plain-browser dev run). One Google sign-in does two things:
 * the local API runs the OAuth code flow (PKCE, loopback redirect) and keeps the refresh token for Google
 * Calendar, and the renderer opens the matching Firebase session from the ID token of that same sign-in. One
 * consent screen; the calendar permission is a checkbox the user may leave unticked.
 *
 * The desktop OAuth client lives in the Firebase project, which is what lets Firebase accept its ID token.
 */
import { GoogleAuthProvider, signInWithCredential, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { IS_WEB_APP } from './backend';
import { ApiError, desktopCloud, firebaseWebConfig, restApi } from './client';
import { forgetCalendarAccessToken } from './calendarAccess';
import { GOOGLE_CALENDAR_SCOPE } from './hooks';
import { firebase } from '../firebase/app';

const POLL_MS = 1500;
const POLL_TIMEOUT_MS = 10 * 60_000;

/** Open a link in the system browser (Electron) or a new tab (plain browser). */
async function openInBrowser(url: string): Promise<boolean> {
  const desktop = window.mytodoease;
  if (desktop?.openExternal) return desktop.openExternal(url);
  return window.open(url, '_blank', 'noopener') !== null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class SignInCancelled extends Error {
  constructor() {
    super('Sign-in cancelled.');
    this.name = 'SignInCancelled';
  }
}

export interface DesktopSignIn {
  /** Resolves with the signed-in Firebase user once Google has called back and the session is open. */
  done: Promise<User>;
  /** Stops waiting; the browser tab, if still open, reports the attempt as expired. */
  cancel: () => void;
}

/**
 * Desktop sign-in. Opens Google's consent page in the browser (identity plus, by default, calendar access),
 * waits for the API to finish the code exchange, then signs the renderer into Firebase with the same ID token.
 */
export function startDesktopSignIn(options: { calendar?: boolean } = {}): DesktopSignIn {
  const withCalendar = options.calendar ?? true;
  let cancelled = false;
  let rejectWithCancel: (() => void) | undefined;
  const cancelledPromise = new Promise<never>((_, reject) => {
    rejectWithCancel = () => reject(new SignInCancelled());
  });

  const run = async (): Promise<User> => {
    const { url } = await restApi.googleAuth.start(withCalendar ? [GOOGLE_CALENDAR_SCOPE] : []);
    if (!(await openInBrowser(url))) throw new Error('Could not open the browser. Open this link yourself: ' + url);

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (!cancelled) {
      if (Date.now() > deadline) throw new Error('Sign-in timed out. Try again from Settings.');
      await sleep(POLL_MS);
      try {
        // Success leaves the ID token waiting for us; the API hands it out exactly once.
        const delivered = await desktopCloud.takeGoogleIdToken();
        if (delivered?.idToken) {
          const result = await signInWithCredential(firebase().auth, GoogleAuthProvider.credential(delivered.idToken));
          return result.user;
        }
        // No token and nothing pending any more: the browser tab was cancelled or Google reported an error.
        const status = await restApi.googleAuth.status();
        if (!status.pending) throw new Error('Sign-in did not complete. The browser tab explains why; try again.');
      } catch (error) {
        if (error instanceof ApiError && error.status === 0) continue; // API hiccup: keep waiting
        throw error;
      }
    }
    throw new SignInCancelled();
  };

  return {
    done: Promise.race([run(), cancelledPromise]),
    cancel: () => {
      cancelled = true;
      rejectWithCancel?.();
      void restApi.googleAuth.cancel().catch(() => undefined);
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

/**
 * Sign out everywhere: the Firebase session (renderer and API), and on the desktop the Google token the API
 * holds for Calendar. The PC goes back to its local data; the cloud data stays in the account.
 */
export async function signOutOfCloud(): Promise<void> {
  forgetCalendarAccessToken();
  if (!IS_WEB_APP) {
    await desktopCloud.clearSession().catch(() => undefined);
    await restApi.googleAuth.signOut().catch(() => undefined);
  }
  await firebaseSignOut(firebase().auth);
}
