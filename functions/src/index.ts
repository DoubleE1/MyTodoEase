/**
 * TodoEase Cloud Functions (2nd gen, region asia-southeast1 next to the Firestore database).
 *
 * Google Calendar sync runs here for every signed-in account, whether or not an app is open:
 * - calendarConnect: the web app hands over the authorization code from Google's popup; the refresh token is
 *   stored under users/{uid}/private (the desktop API writes the same document itself after its own sign-in).
 * - calendarOnConnectionWritten: a new or re-uploaded connection is registered and synced at once.
 * - calendarOnTaskWritten: a task change is pushed to the mirror calendar within seconds.
 * - calendarSyncEvery15Minutes: full reconcile and event pull for every connected account.
 * - calendarRunSync / calendarDisconnect: the "Sync now" and "Disconnect" buttons.
 */
import { initializeApp } from 'firebase-admin/app';
import { logger, setGlobalOptions } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { isValidTimeZone } from './dates.js';
import { CALENDAR_SCOPE, exchangeCode, userInfo, webClient } from './google.js';
import {
  disconnect,
  loadStatus,
  pushOne,
  readConnection,
  reconcile,
  registerConnection,
  type PrivateConnection,
} from './sync.js';
import { getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';

initializeApp();
setGlobalOptions({ region: 'asia-southeast1', maxInstances: 10 });

const REGISTRY = 'calendarAccounts';
const SCHEDULE_CONCURRENCY = 4;

function requireUid(request: CallableRequest): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to continue.');
  return uid;
}

function asHttpsError(error: unknown): HttpsError {
  if (error instanceof HttpsError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new HttpsError('internal', message);
}

/** The OAuth web client id the web app needs to open Google's consent popup (not a secret). */
export const calendarAuthConfig = onCall(async (request) => {
  requireUid(request);
  try {
    return { clientId: (await webClient()).id };
  } catch (error) {
    throw asHttpsError(error);
  }
});

/** Web app: exchanges the popup's authorization code for a refresh token and stores the connection. */
export const calendarConnect = onCall({ timeoutSeconds: 60 }, async (request) => {
  const uid = requireUid(request);
  const code = typeof request.data?.code === 'string' ? request.data.code : '';
  if (!code) throw new HttpsError('invalid-argument', 'Missing authorization code.');
  const timeZone = isValidTimeZone(request.data?.timeZone) ? request.data.timeZone : null;
  try {
    const client = await webClient();
    const tokens = await exchangeCode(client, code, 'postmessage');
    if (!tokens.refresh_token) {
      throw new HttpsError(
        'failed-precondition',
        'Google did not return a refresh token. Remove TodoEase from your Google account’s third-party access list and try again.',
      );
    }
    const scopes = (tokens.scope ?? '').split(' ').filter(Boolean);
    if (!scopes.includes(CALENDAR_SCOPE)) throw new HttpsError('permission-denied', 'Calendar access was not granted on Google’s screen.');
    const profile = await userInfo(tokens.access_token);
    const connection: PrivateConnection = {
      provider: 'google',
      refreshToken: tokens.refresh_token,
      client: 'web',
      clientId: client.id,
      email: profile.email,
      name: profile.name ?? null,
      picture: profile.picture ?? null,
      scopes,
      connectedAt: new Date().toISOString(),
    };
    const db = getFirestore();
    if (timeZone) await db.doc(`users/${uid}/calendarSync/settings`).set({ timeZone }, { merge: true });
    await db.doc(`users/${uid}/private/googleCalendar`).set(connection);
    // The write trigger registers the account and runs the first sync; the status flips right away for the UI.
    return await registerConnection(uid, connection);
  } catch (error) {
    throw asHttpsError(error);
  }
});

/** "Sync now": a full reconcile, waiting for one that is already running. */
export const calendarRunSync = onCall({ timeoutSeconds: 300 }, async (request) => {
  const uid = requireUid(request);
  try {
    return await reconcile(uid, 'manual');
  } catch (error) {
    throw asHttpsError(error);
  }
});

/** Removes the mirrored events, revokes the token and forgets the connection. */
export const calendarDisconnect = onCall({ timeoutSeconds: 120 }, async (request) => {
  const uid = requireUid(request);
  try {
    return await disconnect(uid, { revoke: true });
  } catch (error) {
    throw asHttpsError(error);
  }
});

/** The current status (for clients that cannot listen to Firestore, such as the desktop API). */
export const calendarStatus = onCall(async (request) => loadStatus(requireUid(request)));

export const calendarOnConnectionWritten = onDocumentWritten('users/{uid}/private/googleCalendar', async (event) => {
  const uid = event.params.uid;
  const connection = readConnection(event.data?.after.data());
  if (connection) {
    await registerConnection(uid, connection);
    await reconcile(uid, 'connected');
    return;
  }
  // Deleted (by calendarDisconnect, which has cleaned up already, or by hand): make sure nothing is left.
  const db = getFirestore();
  const status = await loadStatus(uid);
  await db.collection(REGISTRY).doc(uid).delete();
  if (status.scopeGranted) {
    logger.info('Connection removed; clearing derived documents', { uid });
    await disconnect(uid, { revoke: false });
  }
});

export const calendarOnTaskWritten = onDocumentWritten('users/{uid}/tasks/{taskId}', async (event) => {
  const { uid, taskId } = event.params;
  // Cheap gate first: only accounts in the registry have a connection.
  const registered = await getFirestore().collection(REGISTRY).doc(uid).get();
  if (!registered.exists) return;
  await pushOne(uid, taskId);
});

export const calendarSyncEvery15Minutes = onSchedule(
  { schedule: 'every 15 minutes', timeoutSeconds: 540, memory: '512MiB', retryCount: 0 },
  async () => {
    const accounts = await getFirestore().collection(REGISTRY).get();
    const uids = accounts.docs.map((d: QueryDocumentSnapshot) => d.id);
    logger.info('Scheduled calendar sync', { accounts: uids.length });
    let next = 0;
    const worker = async () => {
      while (next < uids.length) {
        const uid = uids[next++];
        try {
          await reconcile(uid, 'schedule');
        } catch (error) {
          logger.error('Scheduled sync failed for an account', { uid, error });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SCHEDULE_CONCURRENCY, uids.length) }, worker));
  },
);
