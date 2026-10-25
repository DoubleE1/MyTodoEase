/**
 * Server-side Google Calendar sync for one user, a port of the desktop API's CalendarSyncService.
 *
 * Push: every open task with a due date is mirrored as an event in a dedicated "TodoEase" calendar (recurring
 * tasks become recurring events). Links between tasks and events live in users/{uid}/calendarLinks; a hash of
 * the event body skips pushes that would change nothing, and an event the user deleted in Google is recreated.
 * Pull: events from the calendars the user picked, for a window around today, are written to
 * users/{uid}/calendarEvents in the app's own shape, so every client just reads Firestore.
 *
 * Firestore layout (all under users/{uid}):
 *   private/googleCalendar  refresh token and which OAuth client issued it; never readable by clients
 *   calendarSync/settings   what the user wants: enabled, sourceCalendarIds, timeZone (client-writable)
 *   calendarSync/status     what is true: scopeGranted, lastSyncAt, lastError, linkedTasks... (read-only)
 *   calendarSync/calendars  the user's Google calendars, for the picker (read-only)
 *   calendarSync/lock       lease taken by a running sync so two runs never push the same task twice
 *   calendarLinks/{taskId}  task -> event link
 *   calendarEvents/{id}     pulled events
 * Plus the top-level registry calendarAccounts/{uid} (no client access) that the scheduler iterates.
 */
import { createHash } from 'node:crypto';
import {
  getFirestore,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type QueryDocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { addDays, isDateStr, isTimeStr, isValidTimeZone, localParts, todayIn } from './dates.js';
import {
  CalendarClient,
  GoogleApiError,
  GoogleAuthError,
  refreshAccessToken,
  revokeToken,
  webClient,
  type CalendarEvent,
  type CalendarInfo,
  type OAuthClient,
} from './google.js';

const TARGET_CALENDAR_NAME = 'TodoEase';
/** Name the mirror calendar had before the app was renamed; still recognised. */
const LEGACY_TARGET_CALENDAR_NAME = 'MyTodoEase';
/** Private extended property that marks an event as one of ours, so the pull never shows a task twice. */
const TASK_ID_PROPERTY = 'mytodoeaseTaskId';
const PULL_DAYS_BACK = 14;
const PULL_DAYS_AHEAD = 90;
const BATCH_LIMIT = 400; // Firestore allows 500 writes per batch; leave headroom.
const LOCK_LEASE_MS = 8 * 60_000;
const LOCK_POLL_MS = 2_000;

// ----- Documents -----

export interface CalendarSettings {
  enabled: boolean;
  sourceCalendarIds: string[];
  timeZone: string;
}

export interface CalendarAccount {
  email: string;
  name: string;
  picture: string | null;
}

/** Mirrors the desktop API's SyncStatus, plus the connected Google account. */
export interface CalendarSyncStatus {
  scopeGranted: boolean;
  enabled: boolean;
  targetCalendarId: string | null;
  sourceCalendarIds: string[];
  lastSyncAt: string | null;
  lastError: string | null;
  linkedTasks: number;
  account: CalendarAccount | null;
  updatedAt: string;
}

/** users/{uid}/private/googleCalendar. Written by the connect callable (web) or the desktop API (desktop). */
export interface PrivateConnection {
  provider: 'google';
  refreshToken: string;
  client: 'web' | 'desktop';
  clientId?: string;
  /** Only for the desktop client; the web client's secret is read from the project at run time. */
  clientSecret?: string;
  email: string;
  name?: string | null;
  picture?: string | null;
  scopes: string[];
  connectedAt: string;
}

interface TaskDoc {
  id: string;
  content: string;
  description?: string;
  dueDate: string | null;
  dueTime: string | null;
  durationMinutes: number | null;
  recurrence: string;
  isCompleted: boolean;
}

interface Link {
  calendarId: string;
  eventId: string;
  hash: string;
  updatedAt: string;
}

/** The pulled event, in the exact shape the apps' ExternalEvent type expects. */
interface StoredEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  color: string | null;
  title: string;
  location: string | null;
  date: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  htmlLink: string | null;
}

