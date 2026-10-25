/**
 * Where the in-app calendar sync gets its Google access token, and how a user connects their calendar in cloud
 * mode. Tokens are short-lived (about an hour) and cached in memory for the session.
 *
 * - Web app: Firebase's Google popup, re-run with the calendar scope. The first time Google asks for consent;
 *   later it just confirms the account and closes. No refresh token ever reaches the browser or the server.
 * - Desktop (signed in): the local API holds a refresh token from the browser sign-in and mints access tokens.
 */
import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';
import { firebase } from '../firebase/app';
import { IS_WEB_APP } from './backend';
import { disconnectCalendar, pushTaskToCalendar, runCalendarSync, type AccessTokenProvider } from './calendarSync';
import { desktopCloud, restApi } from './client';
import { GOOGLE_CALENDAR_SCOPE } from './googleCalendar';
import type { CalendarAccount, CalendarSyncStatus } from './types';

/** Firebase does not report the token lifetime; Google issues one-hour tokens. */
const WEB_TOKEN_TTL_MS = 55 * 60_000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;

export class CalendarAccessCancelled extends Error {
  constructor() {
    super('The Google window was closed before access was granted.');
    this.name = 'CalendarAccessCancelled';
  }
}

/** Thrown on the desktop when the local API has no calendar permission yet (ask the user to grant it). */
export class CalendarAccessMissing extends Error {
  constructor() {
    super('Allow calendar access on this PC first (Settings > Google Calendar).');
    this.name = 'CalendarAccessMissing';
  }
}

export function forgetCalendarAccessToken(): void {
  cached = null;
}

// ----- Web: Firebase popup -----

async function webAccessToken(interactive: boolean): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  if (!interactive) throw new CalendarAccessMissing();
  const user = firebase().auth.currentUser;
  if (!user) throw new Error('Sign in to continue.');
  const provider = new GoogleAuthProvider();
  provider.addScope(GOOGLE_CALENDAR_SCOPE);
  if (user.email) provider.setCustomParameters({ login_hint: user.email });
  let result;
  try {
    result = await reauthenticateWithPopup(user, provider);
  } catch (error) {
    const code = (error as { code?: string }).code ?? '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') throw new CalendarAccessCancelled();
    if (code === 'auth/popup-blocked') throw new Error('The browser blocked the Google window. Allow pop-ups for this site and try again.');
    if (code === 'auth/user-mismatch') throw new Error('Pick the same Google account you are signed in with.');
    throw error;
  }
  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (!token) throw new Error('Google did not return an access token.');
  if (!(await tokenHasCalendarScope(token))) throw new Error('Calendar access was not granted on Google’s screen. Tick the calendar permission and try again.');
  cached = { token, expiresAt: Date.now() + WEB_TOKEN_TTL_MS };
  return token;
}

async function tokenHasCalendarScope(token: string): Promise<boolean> {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
    if (!res.ok) return true; // cannot check: let the Calendar call decide
    const info = (await res.json()) as { scope?: string };
    return (info.scope ?? '').split(' ').includes(GOOGLE_CALENDAR_SCOPE);
  } catch {
    return true;
  }
}

async function revokeWebToken(): Promise<void> {
  const token = cached?.token;
  cached = null;
  if (!token) return;
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // Best effort: the token expires within the hour anyway.
  }
}

// ----- Desktop: local API -----

async function desktopAccessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const issued = await desktopCloud.accessToken();
  if (!issued) throw new CalendarAccessMissing();
  cached = { token: issued.accessToken, expiresAt: new Date(issued.expiresAt).getTime() - 60_000 };
  return issued.accessToken;
}

// ----- Shared -----

/** Token for "Sync now": on the web this may open Google's popup once an hour. */
export const getCalendarAccessToken: AccessTokenProvider = () => (IS_WEB_APP ? webAccessToken(true) : desktopAccessToken());

async function currentAccount(): Promise<CalendarAccount | null> {
  if (IS_WEB_APP) {
    const user = firebase().auth.currentUser;
    return user ? { email: user.email ?? '', name: user.displayName ?? user.email ?? 'Google account', picture: user.photoURL } : null;
  }
  const status = await restApi.googleAuth.status();
  return status.account ? { email: status.account.email, name: status.account.name, picture: status.account.picture } : null;
}

/**
 * Connect the calendar for the signed-in account: obtain a token (web: Google's consent popup; desktop: from the
 * local API, which must already hold the permission), then run a first sync so calendars and events appear.
 */
export async function connectCalendar(): Promise<CalendarSyncStatus> {
  const token = await getCalendarAccessToken();
  const account = await currentAccount();
  return runCalendarSync(async () => token, account);
}

/** A token without asking the user: the cached web token, or the desktop API's. Throws CalendarAccessMissing otherwise. */
const quietAccessToken: AccessTokenProvider = () => (IS_WEB_APP ? webAccessToken(false) : desktopAccessToken());

let pushChain: Promise<void> = Promise.resolve();

/**
 * Push tasks that just changed in this app to Google, one after another, without ever opening a popup: on the
 * web only while the hour-long token from the last Sync now is still valid (otherwise the next Sync now covers
 * them), on the desktop always. Never throws.
 */
export function queueCalendarPush(taskIds: string[]): void {
  for (const id of taskIds) {
    pushChain = pushChain
      .then(() => pushTaskToCalendar(id, quietAccessToken))
      .catch((error) => {
        if (!(error instanceof CalendarAccessMissing)) console.warn('Calendar push skipped', error);
      });
  }
}

/** Forget the connection for the account; the mirrored events are removed when a token can be had quietly. */
export async function disconnectCloudCalendar(): Promise<CalendarSyncStatus> {
  const status = await disconnectCalendar(quietAccessToken);
  if (IS_WEB_APP) await revokeWebToken();
  else cached = null;
  return status;
}
