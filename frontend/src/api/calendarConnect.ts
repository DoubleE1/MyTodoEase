/**
 * Web app: grant Google Calendar access. Google Identity Services opens its consent popup for the calendar
 * scope and hands back an authorization code; the calendarConnect Cloud Function exchanges it for a refresh
 * token and keeps that token server-side (never in the browser), where the sync runs from then on.
 */
import { httpsCallable } from 'firebase/functions';
import { firebase } from '../firebase/app';
import { GOOGLE_CALENDAR_SCOPE } from './hooks';
import type { CalendarSyncStatus } from './types';

const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';

interface CodeResponse {
  code?: string;
  error?: string;
  error_description?: string;
}

interface CodeClientError {
  type: 'popup_failed_to_open' | 'popup_closed' | 'unknown';
  message?: string;
}

interface CodeClient {
  requestCode(): void;
}

interface GoogleIdentity {
  accounts: {
    oauth2: {
      initCodeClient(config: {
        client_id: string;
        scope: string;
        ux_mode: 'popup';
        prompt?: string;
        hint?: string;
        callback: (response: CodeResponse) => void;
        error_callback?: (error: CodeClientError) => void;
      }): CodeClient;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

let gisLoading: Promise<GoogleIdentity> | undefined;

function loadGis(): Promise<GoogleIdentity> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  gisLoading ??= new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SCRIPT;
    script.async = true;
    script.onload = () => (window.google?.accounts?.oauth2 ? resolve(window.google) : reject(new Error('Google sign-in library did not load.')));
    script.onerror = () => {
      gisLoading = undefined;
      reject(new Error('Could not load the Google sign-in library. Check your connection and try again.'));
    };
    document.head.appendChild(script);
  });
  return gisLoading;
}

export class CalendarConnectCancelled extends Error {
  constructor() {
    super('The Google window was closed before access was granted.');
    this.name = 'CalendarConnectCancelled';
  }
}

export const localTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Opens Google's consent popup for calendar access and stores the resulting token server-side. */
export async function connectCalendarWeb(): Promise<CalendarSyncStatus> {
  const { auth, functions } = firebase();
  const authConfig = httpsCallable<void, { clientId: string }>(functions, 'calendarAuthConfig');
  const connect = httpsCallable<{ code: string; timeZone: string }, CalendarSyncStatus>(functions, 'calendarConnect', { timeout: 60_000 });

  const [{ data: config }, google] = await Promise.all([authConfig(), loadGis()]);
  const code = await new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initCodeClient({
      client_id: config.clientId,
      scope: GOOGLE_CALENDAR_SCOPE,
      ux_mode: 'popup',
      prompt: 'consent',
      hint: auth.currentUser?.email ?? undefined,
      callback: (response) => {
        if (response.code) resolve(response.code);
        else if (response.error === 'access_denied') reject(new CalendarConnectCancelled());
        else reject(new Error(response.error_description ?? response.error ?? 'Google did not return an authorization code.'));
      },
      error_callback: (error) => {
        if (error.type === 'popup_closed') reject(new CalendarConnectCancelled());
        else if (error.type === 'popup_failed_to_open') reject(new Error('The browser blocked the Google window. Allow pop-ups for this site and try again.'));
        else reject(new Error(error.message ?? 'Google sign-in failed.'));
      },
    });
    client.requestCode();
  });
  const { data } = await connect({ code, timeZone: localTimeZone() });
  return data;
}