export class SyncBusyError extends Error {
  constructor() {
    super('A calendar sync is already running for this account. Try again in a moment.');
    this.name = 'SyncBusyError';
  }
}

const nowIso = () => new Date().toISOString();
const db = (): Firestore => getFirestore();

const userDoc = (uid: string) => db().doc(`users/${uid}`);
const privateRef = (uid: string) => userDoc(uid).collection('private').doc('googleCalendar');
const settingsRef = (uid: string) => userDoc(uid).collection('calendarSync').doc('settings');
const statusRef = (uid: string) => userDoc(uid).collection('calendarSync').doc('status');
const calendarsRef = (uid: string) => userDoc(uid).collection('calendarSync').doc('calendars');
const lockRef = (uid: string) => userDoc(uid).collection('calendarSync').doc('lock');
const linksRef = (uid: string) => userDoc(uid).collection('calendarLinks');
const eventsRef = (uid: string) => userDoc(uid).collection('calendarEvents');
const tasksRef = (uid: string) => userDoc(uid).collection('tasks');
const registryRef = (uid: string) => db().collection('calendarAccounts').doc(uid);

export function readSettings(data: DocumentData | undefined): CalendarSettings {
  const ids = Array.isArray(data?.sourceCalendarIds) ? data.sourceCalendarIds.filter((x: unknown): x is string => typeof x === 'string') : [];
  return {
    enabled: data?.enabled === true,
    sourceCalendarIds: [...new Set<string>(ids)],
    timeZone: isValidTimeZone(data?.timeZone) ? data.timeZone : 'UTC',
  };
}

export async function loadSettings(uid: string): Promise<CalendarSettings> {
  return readSettings((await settingsRef(uid).get()).data());
}

export function readConnection(data: DocumentData | undefined): PrivateConnection | null {
  if (!data || typeof data.refreshToken !== 'string' || !data.refreshToken) return null;
  return {
    provider: 'google',
    refreshToken: data.refreshToken,
    client: data.client === 'desktop' ? 'desktop' : 'web',
    clientId: typeof data.clientId === 'string' ? data.clientId : undefined,
    clientSecret: typeof data.clientSecret === 'string' ? data.clientSecret : undefined,
    email: typeof data.email === 'string' ? data.email : '',
    name: typeof data.name === 'string' ? data.name : null,
    picture: typeof data.picture === 'string' ? data.picture : null,
    scopes: Array.isArray(data.scopes) ? data.scopes.filter((s: unknown): s is string => typeof s === 'string') : [],
    connectedAt: typeof data.connectedAt === 'string' ? data.connectedAt : nowIso(),
  };
}

export async function loadConnection(uid: string): Promise<PrivateConnection | null> {
  return readConnection((await privateRef(uid).get()).data());
}

export const accountOf = (connection: PrivateConnection): CalendarAccount => ({
  email: connection.email,
  name: connection.name || connection.email,
  picture: connection.picture ?? null,
});

const emptyStatus = (): CalendarSyncStatus => ({
  scopeGranted: false,
  enabled: false,
  targetCalendarId: null,
  sourceCalendarIds: [],
  lastSyncAt: null,
  lastError: null,
  linkedTasks: 0,
  account: null,
  updatedAt: nowIso(),
});

export async function loadStatus(uid: string): Promise<CalendarSyncStatus> {
  const data = (await statusRef(uid).get()).data();
  return { ...emptyStatus(), ...(data as Partial<CalendarSyncStatus> | undefined) };
}

/** Merge a change into the status document and return the result. */
export async function writeStatus(uid: string, patch: Partial<CalendarSyncStatus>): Promise<CalendarSyncStatus> {
  const next = { ...(await loadStatus(uid)), ...patch, updatedAt: nowIso() };
  await statusRef(uid).set(next);
  return next;
}

/** Registers a freshly written connection: the scheduler's registry and the status the clients show. */
export async function registerConnection(uid: string, connection: PrivateConnection): Promise<CalendarSyncStatus> {
  await registryRef(uid).set({ uid, email: connection.email, client: connection.client, updatedAt: nowIso() });
  return writeStatus(uid, { scopeGranted: true, account: accountOf(connection), lastError: null });
}

// ----- Google session -----

