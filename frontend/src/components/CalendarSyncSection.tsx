import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, LogOut, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IS_WEB_APP } from '../api/backend';
import { api } from '../api/client';
import { GOOGLE_CALENDAR_SCOPE, queryKeys, useCalendarSync } from '../api/hooks';
import type { GoogleAuthStatus } from '../api/types';
import { showToast } from '../lib/toast';
import type { ConfirmOptions } from './Dialogs';
import { GoogleMark } from './GoogleMark';

const STATUS_KEY = ['google-auth'] as const;
const SETUP_URL = 'https://console.cloud.google.com/apis/credentials';

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
 * Settings > Google Calendar. The connection is separate from the cloud account: it is an OAuth grant held by the
 * local API on this PC (refresh token for the Calendar API), so it is asked for here, with its own consent screen.
 */
export function CalendarSyncSection({ confirm }: { confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  // Build-time constant, so the early return never changes between renders.
  if (IS_WEB_APP) return <CalendarSyncUnavailable />;
  return <CalendarSyncSectionDesktop confirm={confirm} />;
}

function CalendarSyncUnavailable() {
  return (
    <section className="settings-section">
      <h3>Google Calendar</h3>
      <p className="settings-help">
        Two-way Google Calendar sync runs in the Windows desktop app for now. Sign in there with the same Google
        account and your tasks, including the ones added here, are mirrored to your calendar.
      </p>
    </section>
  );
}

function CalendarSyncSectionDesktop({ confirm }: { confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const queryClient = useQueryClient();
  const sync = useCalendarSync();
  const [waiting, setWaiting] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  const googleStatus = useQuery({
    queryKey: STATUS_KEY,
    queryFn: api.googleAuth.status,
    // While the browser tab is open, poll so the section flips to "connected" by itself.
    refetchInterval: waiting ? 1500 : false,
  });
  const calendars = useQuery({
    queryKey: ['calendar', 'list'],
    queryFn: api.calendar.calendars,
    enabled: sync.data?.scopeGranted === true,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!waiting || !googleStatus.data) return;
    const scopes = googleStatus.data.account?.scopes ?? [];
    if (scopes.includes(GOOGLE_CALENDAR_SCOPE)) {
      setWaiting(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarSync });
      showToast(`Google Calendar connected as ${googleStatus.data.account?.email}.`);
    } else if (!googleStatus.data.pending) {
      // The callback ran but failed or was cancelled; the browser tab explains why.
      setWaiting(false);
    }
  }, [waiting, googleStatus.data, queryClient]);

  const updateStatus = (next: GoogleAuthStatus) => queryClient.setQueryData(STATUS_KEY, next);
  const invalidateEvents = () => queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents });

  const configure = useMutation({
    mutationFn: () => api.googleAuth.configure(clientId.trim(), clientSecret.trim()),
    onSuccess: (next) => {
      updateStatus(next);
      setShowSetup(false);
      setClientSecret('');
      showToast('Google client saved.');
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'Could not save.', 'error'),
  });

  // One consent screen asks for identity plus calendar access, whether or not an identity-only grant exists.
  const connect = useMutation({
    mutationFn: async () => {
      const { url } = await api.googleAuth.start([GOOGLE_CALENDAR_SCOPE]);
      if (!(await openInBrowser(url))) throw new Error('Could not open the browser. Copy this link manually: ' + url);
    },
    onSuccess: () => setWaiting(true),
    onError: (error) => showToast(error instanceof Error ? error.message : 'Could not start.', 'error'),
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      if (sync.data?.enabled) await api.calendar.updateSync({ enabled: false });
      return api.googleAuth.signOut();
    },
    onSuccess: (next) => {
      updateStatus(next);
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarSync });
      void invalidateEvents();
      showToast('Google Calendar disconnected.');
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'Could not disconnect.', 'error'),
  });

  const update = useMutation({
    mutationFn: api.calendar.updateSync,
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.calendarSync, next);
      void invalidateEvents();
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'Could not save.', 'error'),
  });

  const run = useMutation({
    mutationFn: api.calendar.runSync,
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.calendarSync, next);
      void invalidateEvents();
      showToast(`Synced ${next.linkedTasks} task${next.linkedTasks === 1 ? '' : 's'} to Google Calendar.`);
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'Sync failed.', 'error'),
  });

  const status = googleStatus.data;
  const data = sync.data;

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
        <strong>Desktop app</strong>); the README explains how to create it. The secret is stored encrypted on this PC.{' '}
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
        {status?.configured && (
          <button type="button" className="btn" onClick={() => setShowSetup(false)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );

  return (
    <section className="settings-section">
      <h3>Google Calendar</h3>
      {googleStatus.isLoading && <p className="settings-help">Checking…</p>}
      {googleStatus.error && <p className="settings-help">Could not reach the API to check the Google Calendar connection.</p>}

      {status && !data?.scopeGranted && (status.configured && !showSetup ? (
        <>
          <p className="settings-help">
            Show your Google Calendar events next to your tasks, and mirror dated tasks into a “TodoEase” calendar so
            they appear on your phone. Connecting asks Google for permission to read and write your calendars; the
            connection is kept on this PC.
          </p>
          <div className="settings-actions">
            {waiting ? (
              <>
                <span className="settings-help">Finish granting access in your browser…</span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setWaiting(false);
                    void api.googleAuth.cancel();
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="btn google-btn" onClick={() => connect.mutate()} disabled={connect.isPending}>
                <GoogleMark />
                <span>{status.signedIn ? 'Allow calendar access' : 'Connect Google Calendar'}</span>
              </button>
            )}
          </div>
        </>
      ) : (
        setupForm
      ))}

      {status && data?.scopeGranted && (
        <>
          {status.account && (
            <div className="account-card">
              {status.account.picture ? (
                <img className="account-avatar" src={status.account.picture} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="account-avatar account-avatar-fallback">{status.account.name.charAt(0).toUpperCase()}</span>
              )}
              <div className="account-text">
                <strong>{status.account.name}</strong>
                <span className="muted small">Calendar connected · {status.account.email}</span>
              </div>
              <button
                type="button"
                className="btn"
                disabled={disconnect.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Disconnect Google Calendar?',
                    message: 'Mirrored events are removed from Google Calendar and TodoEase forgets this calendar access. Your tasks are not affected.',
                    confirmLabel: 'Disconnect',
                  });
                  if (ok) disconnect.mutate();
                }}
              >
                <LogOut size={14} />
                <span>Disconnect</span>
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
              </span>
            </span>
          </label>
          {data.enabled && (
            <div className="settings-actions settings-sync-row">
              <span className="muted small">
                Last sync {formatWhen(data.lastSyncAt)}
                {data.linkedTasks > 0 && ` · ${data.linkedTasks} task${data.linkedTasks === 1 ? '' : 's'} mirrored`}
              </span>
              <button type="button" className="btn" onClick={() => run.mutate()} disabled={run.isPending}>
                <RefreshCw size={14} className={run.isPending ? 'is-spinning' : ''} />
                <span>{run.isPending ? 'Syncing…' : 'Sync now'}</span>
              </button>
            </div>
          )}
          {data.lastError && <p className="settings-error">Last sync problem: {data.lastError}</p>}

          <div className="settings-field">
            <span className="settings-field-label">Show these calendars in TodoEase</span>
            {calendars.isLoading && <span className="muted small">Loading calendars…</span>}
            {calendars.error && <span className="settings-error">Could not load your calendars.</span>}
            {calendars.data && (
              <div className="calendar-choices">
                {calendars.data
                  .filter((c) => c.id !== data.targetCalendarId)
                  .map((c) => {
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
