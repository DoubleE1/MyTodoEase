/**
 * Google OAuth 2.0 and Calendar API v3 over plain fetch (built into the Node 22 runtime).
 *
 * Two OAuth clients issue the refresh tokens this code uses: the web app's client (the one Firebase Auth's
 * Google provider is set up with; its id and secret are read from the project's Identity Platform config at
 * run time, so nothing has to be configured by hand) and the desktop app's "Desktop app" client, whose id and
 * secret the desktop API stores next to the token it uploads (Google documents an installed app's secret as
 * non-confidential). A refresh token only works with the client that issued it.
 */
import { logger } from 'firebase-functions';
import { GoogleAuth } from 'google-auth-library';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

export interface OAuthClient {
  id: string;
  secret: string;
}

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    /** Google's `error` code, e.g. invalid_grant when the user revoked access. */
    readonly code: string,
  ) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

// ----- OAuth clients -----

let webClientCache: Promise<OAuthClient> | undefined;

/**
 * The OAuth web client Firebase Auth signs users in with, from the project's own Identity Platform
 * configuration (readable by the function's service account). Used for refresh tokens granted on the web app.
 */
export function webClient(): Promise<OAuthClient> {
  webClientCache ??= (async () => {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const projectId = process.env.GCLOUD_PROJECT ?? (await auth.getProjectId());
    const token = await auth.getAccessToken();
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/defaultSupportedIdpConfigs/google.com`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = (await res.json()) as { clientId?: string; clientSecret?: string; error?: { message?: string } };
    if (!res.ok || !body.clientId || !body.clientSecret) {
      webClientCache = undefined;
      throw new Error(`Could not read the Google sign-in client from the Firebase project: ${body.error?.message ?? res.status}`);
    }
    return { id: body.clientId, secret: body.clientSecret };
  })();
  return webClientCache;
}

// ----- Tokens -----

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

async function postToken(form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, { method: 'POST', body: new URLSearchParams(form) });
  const body = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new GoogleAuthError(
      `Google rejected the token request: ${body.error_description ?? body.error ?? res.status}`,
      body.error ?? 'unknown',
    );
  }
  return body as TokenResponse;
}

/** Authorization-code exchange. The GIS popup flow on the web uses the literal redirect URI "postmessage". */
export const exchangeCode = (client: OAuthClient, code: string, redirectUri: string) =>
  postToken({ code, client_id: client.id, client_secret: client.secret, redirect_uri: redirectUri, grant_type: 'authorization_code' });

export const refreshAccessToken = (client: OAuthClient, refreshToken: string) =>
  postToken({ refresh_token: refreshToken, client_id: client.id, client_secret: client.secret, grant_type: 'refresh_token' });

/** Best effort: a token that is already invalid is as good as revoked. */
export async function revokeToken(token: string): Promise<void> {
  try {
    const res = await fetch(REVOKE_ENDPOINT, { method: 'POST', body: new URLSearchParams({ token }) });
    logger.info('Google token revoked', { status: res.status });
  } catch (error) {
    logger.warn('Could not revoke the Google token', error);
  }
}

export interface UserInfo {
  email: string;
  name?: string;
  picture?: string;
}

export async function userInfo(accessToken: string): Promise<UserInfo> {
  const res = await fetch(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Could not read the Google profile (${res.status}).`);
  return (await res.json()) as UserInfo;
}

// ----- Calendar API -----

export interface CalendarInfo {
  id: string;
  summary: string;
  backgroundColor: string | null;
  primary: boolean;
  accessRole: string | null;
}

export interface EventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface CalendarEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: EventTime;
  end?: EventTime;
  recurrence?: string[];
  extendedProperties?: { private?: Record<string, string> };
  reminders?: { useDefault: boolean };
}

interface CalendarListEntry {
  id: string;
  summary: string;
  backgroundColor?: string;
  primary?: boolean;
  accessRole?: string;
  deleted?: boolean;
}

export class CalendarClient {
  constructor(private readonly accessToken: string) {}

  async listCalendars(): Promise<CalendarInfo[]> {
    const res = await this.send<{ items?: CalendarListEntry[] }>('GET', '/users/me/calendarList?minAccessRole=reader&showHidden=false');
    return (res?.items ?? [])
      .filter((c) => !c.deleted)
      .map((c) => ({
        id: c.id,
        summary: c.summary,
        backgroundColor: c.backgroundColor ?? null,
        primary: c.primary ?? false,
        accessRole: c.accessRole ?? null,
      }));
  }

  async createCalendar(summary: string, timeZone: string): Promise<CalendarInfo> {
    const created = await this.send<CalendarListEntry>('POST', '/calendars', { summary, timeZone });
    if (!created) throw new Error('Google did not return the created calendar.');
    return { id: created.id, summary: created.summary, backgroundColor: null, primary: false, accessRole: 'owner' };
  }

  async calendarExists(calendarId: string): Promise<boolean> {
    try {
      await this.send('GET', `/calendars/${encodeURIComponent(calendarId)}`);
      return true;
    } catch (error) {
      if (error instanceof GoogleApiError && (error.status === 404 || error.status === 410)) return false;
      throw error;
    }
  }

  /** Expanded instances (singleEvents) between two instants, cancelled ones left out. */
  async listEvents(calendarId: string, timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
    const all: CalendarEvent[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '2500',
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
      });
      if (pageToken) query.set('pageToken', pageToken);
      const page = await this.send<{ items?: CalendarEvent[]; nextPageToken?: string }>(
        'GET',
        `/calendars/${encodeURIComponent(calendarId)}/events?${query}`,
      );
      all.push(...(page?.items ?? []).filter((e) => e.status !== 'cancelled'));
      pageToken = page?.nextPageToken;
    } while (pageToken);
    return all;
  }

  insertEvent(calendarId: string, body: CalendarEvent) {
    return this.send<CalendarEvent>('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, body);
  }

  updateEvent(calendarId: string, eventId: string, body: CalendarEvent) {
    return this.send<CalendarEvent>('PUT', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, body);
  }

  /** An event that is already gone counts as deleted. */
  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      await this.send('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    } catch (error) {
      if (error instanceof GoogleApiError && (error.status === 404 || error.status === 410)) return;
      throw error;
    }
  }

  private async send<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const res = await fetch(CALENDAR_BASE + path, {
      method,
      headers: { Authorization: `Bearer ${this.accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
      } catch {
        // keep raw text
      }
      throw new GoogleApiError(`Google Calendar: ${detail}`, res.status);
    }
    return text.trim() ? (JSON.parse(text) as T) : null;
  }
}
