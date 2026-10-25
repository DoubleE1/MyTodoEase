/**
 * Google Calendar sync for cloud mode (the web app, and the desktop app while signed in), run in the app that
 * presses "Sync now" and recorded in Firestore so every other device sees the same result at once.
 *
 * Push: every open task with a due date is mirrored as an event in a dedicated "TodoEase" calendar (recurring
 * tasks become recurring events). Task-to-event links live in users/{uid}/calendarLinks, shared by all devices;
 * a hash of the event body skips pushes that would change nothing, and an event the user deleted in Google is
 * recreated. Pull: events from the chosen calendars, for a window around today, are written to
 * users/{uid}/calendarEvents in the app's own ExternalEvent shape. A short lease in calendarSync/lock keeps two
 * devices from pushing the same task twice.
 *
 * Mirrors the desktop API's CalendarSyncService, which keeps doing this for the local file when not signed in.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
} from 'firebase/firestore';
import { firebase } from '../firebase/app';
import { parseDateStr, toDateStr } from '../lib/dates';
import { ApiError } from './errors';
import { GoogleCalendarClient, type CalendarEvent, type CalendarInfo } from './googleCalendar';
import type { CalendarAccount, CalendarSyncStatus, ExternalEvent, GoogleCalendarInfo, Task } from './types';

const TARGET_CALENDAR_NAME = 'TodoEase';
/** Name the mirror calendar had before the app was renamed; still recognised. */
const LEGACY_TARGET_CALENDAR_NAME = 'MyTodoEase';
/** Private extended property that marks an event as one of ours, so the pull never shows a task twice. */
const TASK_ID_PROPERTY = 'mytodoeaseTaskId';
const PULL_DAYS_BACK = 14;
const PULL_DAYS_AHEAD = 90;
const BATCH_LIMIT = 400;
const LOCK_LEASE_MS = 5 * 60_000;
const LOCK_WAIT_MS = 20_000;
const LOCK_POLL_MS = 2_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface CalendarSettings {
  enabled: boolean;
  sourceCalendarIds: string[];
}

interface Link {
  calendarId: string;
  eventId: string;
  hash: string;
  updatedAt: string;
}

export class SyncBusyError extends Error {
  constructor() {
    super('Another device is syncing this calendar right now. Try again in a minute.');
    this.name = 'SyncBusyError';
  }
}

/** Returns a valid Google Calendar access token (asking the user if needed). */
export type AccessTokenProvider = () => Promise<string>;

const nowIso = () => new Date().toISOString();
export const localTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** users/{uid} of the signed-in user. */
function userDoc(): DocumentReference {
  const user = firebase().auth.currentUser;
  if (!user) throw new ApiError(401, 'Sign in to continue.');
  return doc(firebase().db, 'users', user.uid);
}

const syncDoc = (name: 'settings' | 'status' | 'calendars' | 'lock') => doc(userDoc(), 'calendarSync', name);
const linksRef = () => collection(userDoc(), 'calendarLinks');
const eventsRef = () => collection(userDoc(), 'calendarEvents');

// ----- Documents -----

export const emptyCalendarStatus = (): CalendarSyncStatus => ({
  scopeGranted: false,
  enabled: false,
  targetCalendarId: null,
  sourceCalendarIds: [],
  lastSyncAt: null,
  lastError: null,
  linkedTasks: 0,
  account: null,
});

/** The status document, with defaults for a user who never connected. */
export function calendarStatusFrom(data: DocumentData | undefined): CalendarSyncStatus {
  return { ...emptyCalendarStatus(), ...(data as Partial<CalendarSyncStatus> | undefined) };
}

export function readSettings(data: DocumentData | undefined): CalendarSettings {
  const ids = Array.isArray(data?.sourceCalendarIds) ? data.sourceCalendarIds.filter((x: unknown): x is string => typeof x === 'string') : [];
  return { enabled: data?.enabled === true, sourceCalendarIds: [...new Set<string>(ids)] };
}

export async function loadSettings(): Promise<CalendarSettings> {
  return readSettings((await getDoc(syncDoc('settings'))).data());
}

export async function loadStatus(): Promise<CalendarSyncStatus> {
  return calendarStatusFrom((await getDoc(syncDoc('status'))).data());
}

/** Merge a change into the status document and return the result. */
export async function writeStatus(patch: Partial<CalendarSyncStatus>): Promise<CalendarSyncStatus> {
  const next = { ...(await loadStatus()), ...patch };
  await setDoc(syncDoc('status'), { ...next, updatedAt: nowIso() });
  return next;
}