class Session {
  private clientPromise?: Promise<CalendarClient>;

  constructor(readonly connection: PrivateConnection) {}

  /** A Calendar client with a fresh access token (one refresh per invocation). */
  calendar(): Promise<CalendarClient> {
    this.clientPromise ??= (async () => {
      const tokens = await refreshAccessToken(await this.oauthClient(), this.connection.refreshToken);
      return new CalendarClient(tokens.access_token);
    })();
    return this.clientPromise;
  }

  private async oauthClient(): Promise<OAuthClient> {
    const { clientId, clientSecret } = this.connection;
    if (clientId && clientSecret) return { id: clientId, secret: clientSecret };
    return webClient();
  }
}

// ----- Lock -----

async function acquireLock(uid: string, owner: string): Promise<boolean> {
  const ref = lockRef(uid);
  return db().runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    const now = Date.now();
    if (data && typeof data.until === 'number' && data.until > now && data.owner !== owner) return false;
    tx.set(ref, { owner, until: now + LOCK_LEASE_MS, since: nowIso() });
    return true;
  });
}

async function releaseLock(uid: string, owner: string): Promise<void> {
  const ref = lockRef(uid);
  await db().runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(ref);
    if (snap.data()?.owner === owner) tx.delete(ref);
  });
}

/** Runs fn while holding the user's sync lock, waiting up to waitMs for a running sync to finish first. */
export async function withLock<T>(uid: string, owner: string, waitMs: number, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + waitMs;
  while (!(await acquireLock(uid, owner))) {
    if (Date.now() > deadline) throw new SyncBusyError();
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
  try {
    return await fn();
  } finally {
    await releaseLock(uid, owner).catch((error) => logger.warn('Could not release the sync lock', { uid, error }));
  }
}

// ----- Full reconcile -----

/**
 * Brings Google in line with the user's tasks and settings, then pulls events. Runs on the schedule, after a
 * connection is written, after settings change and on "Sync now". Never throws for Google problems: those land
 * in status.lastError (and a revoked grant disconnects the account).
 */
export async function reconcile(uid: string, reason: string): Promise<CalendarSyncStatus> {
  const connection = await loadConnection(uid);
  if (!connection) return writeStatus(uid, { scopeGranted: false, account: null, linkedTasks: 0 });
  return withLock(uid, `reconcile:${reason}:${Date.now()}`, 60_000, async () => {
    const settings = await loadSettings(uid);
    const session = new Session(connection);
    const status = await loadStatus(uid);
    try {
      const calendar = await session.calendar();
      let targetCalendarId = status.targetCalendarId;
      let linkedTasks = 0;
      if (settings.enabled) {
        targetCalendarId = await ensureTargetCalendar(uid, calendar, targetCalendarId, settings.timeZone);
        linkedTasks = await mirrorAll(uid, calendar, targetCalendarId, settings.timeZone);
      } else {
        await removeMirror(uid, calendar);
      }
      await pullEvents(uid, calendar, settings);
      logger.info('Calendar sync done', { uid, reason, linkedTasks, enabled: settings.enabled });
      return await writeStatus(uid, {
        scopeGranted: true,
        enabled: settings.enabled,
        targetCalendarId,
        sourceCalendarIds: settings.sourceCalendarIds,
        lastSyncAt: nowIso(),
        lastError: null,
        linkedTasks,
        account: accountOf(connection),
      });
    } catch (error) {
      if (error instanceof GoogleAuthError && error.code === 'invalid_grant') {
        logger.warn('Google refused the refresh token; disconnecting', { uid });
        return disconnect(uid, { revoke: false, reason: 'Google Calendar access was revoked. Connect it again.' });
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Calendar sync failed', { uid, reason, message });
      return writeStatus(uid, { scopeGranted: true, enabled: settings.enabled, lastError: message, account: accountOf(connection) });
    }
  });
}

/** One task changed: push it right away (the trigger on users/{uid}/tasks/{id}). */
export async function pushOne(uid: string, taskId: string): Promise<void> {
  const settings = await loadSettings(uid);
  if (!settings.enabled) return;
  const connection = await loadConnection(uid);
  if (!connection) return;
  try {
    await withLock(uid, `task:${taskId}:${Date.now()}`, 45_000, async () => {
      const status = await loadStatus(uid);
      const calendar = await new Session(connection).calendar();
      const calendarId = await ensureTargetCalendar(uid, calendar, status.targetCalendarId, settings.timeZone);
      const [taskSnap, linkSnap] = await Promise.all([tasksRef(uid).doc(taskId).get(), linksRef(uid).doc(taskId).get()]);
      const task = taskSnap.data() as TaskDoc | undefined;
      const link = linkSnap.data() as Link | undefined;
      if (!task || task.isCompleted || !isDateStr(task.dueDate)) {
        if (link) {
          await calendar.deleteEvent(link.calendarId, link.eventId);
          await linkSnap.ref.delete();
        }
      } else {
        await pushTask(uid, calendar, calendarId, { ...task, id: taskId }, link, settings.timeZone);
      }
      const linkedTasks = (await linksRef(uid).count().get()).data().count;
      await writeStatus(uid, { linkedTasks, lastSyncAt: nowIso(), lastError: null, targetCalendarId: calendarId });
    });
  } catch (error) {
    if (error instanceof SyncBusyError) {
      // A full reconcile held the lock the whole time; it covers this task, or the next scheduled one does.
      logger.info('Task push skipped: a full sync is running', { uid, taskId });
      return;
    }
    if (error instanceof GoogleAuthError && error.code === 'invalid_grant') {
      await disconnect(uid, { revoke: false, reason: 'Google Calendar access was revoked. Connect it again.' });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Task push failed', { uid, taskId, message });
    await writeStatus(uid, { lastError: message });
  }
}

// ----- Push -----

async function mirrorAll(uid: string, calendar: CalendarClient, calendarId: string, timeZone: string): Promise<number> {
  const [tasksSnap, linksSnap] = await Promise.all([tasksRef(uid).where('isCompleted', '==', false).get(), linksRef(uid).get()]);
  const tasks = tasksSnap.docs.map((d: QueryDocumentSnapshot) => ({ ...(d.data() as TaskDoc), id: d.id })).filter((t: TaskDoc) => isDateStr(t.dueDate));
  const links = new Map<string, Link>(linksSnap.docs.map((d: QueryDocumentSnapshot) => [d.id, d.data() as Link]));
  const wanted = new Set(tasks.map((t: TaskDoc) => t.id));
  for (const task of tasks) {
    await pushTask(uid, calendar, calendarId, task, links.get(task.id), timeZone);
  }
  // Links for tasks that are gone, completed or undated: remove their events.
  for (const [taskId, link] of links) {
    if (wanted.has(taskId)) continue;
    await calendar.deleteEvent(link.calendarId, link.eventId);
    await linksRef(uid).doc(taskId).delete();
  }
  return wanted.size;
}

async function pushTask(
  uid: string,
  calendar: CalendarClient,
  calendarId: string,
  task: TaskDoc,
  link: Link | undefined,
  timeZone: string,
): Promise<void> {
  const body = toEvent(task, timeZone);
  const hash = hashEvent(body, calendarId);
  if (link && link.hash === hash && link.calendarId === calendarId) return;

  let saved: CalendarEvent | null = null;
  if (link && link.calendarId === calendarId) {
    try {
      saved = await calendar.updateEvent(calendarId, link.eventId, body);
    } catch (error) {
      if (!(error instanceof GoogleApiError && (error.status === 404 || error.status === 410))) throw error;
      saved = null; // event deleted by the user in Google: recreate
    }
  }
  saved ??= await calendar.insertEvent(calendarId, body);
  if (!saved?.id) throw new Error('Google did not return the saved event.');
  const next: Link = { calendarId, eventId: saved.id, hash, updatedAt: nowIso() };
  await linksRef(uid).doc(task.id).set(next);
}

/** Turned off or disconnected: remove the mirrored events so Google does not keep stale copies. */
async function removeMirror(uid: string, calendar: CalendarClient | null): Promise<void> {
  const links = await linksRef(uid).get();
  if (links.empty) return;
  for (const doc of links.docs) {
    const link = doc.data() as Link;
    if (calendar) {
      try {
        await calendar.deleteEvent(link.calendarId, link.eventId);
      } catch (error) {
        logger.warn('Could not delete a mirrored event', { uid, eventId: link.eventId, error });
      }
    }
  }
  await deleteAll(links.docs.map((d: QueryDocumentSnapshot) => d.ref));
}

async function ensureTargetCalendar(uid: string, calendar: CalendarClient, current: string | null, timeZone: string): Promise<string> {
  if (current && (await calendar.calendarExists(current))) return current;
  // Reuse an existing mirror calendar (for example one the desktop app created) before creating one.
  const owned = (await calendar.listCalendars()).filter((c) => c.accessRole === 'owner');
  const existing = owned.find((c) => c.summary === TARGET_CALENDAR_NAME) ?? owned.find((c) => c.summary === LEGACY_TARGET_CALENDAR_NAME);
  const id = existing?.id ?? (await calendar.createCalendar(TARGET_CALENDAR_NAME, timeZone)).id;
  await writeStatus(uid, { targetCalendarId: id });
  // Links pointed at a calendar that no longer exists.
  const stale = await linksRef(uid).get();
  await deleteAll(stale.docs.map((d: QueryDocumentSnapshot) => d.ref));
  return id;
}

function toEvent(task: TaskDoc, timeZone: string): CalendarEvent {
  const due = task.dueDate!;
  const description = task.description?.trim() ? `${task.description}\n\nFrom TodoEase` : 'From TodoEase';
  const event: CalendarEvent = {
    summary: task.content,
    description,
    extendedProperties: { private: { [TASK_ID_PROPERTY]: task.id } },
    reminders: { useDefault: true },
  };
  if (isTimeStr(task.dueTime)) {
    const minutes = typeof task.durationMinutes === 'number' && task.durationMinutes > 0 ? task.durationMinutes : 30;
    const start = `${due}T${task.dueTime}:00`;
    // End is wall-clock arithmetic in the user's zone; Google interprets both with the given timeZone.
    const [h, m] = task.dueTime.split(':').map(Number);
    const total = h * 60 + m + minutes;
    const endDate = addDays(due, Math.floor(total / 1440));
    const endMinutes = total % 1440;
    const end = `${endDate}T${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}:00`;
    event.start = { dateTime: start, timeZone };
    event.end = { dateTime: end, timeZone };
  } else {
    event.start = { date: due };
    event.end = { date: addDays(due, 1) };
  }
  const rule = RRULES[task.recurrence];
  if (rule) event.recurrence = [rule];
  return event;
}

const RRULES: Record<string, string | undefined> = {
  daily: 'RRULE:FREQ=DAILY',
  weekdays: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  weekly: 'RRULE:FREQ=WEEKLY',
  biweekly: 'RRULE:FREQ=WEEKLY;INTERVAL=2',
  monthly: 'RRULE:FREQ=MONTHLY',
  yearly: 'RRULE:FREQ=YEARLY',
};

function hashEvent(event: CalendarEvent, calendarId: string): string {
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
  return createHash('sha256').update(text).digest('hex');
}

// ----- Pull -----

async function pullEvents(uid: string, calendar: CalendarClient, settings: CalendarSettings): Promise<void> {
  const calendars = await calendar.listCalendars();
  await calendarsRef(uid).set({ items: calendars, updatedAt: nowIso() });

  const chosen = settings.sourceCalendarIds.length === 0
    ? calendars.filter((c) => c.primary)
    : calendars.filter((c) => settings.sourceCalendarIds.includes(c.id));

  const today = todayIn(settings.timeZone);
  const from = addDays(today, -PULL_DAYS_BACK);
  const to = addDays(today, PULL_DAYS_AHEAD);
  // One day of padding on each side covers any zone offset; the mapped local dates are filtered below.
  const timeMin = new Date(`${addDays(from, -1)}T00:00:00Z`);
  const timeMax = new Date(`${addDays(to, 2)}T00:00:00Z`);

  const next = new Map<string, StoredEvent>();
  for (const source of chosen) {
    for (const event of await calendar.listEvents(source.id, timeMin, timeMax)) {
      if (!event.id || !event.start) continue;
      if (event.extendedProperties?.private?.[TASK_ID_PROPERTY]) continue; // our own mirror
      const mapped = mapEvent(event, source, settings.timeZone);
      if (!mapped || mapped.date > to || mapped.endDate < from) continue;
      next.set(eventDocId(source.id, event.id), mapped);
    }
  }

  // Only documents that changed are written, so a quiet calendar costs nothing per cycle.
  const existing = await eventsRef(uid).get();
  const writes: { ref: DocumentReference; data: StoredEvent }[] = [];
  const deletes: DocumentReference[] = [];
  for (const doc of existing.docs) {
    const wanted = next.get(doc.id);
    if (!wanted) deletes.push(doc.ref);
    else if (!sameEvent(doc.data() as StoredEvent, wanted)) writes.push({ ref: doc.ref, data: wanted });
    next.delete(doc.id);
  }
  for (const [id, data] of next) writes.push({ ref: eventsRef(uid).doc(id), data });

  for (let start = 0; start < writes.length + deletes.length; start += BATCH_LIMIT) {
    const batch = db().batch();
    for (let i = start; i < Math.min(writes.length + deletes.length, start + BATCH_LIMIT); i++) {
      if (i < writes.length) batch.set(writes[i].ref, writes[i].data);
      else batch.delete(deletes[i - writes.length]);
    }
    await batch.commit();
  }
  logger.info('Calendar events pulled', { uid, calendars: chosen.length, written: writes.length, removed: deletes.length });
}

const eventDocId = (calendarId: string, eventId: string): string =>
  createHash('sha1').update(`${calendarId}|${eventId}`).digest('hex').slice(0, 32);

function sameEvent(a: StoredEvent, b: StoredEvent): boolean {
  return (Object.keys(b) as (keyof StoredEvent)[]).every((key) => a[key] === b[key]);
}

function mapEvent(event: CalendarEvent, source: CalendarInfo, timeZone: string): StoredEvent | null {
  const title = event.summary?.trim() ? event.summary : '(No title)';
  const base = {
    id: event.id!,
    calendarId: source.id,
    calendarName: source.summary,
    color: source.backgroundColor,
    title,
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
    const endInstant = event.end?.dateTime ? new Date(event.end.dateTime) : new Date(start.getTime() + 30 * 60_000);
    const end = Number.isNaN(endInstant.getTime()) ? new Date(start.getTime() + 30 * 60_000) : endInstant;
    const startLocal = localParts(start, timeZone);
    const endLocal = localParts(end, timeZone);
    const lastDay = localParts(new Date(end.getTime() - 1000), timeZone).date;
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

// ----- Disconnect -----

/**
 * Forgets the Google connection: mirrored events are removed while the token still works, then the token is
 * revoked (unless Google already did), and every derived document is cleared. Settings keep the calendar
 * choice, but mirroring is switched off.
 */
export async function disconnect(uid: string, options: { revoke: boolean; reason?: string }): Promise<CalendarSyncStatus> {
  const connection = await loadConnection(uid);
  let calendar: CalendarClient | null = null;
  if (connection && options.revoke) {
    try {
      calendar = await new Session(connection).calendar();
    } catch (error) {
      logger.warn('No access token while disconnecting; mirrored events stay in Google', { uid, error });
    }
  }
  await removeMirror(uid, calendar);
  if (connection && options.revoke) await revokeToken(connection.refreshToken);

  // Status first, so the trigger that sees the connection document vanish finds nothing left to do.
  await settingsRef(uid).set({ enabled: false }, { merge: true });
  const status = await writeStatus(uid, {
    scopeGranted: false,
    enabled: false,
    lastError: options.reason ?? null,
    linkedTasks: 0,
    account: null,
  });
  const events = await eventsRef(uid).get();
  await deleteAll([...events.docs.map((d: QueryDocumentSnapshot) => d.ref), calendarsRef(uid), privateRef(uid), registryRef(uid)]);
  return status;
}

async function deleteAll(refs: DocumentReference[]): Promise<void> {
  for (let start = 0; start < refs.length; start += BATCH_LIMIT) {
    const batch = db().batch();
    for (const ref of refs.slice(start, start + BATCH_LIMIT)) batch.delete(ref);
    await batch.commit();
  }
}
