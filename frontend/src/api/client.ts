import type {
  BackupDocument,
  CalendarSyncStatus,
  CompletionsResponse,
  ExternalEvent,
  GoogleAuthStatus,
  GoogleCalendarInfo,
  ImportResult,
  Label,
  LabelInput,
  Project,
  ProjectInput,
  ReorderItem,
  Section,
  SectionInput,
  Task,
  TaskInput,
} from './types';

import { IS_WEB_APP } from './backend';
import { ApiError } from './errors';
import { firestoreApi } from './firestoreClient';

export { ApiError } from './errors';

export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:5080';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API_BASE_URL + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, `Cannot reach the API at ${API_BASE_URL}. Is the backend running?`);
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    let errors: Record<string, string[]> = {};
    try {
      const body = await response.json();
      if (body?.errors && typeof body.errors === 'object') {
        errors = body.errors;
        message = Object.values(errors).flat().join(' ') || message;
      } else if (typeof body?.detail === 'string') {
        message = body.detail;
      } else if (typeof body?.title === 'string') {
        message = body.title;
      }
    } catch {
      // Non-JSON error body: keep the status text.
    }
    throw new ApiError(response.status, message, errors);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const restApi = {
  health: () => request<{ status: string; storage?: string; cloud?: boolean }>('/api/health'),

  googleAuth: {
    status: () => request<GoogleAuthStatus>('/api/auth/google'),
    configure: (clientId: string, clientSecret: string) =>
      request<GoogleAuthStatus>('/api/auth/google/config', { method: 'PUT', ...json({ clientId, clientSecret }) }),
    /** Returns the consent URL to open in a browser. */
    start: (scopes?: string[]) => request<{ url: string }>('/api/auth/google/start', { method: 'POST', ...json({ scopes }) }),
    cancel: () => request<void>('/api/auth/google/cancel', { method: 'POST' }),
    signOut: () => request<GoogleAuthStatus>('/api/auth/google', { method: 'DELETE' }),
  },

  calendar: {
    syncStatus: () => request<CalendarSyncStatus>('/api/calendar/sync'),
    updateSync: (input: { enabled?: boolean; sourceCalendarIds?: string[] }) =>
      request<CalendarSyncStatus>('/api/calendar/sync', { method: 'PUT', ...json(input) }),
    runSync: () => request<CalendarSyncStatus>('/api/calendar/sync/run', { method: 'POST' }),
    calendars: () => request<GoogleCalendarInfo[]>('/api/calendar/calendars'),
    /** Events from the chosen Google calendars between two local dates (inclusive). */
    events: (from: string, to: string) => request<ExternalEvent[]>(`/api/calendar/events?from=${from}&to=${to}`),
    /** Removes the mirrored events and forgets the calendar permission (the Google account stays signed in). */
    disconnect: async () => {
      await request<CalendarSyncStatus>('/api/calendar/sync', { method: 'PUT', ...json({ enabled: false }) });
      await request<GoogleAuthStatus>('/api/auth/google', { method: 'DELETE' });
    },
  },

  backup: {
    export: () => request<BackupDocument>('/api/backup'),
    /** Replaces all data with the document's contents. */
    import: (doc: unknown) => request<ImportResult>('/api/backup/import', { method: 'POST', ...json(doc) }),
  },

  projects: {
    list: () => request<Project[]>('/api/projects'),
    create: (input: ProjectInput) => request<Project>('/api/projects', { method: 'POST', ...json(input) }),
    update: (id: string, input: ProjectInput) =>
      request<Project>(`/api/projects/${id}`, { method: 'PUT', ...json(input) }),
    remove: (id: string) => request<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  },

  sections: {
    list: () => request<Section[]>('/api/sections'),
    create: (input: SectionInput) => request<Section>('/api/sections', { method: 'POST', ...json(input) }),
    update: (id: string, input: SectionInput) =>
      request<Section>(`/api/sections/${id}`, { method: 'PUT', ...json(input) }),
    remove: (id: string) => request<void>(`/api/sections/${id}`, { method: 'DELETE' }),
  },

  labels: {
    list: () => request<Label[]>('/api/labels'),
    create: (input: LabelInput) => request<Label>('/api/labels', { method: 'POST', ...json(input) }),
    update: (id: string, input: LabelInput) => request<Label>(`/api/labels/${id}`, { method: 'PUT', ...json(input) }),
    remove: (id: string) => request<void>(`/api/labels/${id}`, { method: 'DELETE' }),
  },

  tasks: {
    listActive: () => request<Task[]>('/api/tasks'),
    listCompleted: (limit = 500) => request<Task[]>(`/api/tasks?completed=true&limit=${limit}`),
    create: (input: TaskInput) => request<Task>('/api/tasks', { method: 'POST', ...json(input) }),
    update: (id: string, input: TaskInput) => request<Task>(`/api/tasks/${id}`, { method: 'PUT', ...json(input) }),
    remove: (id: string) => request<void>(`/api/tasks/${id}`, { method: 'DELETE' }),
    complete: (id: string) => request<Task>(`/api/tasks/${id}/complete`, { method: 'POST' }),
    reopen: (id: string) => request<Task>(`/api/tasks/${id}/reopen`, { method: 'POST' }),
    reorder: (items: ReorderItem[]) => request<void>('/api/tasks/reorder', { method: 'POST', ...json({ items }) }),
  },

  stats: {
    /** Completion history between two local calendar dates (yyyy-MM-dd, inclusive). */
    completions: (from: string, to: string) =>
      request<CompletionsResponse>(`/api/stats/completions?from=${from}&to=${to}`),
  },
};

