import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, LogOut, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IS_WEB_APP } from '../api/backend';
import { CalendarConnectCancelled, connectCalendarWeb } from '../api/calendarConnect';
import { api, getDataMode } from '../api/client';
import { GOOGLE_CALENDAR_SCOPE, queryKeys, useCalendarSync } from '../api/hooks';
import type { GoogleAuthStatus } from '../api/types';
import { showToast } from '../lib/toast';
import type { ConfirmOptions } from './Dialogs';
import { GoogleMark } from './GoogleMark';

const STATUS_KEY = ['google-auth'] as const;
const SETUP_URL = 'https://console.cloud.google.com/apis/credentials';
/** Desktop, cloud mode: how long to wait for the cloud to pick up a permission the local API just received. */
const CLOUD_PICKUP_TIMEOUT_MS = 60_000;

async function openInBrowser(url: string): Promise<boolean> {
  const desktop = window.mytodoease;
  if (desktop?.openExternal) return desktop.openExternal(url);
  return window.open(url, '_blank', 'noopener') !== null;
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Settings > Google Calendar, the same on every platform. The status, the mirror switch, "Sync now" and the
 * calendar picker all go through `api.calendar`: in the cloud (web app, or desktop while signed in) that is the
 * Firestore documents the Cloud Functions maintain, so a sync that ran server-side shows up here by itself;
 * in the desktop's local mode it is the local API, which syncs while the app is open.
 *
 * Granting the permission differs: the web app opens Google's consent popup and hands the code to a function;
 * the desktop opens the same Google sign-in in the browser, and its local API keeps the token (and uploads it
 * to the cloud when signed in).
 */
export function CalendarSyncSection({ confirm }: { confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const queryClient = useQueryClient();
  const sync = useCalendarSync();
  const cloud = getDataMode() === 'cloud';
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const waiting = waitingSince !== null;

  // Desktop only: the local API's Google account (is an OAuth client configured, did the browser tab finish?).
  const googleStatus = useQuery({
    queryKey: STATUS_KEY,
    queryFn: api.googleAuth.status,
    enabled: !IS_WEB_APP,
    refetchInterval: waiting ? 1500 : false,
  });
  // While the browser tab is open, poll the sync status so the section flips to "connected" by itself.
  useQuery({ queryKey: queryKeys.calendarSync, queryFn: api.calendar.syncStatus, enabled: waiting, refetchInterval: 2000 });
  const calendars = useQuery({
    queryKey: queryKeys.calendarList,
    queryFn: api.calendar.calendars,
    enabled: sync.data?.scopeGranted === true,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!waiting) return;
    if (sync.data?.scopeGranted) {
      setWaitingSince(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarList });
      showToast(`Google Calendar connected${sync.data.account?.email ? ` as ${sync.data.account.email}` : ''}.`);
      return;
    }
    const status = googleStatus.data;
    if (!status) return;
    const grantedLocally = (status.account?.scopes ?? []).includes(GOOGLE_CALENDAR_SCOPE);
    if (grantedLocally) {
      // Cloud mode: the local API uploads the token and the cloud syncs once; the status document then flips.
      if (cloud && Date.now() - waitingSince > CLOUD_PICKUP_TIMEOUT_MS) {
        setWaitingSince(null);
        showToast('Google granted access, but the cloud sync has not picked it up yet. Try Sync now in a minute.', 'error');
      }
    } else if (!status.pending) {
      // The callback ran but failed or was cancelled; the browser tab explains why.
      setWaitingSince(null);
    }
  }, [waiting, waitingSince, cloud, sync.data, googleStatus.data, queryClient]);

  const updateGoogleStatus = (next: GoogleAuthStatus) => queryClient.setQueryData(STATUS_KEY, next);
  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.calendarSync });
    void queryClient.invalidateQueries({ queryKey: queryKeys.calendarList });
    void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents });
    if (!IS_WEB_APP) void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
  };

  const configure = useMutation({
    mutationFn: () => api.googleAuth.configure(clientId.trim(), clientSecret.trim()),
    onSuccess: (next) => {
      updateGoogleStatus(next);
      setShowSetup(false);
      setClientSecret('');
      showToast('Google client saved.');
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'Could not save.', 'error'),
  });

  const connect = useMutation({
    mutationFn: async () => {
      if (IS_WEB_APP) {
        const status = await connectCalendarWeb();
        queryClient.setQueryData(queryKeys.calendarSync, status);
        return 'connected' as const;
      }
      // One consent screen asks for identity plus calendar access, whether or not an identity-only grant exists.
      const { url } = await api.googleAuth.start([GOOGLE_CALENDAR_SCOPE]);
      if (!(await openInBrowser(url))) throw new Error('Could not open the browser. Copy this link manually: ' + url);
      return 'waiting' as const;
    },
    onSuccess: (outcome) => {
      if (outcome === 'waiting') {
        setWaitingSince(Date.now());
        return;
      }
      invalidateAll();
      showToast('Google Calendar connected. Your calendar now syncs in the cloud.');
    },
    onError: (error) => {
      if (error instanceof CalendarConnectCancelled) return;
      showToast(error instanceof Error ? error.message : 'Could not connect Google Calendar.', 'error');
    },
  });

  const disconnect = useMutation({
    mutationFn: () => api.calendar.disconnect(),
    onSuccess: () => {
      invalidateAll();
      showToast('Google Calendar disconnected.');
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'Could not disconnect.', 'error'),
  });

  const update = useMutation({
    mutationFn: api.calendar.updateSync,
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.calendarSync, next);
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'Could not save.', 'error'),
  });

  const run = useMutation({
    mutationFn: api.calendar.runSync,
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.calendarSync, next);
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarList });
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents });
      if (next.lastError) showToast(`Sync problem: ${next.lastError}`, 'error');
      else if (next.enabled) showToast(`Synced ${next.linkedTasks} task${next.linkedTasks === 1 ? '' : 's'} to Google Calendar.`);
      else showToast('Calendar events refreshed.');
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'Sync failed.', 'error'),
  });

  const data = sync.data;
  const desktopStatus = googleStatus.data;
  const needsClient = !IS_WEB_APP && desktopStatus !== undefined && (!desktopStatus.configured || showSetup);

  const setupForm = (
    <form
      className="settings-setup"
      onSubmit={(event) => {
        event.preventDefault();
        if (clientId.trim()) configure.mutate();
      }}
    >
      <p className="settings-help">
        This build has no Google OAuth client for the Calendar connection. Paste one from your Google Cloud project (type{' '}
        <strong>Desktop app</strong>); the developer guide explains how to create it. The secret is stored encrypted on this PC.{' '}
        <a href={SETUP_URL} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); void openInBrowser(SETUP_URL); }}>
          Open Google Cloud credentials <ExternalLink size={11} />
        </a>
      </p>
      <label className="settings-input">
        <span>Client ID</span>
        <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234567890-abc.apps.googleusercontent.com" spellCheck={false} />
      </label>
      <label className="settings-input">
        <span>Client secret</span>
        <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} type="password" placeholder="GOCSPX-…" autoComplete="off" />
      </label>
      <div className="settings-actions">
        <button type="submit" className="btn btn-primary" disabled={!clientId.trim() || configure.isPending}>
          {configure.isPending ? 'Saving…' : 'Save client'}
        </button>
        {desktopStatus?.configured && (
          <button type="button" className="btn" onClick={() => setShowSetup(false)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );

  const whereItRuns = cloud
    ? 'Sync runs in the cloud for your account: it works on every device signed in with it, every 15 minutes and whenever a task changes, even while no app is open.'
    : 'In local mode the permission is kept on this PC and sync runs while the app is open; sign in under Account to have it run in the cloud for every device instead.';

  return (
    <section className="settings-section">
      <h3>Google Calendar</h3>
      {(sync.isLoading || (!IS_WEB_APP && googleStatus.isLoading)) && <p className="settings-help">Checking…</p>}
      {sync.error && <p className="settings-help">Could not check the Google Calendar connection.</p>}
      {googleStatus.error && <p className="settings-help">Could not reach the local API to check the Google Calendar connection.</p>}

      {data && !data.scopeGranted && (needsClient ? setupForm : (
        <>
          <p className="settings-help">
            Show your Google Calendar events next to your tasks, and mirror dated tasks into a “TodoEase” calendar so
            they appear on your phone. {whereItRuns}
          </p>
          <div className="settings-actions">
            {waiting ? (
              <>
                <span className="settings-help">Finish granting access in your browser…</span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setWaitingSince(null);
                    void api.googleAuth.cancel();
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="btn google-btn" onClick={() => connect.mutate()} disabled={connect.isPending}>
                <GoogleMark />
                <span>{connect.isPending ? 'Waiting for Google…' : 'Allow calendar access'}</span>
              </button>
            )}
          </div>
        </>
      ))}

      {data?.scopeGranted && (
        <>
          {data.account && (
            <div className="account-card">
              {data.account.picture ? (
                <img className="account-avatar" src={data.account.picture} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="account-avatar account-avatar-fallback">{data.account.name.charAt(0).toUpperCase()}</span>
              )}
              <div className="account-text">
                <strong>{data.account.name}</strong>
                <span className="muted small">Calendar connected · {data.account.email}</span>
              </div>
              <button
                type="button"
                className="btn"
                disabled={disconnect.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Disconnect Google Calendar?',
                    message: cloud
                      ? 'Mirrored events are removed from Google Calendar and the calendar permission is forgotten for your account, on every device. Your account, cloud sync and tasks are not affected.'
                      : 'Mirrored events are removed from Google Calendar and TodoEase forgets the calendar permission. Your account, cloud sync and tasks are not affected.',
                    confirmLabel: 'Disconnect',
                  });
                  if (ok) disconnect.mutate();
                }}
              >
                <LogOut size={14} />
                <span>{disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}</span>
              </button>
            </div>
          )}

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={data.enabled}
              disabled={update.isPending}
              onChange={(e) => update.mutate({ enabled: e.target.checked })}
            />
            <span>
              <strong>Mirror tasks to Google Calendar</strong>
              <span className="muted small">
                Open tasks with a date become events in a “TodoEase” calendar; completing or deleting removes them.
                {cloud ? ' Changes reach Google within seconds, from any device.' : ''}
              </span>
            </span>
          </label>
          <div className="settings-actions settings-sync-row">
            <span className="muted small">
              Last sync {formatWhen(data.lastSyncAt)}
              {data.enabled && data.linkedTasks > 0 && ` · ${data.linkedTasks} task${data.linkedTasks === 1 ? '' : 's'} mirrored`}
              {cloud ? ' · automatic every 15 minutes' : ''}
            </span>
            <button type="button" className="btn" onClick={() => run.mutate()} disabled={run.isPending || update.isPending}>
              <RefreshCw size={14} className={run.isPending || update.isPending ? 'is-spinning' : ''} />
              <span>{run.isPending || update.isPending ? 'Syncing…' : 'Sync now'}</span>
            </button>
          </div>
          {data.lastError && <p className="settings-error">Last sync problem: {data.lastError}</p>}

          <div className="settings-field">
            <span className="settings-field-label">Show these calendars in TodoEase</span>
            {calendars.isLoading && <span className="muted small">Loading calendars…</span>}
            {calendars.error && <span className="settings-error">Could not load your calendars.</span>}
            {calendars.data && calendars.data.length === 0 && !calendars.isLoading && (
              <span className="muted small">Your calendars appear here after the first sync.</span>
            )}
            {calendars.data && calendars.data.length > 0 && (
              <div className="calendar-choices">
                {calendars.data.map((c) => {
                  const selected = data.sourceCalendarIds.length === 0 ? c.primary : data.sourceCalendarIds.includes(c.id);
                  return (
                    <label key={c.id} className="calendar-choice">
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={update.isPending}
                        onChange={(e) => {
                          const base = data.sourceCalendarIds.length === 0
                            ? calendars.data.filter((x) => x.primary).map((x) => x.id)
                            : data.sourceCalendarIds;
                          const next = e.target.checked ? [...new Set([...base, c.id])] : base.filter((id) => id !== c.id);
                          update.mutate({ sourceCalendarIds: next });
                        }}
                      />
                      <span className="dot" style={{ background: c.backgroundColor ?? 'var(--text-muted)' }} />
                      <span>{c.summary}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
