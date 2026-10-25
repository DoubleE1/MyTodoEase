/**
 * Thin client for the Google Calendar API v3, used by the in-app calendar sync (cloud mode) with a short-lived
 * OAuth access token. Only the fields the sync needs are modelled.
 */
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

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

const isGone = (error: unknown) => error instanceof GoogleApiError && (error.status === 404 || error.status === 410);

export class GoogleCalendarClient {
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
      if (isGone(error)) return false;
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

  /** Null when the event no longer exists in Google (deleted by the user), so the caller can recreate it. */
  async updateEvent(calendarId: string, eventId: string, body: CalendarEvent): Promise<CalendarEvent | null> {
    try {
      return await this.send<CalendarEvent>('PUT', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, body);
    } catch (error) {
      if (isGone(error)) return null;
      throw error;
    }
  }

  /** An event that is already gone counts as deleted. */
  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      await this.send('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    } catch (error) {
      if (isGone(error)) return;
      throw error;
    }
  }

  private async send<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    let res: Response;
    try {
      res = await fetch(CALENDAR_BASE + path, {
        method,
        headers: { Authorization: `Bearer ${this.accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GoogleApiError('Could not reach Google Calendar. Check your connection and try again.', 0);
    }
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