/** The data API surface; the REST client defines it and the Firestore client must match it. */
export type Api = typeof restApi;

/**
 * Desktop app while signed in: tasks, projects, labels, stats and backups live in Firestore (shared with the web
 * app and other PCs), and the Google Calendar sync runs in the app and lands in Firestore, exactly as on the web.
 * The Google sign-in itself (and so the calendar permission) still goes through the local API, which also mints
 * the access tokens the sync uses.
 */
const desktopCloudApi: Api = {
  ...firestoreApi,
  googleAuth: restApi.googleAuth,
  calendar: {
    ...firestoreApi.calendar,
    disconnect: async () => {
      await firestoreApi.calendar.disconnect();
      // The local API forgets its copy of the permission too, so Settings does not offer a dead token.
      await restApi.googleAuth.signOut().catch(() => undefined);
    },
  },
};

/** Where data is read and written right now. 'cloud' needs a signed-in Firebase user. */
export type DataMode = 'local' | 'cloud';

let dataMode: DataMode = IS_WEB_APP ? 'cloud' : 'local';

export const getDataMode = (): DataMode => dataMode;

/** Flipped by the session gate when the Firebase user appears or leaves; the web app is always 'cloud'. */
export function setDataMode(mode: DataMode): void {
  dataMode = IS_WEB_APP ? 'cloud' : mode;
}

function activeApi(): Api {
  if (dataMode === 'local') return restApi;
  return IS_WEB_APP ? firestoreApi : desktopCloudApi;
}

type ApiGroup = { [method: string]: (...args: never[]) => unknown };

/**
 * The API the UI talks to. Every call is resolved against the active backend at call time, so references taken
 * early (query functions, mutation functions) follow a mode switch without re-rendering.
 */
export const api: Api = new Proxy(restApi, {
  get(_target, key: keyof Api) {
    if (key === 'health') return () => activeApi().health();
    return new Proxy({} as ApiGroup, {
      get(_group, method: string) {
        return (...args: unknown[]) => {
          const group = activeApi()[key] as unknown as ApiGroup;
          return group[method](...(args as never[]));
        };
      },
    });
  },
}) as Api;

/** Firebase web config the renderer was built with (frontend/.env); the API gets project id and key with the session. */
export function firebaseWebConfig() {
  const env = import.meta.env;
  return {
    apiKey: env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
  };
}

export interface CloudSessionStatus {
  active: boolean;
  projectId: string | null;
  uid: string | null;
  email: string | null;
  name: string | null;
  connectedAt: string | null;
  lastError: string | null;
}

/** Desktop-only endpoints of the local API that make cloud sync work (not part of the data surface). */
export const desktopCloud = {
  /** The Google ID token of the sign-in that just completed, handed out once; null while nothing is waiting. */
  takeGoogleIdToken: () => request<{ idToken: string } | undefined>('/api/auth/google/id-token').then((r) => r ?? null),
  session: () => request<CloudSessionStatus>('/api/cloud/session'),
  /** Shares the Firebase session so the API (MCP server) reads the same cloud data. */
  setSession: (input: { projectId: string; apiKey: string; uid: string; email: string | null; name: string | null; refreshToken: string }) =>
    request<CloudSessionStatus>('/api/cloud/session', { method: 'PUT', ...json(input) }),
  clearSession: () => request<CloudSessionStatus>('/api/cloud/session', { method: 'DELETE' }),
  /** The LiteDB file on this PC, whatever mode the API is in (to move local data to the cloud). */
  exportLocal: () => request<BackupDocument>('/api/backup/local'),
  /** A short-lived Google Calendar access token from the API's refresh token; null when no permission was granted. */
  accessToken: () =>
    request<{ accessToken: string; expiresAt: string } | undefined>('/api/auth/google/access-token').then((r) => r ?? null),
};