// ----- Lock -----

async function acquireLock(owner: string): Promise<boolean> {
  const ref = syncDoc('lock');
  return runTransaction(firebase().db, async (tx) => {
    const data = (await tx.get(ref)).data();
    const now = Date.now();
    if (data && typeof data.until === 'number' && data.until > now && data.owner !== owner) return false;
    tx.set(ref, { owner, until: now + LOCK_LEASE_MS, since: nowIso() });
    return true;
  });
}

async function releaseLock(owner: string): Promise<void> {
  const ref = syncDoc('lock');
  await runTransaction(firebase().db, async (tx) => {
    if ((await tx.get(ref)).data()?.owner === owner) tx.delete(ref);
  }).catch(() => undefined);
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const owner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (!(await acquireLock(owner))) {
    if (Date.now() > deadline) throw new SyncBusyError();
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
  try {
    return await fn();
  } finally {
    await releaseLock(owner);
  }
}

// ----- Reconcile -----

/**
 * Brings Google in line with the tasks and settings, then pulls events, and records the outcome in the status
 * document. Google problems land in status.lastError rather than being thrown; a missing lock throws SyncBusyError.
 */
export async function runCalendarSync(getToken: AccessTokenProvider, account?: CalendarAccount | null): Promise<CalendarSyncStatus> {
  return withLock(async () => {
    const settings = await loadSettings();
    const status = await loadStatus();
    const timeZone = localTimeZone();
    try {
      const google = new GoogleCalendarClient(await getToken());
      let targetCalendarId = status.targetCalendarId;
      let linkedTasks = 0;
      if (settings.enabled) {
        targetCalendarId = await ensureTargetCalendar(google, targetCalendarId, timeZone);
        linkedTasks = await mirrorAll(google, targetCalendarId, timeZone);
      } else {
        await removeMirror(google);
      }
      await pullEvents(google, settings);
      return await writeStatus({
        scopeGranted: true,
        enabled: settings.enabled,
        targetCalendarId,
        sourceCalendarIds: settings.sourceCalendarIds,
        lastSyncAt: nowIso(),
        lastError: null,
        linkedTasks,
        account: account ?? status.account ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return writeStatus({ enabled: settings.enabled, sourceCalendarIds: settings.sourceCalendarIds, lastError: message });
    }
  });
}

/**
 * Forgets the Google connection for the account: mirrored events are removed while the token still works
 * (when one can be had), then every derived document is cleared and mirroring is switched off.
 */
export async function disconnectCalendar(getToken: AccessTokenProvider | null): Promise<CalendarSyncStatus> {
  let google: GoogleCalendarClient | null = null;
  if (getToken) {
    try {
      google = new GoogleCalendarClient(await getToken());
    } catch {
      google = null; // no token: the mirrored events stay in Google
    }
  }
  await removeMirror(google);
  const events = await getDocs(eventsRef());
  await deleteAll([...events.docs.map((d) => d.ref), syncDoc('calendars')]);
  await setDoc(syncDoc('settings'), { enabled: false }, { merge: true });
  return writeStatus({ scopeGranted: false, enabled: false, lastError: null, linkedTasks: 0, account: null });
}

// ----- Push -----

async function mirrorAll(google: GoogleCalendarClient, calendarId: string, timeZone: string): Promise<number> {
  const [tasksSnap, linksSnap] = await Promise.all([
    getDocs(query(collection(userDoc(), 'tasks'), where('isCompleted', '==', false))),
    getDocs(linksRef()),
  ]);
  const tasks = tasksSnap.docs.map((d) => d.data() as Task).filter((t) => t.dueDate && DATE_RE.test(t.dueDate));
  const links = new Map(linksSnap.docs.map((d) => [d.id, d.data() as Link]));
  const wanted = new Set(tasks.map((t) => t.id));
  for (const task of tasks) await pushTask(google, calendarId, task, links.get(task.id), timeZone);
  // Links for tasks that are gone, completed or undated: remove their events.
  for (const [taskId, link] of links) {
    if (wanted.has(taskId)) continue;
    await google.deleteEvent(link.calendarId, link.eventId);
    await deleteDoc(doc(linksRef(), taskId));
  }
  return wanted.size;
}

async function pushTask(google: GoogleCalendarClient, calendarId: string, task: Task, link: Link | undefined, timeZone: string): Promise<void> {
  const body = toEvent(task, timeZone);
  const hash = await hashEvent(body, calendarId);
  if (link && link.hash === hash && link.calendarId === calendarId) return;

  let saved: CalendarEvent | null = null;
  if (link && link.calendarId === calendarId) saved = await google.updateEvent(calendarId, link.eventId, body);
  saved ??= await google.insertEvent(calendarId, body);
  if (!saved?.id) throw new Error('Google did not return the saved event.');
  const next: Link = { calendarId, eventId: saved.id, hash, updatedAt: nowIso() };
  await setDoc(doc(linksRef(), task.id), next);
}

/** Turned off or disconnected: remove the mirrored events so Google does not keep stale copies. */
async function removeMirror(google: GoogleCalendarClient | null): Promise<void> {
  const links = await getDocs(linksRef());
  if (links.empty) return;
  if (google) {
    for (const d of links.docs) {
      const link = d.data() as Link;
      try {
        await google.deleteEvent(link.calendarId, link.eventId);
      } catch (error) {
        console.warn('Could not delete a mirrored event', link.eventId, error);
      }
    }
  }
  await deleteAll(links.docs.map((d) => d.ref));
}

async function ensureTargetCalendar(google: GoogleCalendarClient, current: string | null, timeZone: string): Promise<string> {
  if (current && (await google.calendarExists(current))) return current;
  // Reuse an existing mirror calendar (for example one the desktop app created) before creating one.
  const owned = (await google.listCalendars()).filter((c) => c.accessRole === 'owner');
  const existing = owned.find((c) => c.summary === TARGET_CALENDAR_NAME) ?? owned.find((c) => c.summary === LEGACY_TARGET_CALENDAR_NAME);
  const id = existing?.id ?? (await google.createCalendar(TARGET_CALENDAR_NAME, timeZone)).id;
  await writeStatus({ targetCalendarId: id });
  // Links pointed at a calendar that no longer exists.
  const stale = await getDocs(linksRef());
  await deleteAll(stale.docs.map((d) => d.ref));
  return id;
}

const RRULES: Partial<Record<Task['recurrence'], string>> = {
  daily: 'RRULE:FREQ=DAILY',
  weekdays: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  weekly: 'RRULE:FREQ=WEEKLY',
  biweekly: 'RRULE:FREQ=WEEKLY;INTERVAL=2',
  monthly: 'RRULE:FREQ=MONTHLY',
  yearly: 'RRULE:FREQ=YEARLY',
};

const pad2 = (n: number) => String(n).padStart(2, '0');

function addDays(date: string, days: number): string {
  const d = parseDateStr(date)!;
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

function toEvent(task: Task, timeZone: string): CalendarEvent {
  const due = task.dueDate!;
  const event: CalendarEvent = {
    summary: task.content,
    description: task.description?.trim() ? `${task.description}\n\nFrom TodoEase` : 'From TodoEase',
    extendedProperties: { private: { [TASK_ID_PROPERTY]: task.id } },
    reminders: { useDefault: true },
  };
  if (task.dueTime && TIME_RE.test(task.dueTime)) {
    const minutes = task.durationMinutes && task.durationMinutes > 0 ? task.durationMinutes : 30;
    const [h, m] = task.dueTime.split(':').map(Number);
    const total = h * 60 + m + minutes;
    const endDate = addDays(due, Math.floor(total / 1440));
    const endMinutes = total % 1440;
    event.start = { dateTime: `${due}T${task.dueTime}:00`, timeZone };
    event.end = { dateTime: `${endDate}T${pad2(Math.floor(endMinutes / 60))}:${pad2(endMinutes % 60)}:00`, timeZone };
  } else {
    event.start = { date: due };
    event.end = { date: addDays(due, 1) };
  }
  const rule = RRULES[task.recurrence];
  if (rule) event.recurrence = [rule];
  return event;
}

async function hashEvent(event: CalendarEvent, calendarId: string): Promise<string> {
  const text = [
    calendarId,
    event.summary,
    event.description,
    event.start?.date,
    event.start?.dateTime,
    event.start?.timeZone,
    event.end?.date,
    event.end?.dateTime,
    event.recurrence?.join(',') ?? '',
  ].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ----- Pull -----

async function pullEvents(google: GoogleCalendarClient, settings: CalendarSettings): Promise<void> {
  const calendars = await google.listCalendars();
  const items: GoogleCalendarInfo[] = calendars.map((c) => ({ id: c.id, summary: c.summary, backgroundColor: c.backgroundColor, primary: c.primary, accessRole: c.accessRole }));
  await setDoc(syncDoc('calendars'), { items, updatedAt: nowIso() });

  const chosen = settings.sourceCalendarIds.length === 0
    ? calendars.filter((c) => c.primary)
    : calendars.filter((c) => settings.sourceCalendarIds.includes(c.id));

  const today = toDateStr(new Date());
  const from = addDays(today, -PULL_DAYS_BACK);
  const to = addDays(today, PULL_DAYS_AHEAD);
  // A day of padding on each side covers the zone offset; the mapped local dates are filtered below.
  const timeMin = new Date(`${addDays(from, -1)}T00:00:00Z`);
  const timeMax = new Date(`${addDays(to, 2)}T00:00:00Z`);

  const next = new Map<string, ExternalEvent>();
  for (const source of chosen) {
    for (const event of await google.listEvents(source.id, timeMin, timeMax)) {
      if (!event.id || !event.start) continue;
      if (event.extendedProperties?.private?.[TASK_ID_PROPERTY]) continue; // our own mirror
      const mapped = mapEvent(event, source);
      if (!mapped || mapped.date > to || mapped.endDate < from) continue;
      next.set(await eventDocId(source.id, event.id), mapped);
    }
  }

  // Only documents that changed are written.
  const existing = await getDocs(eventsRef());
  const writes: { ref: DocumentReference; data: ExternalEvent }[] = [];
  const deletes: DocumentReference[] = [];
  for (const d of existing.docs) {
    const wanted = next.get(d.id);
    if (!wanted) deletes.push(d.ref);
    else if (!sameEvent(d.data() as ExternalEvent, wanted)) writes.push({ ref: d.ref, data: wanted });
    next.delete(d.id);
  }
  for (const [id, data] of next) writes.push({ ref: doc(eventsRef(), id), data });

  const total = writes.length + deletes.length;
  for (let start = 0; start < total; start += BATCH_LIMIT) {
    const batch = writeBatch(firebase().db);
    for (let i = start; i < Math.min(total, start + BATCH_LIMIT); i++) {
      if (i < writes.length) batch.set(writes[i].ref, writes[i].data);
      else batch.delete(deletes[i - writes.length]);
    }
    await batch.commit();
  }
}

async function eventDocId(calendarId: string, eventId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${calendarId}|${eventId}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function sameEvent(a: ExternalEvent, b: ExternalEvent): boolean {
  return (Object.keys(b) as (keyof ExternalEvent)[]).every((key) => a[key] === b[key]);
}

/** Local wall-clock parts of an instant, in this device's zone (where the user reads the calendar). */
function localParts(instant: Date): { date: string; time: string } {
  return { date: toDateStr(instant), time: `${pad2(instant.getHours())}:${pad2(instant.getMinutes())}` };
}

function mapEvent(event: CalendarEvent, source: CalendarInfo): ExternalEvent | null {
  const base = {
    id: event.id!,
    calendarId: source.id,
    calendarName: source.summary,
    color: source.backgroundColor,
    title: event.summary?.trim() ? event.summary : '(No title)',
    location: event.location ?? null,
    htmlLink: event.htmlLink ?? null,
  };
  if (event.start?.date) {
    // All-day: Google's end date is exclusive.
    const endDate = event.end?.date ? addDays(event.end.date, -1) : event.start.date;
    return { ...base, date: event.start.date, endDate, startTime: null, endTime: null, allDay: true };
  }
  if (event.start?.dateTime) {
    const start = new Date(event.start.dateTime);
    if (Number.isNaN(start.getTime())) return null;
    const parsedEnd = event.end?.dateTime ? new Date(event.end.dateTime) : null;
    const end = parsedEnd && !Number.isNaN(parsedEnd.getTime()) ? parsedEnd : new Date(start.getTime() + 30 * 60_000);
    const startLocal = localParts(start);
    const endLocal = localParts(end);
    const lastDay = toDateStr(new Date(end.getTime() - 1000));
    return {
      ...base,
      date: startLocal.date,
      endDate: lastDay < startLocal.date ? startLocal.date : lastDay,
      startTime: startLocal.time,
      endTime: endLocal.time,
      allDay: false,
    };
  }
  return null;
}

async function deleteAll(refs: DocumentReference[]): Promise<void> {
  for (let start = 0; start < refs.length; start += BATCH_LIMIT) {
    const batch = writeBatch(firebase().db);
    for (const ref of refs.slice(start, start + BATCH_LIMIT)) batch.delete(ref);
    await batch.commit();
  }
}
