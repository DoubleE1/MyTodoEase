import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarSync, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IS_WEB_APP } from '../api/backend';
import { api } from '../api/client';
import { GOOGLE_CALENDAR_SCOPE, queryKeys, useCalendarSync } from '../api/hooks';
import { showToast } from '../lib/toast';

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

/** Settings section: grant Google Calendar access, mirror tasks to Google, choose calendars to show. */
export function CalendarSyncSection({ signedIn }: { signedIn: boolean }) {
  // Build-time constant, so the early return never changes between renders.
  if (IS_WEB_APP) return <CalendarSyncUnavailable />;
  return <CalendarSyncSectionDesktop signedIn={signedIn} />;
}

function CalendarSyncUnavailable() {
  return (
    <section className="settings-section">
      <h3>Google Calendar</h3>
      <p className="settings-help">
        Two-way Google Calendar sync runs in the Windows desktop app for now. Tasks you add here appear there as soon
        as you sign in with the same Google account and restore a backup.
      </p>
    </section>
  );
}

function CalendarSyncSectionDesktop({ signedIn }: { signedIn: boolean }) {
  const queryClient = useQueryClient();
  const sync = useCalendarSync();
  const [waiting, setWaiting] = useState(false);
  const googleStatus = useQuery({
    queryKey: ['google-auth'],
    queryFn: api.googleAuth.status,
    enabled: waiting,
    refetchInterval: waiting ? 1500 : false,
  });
  const calendars = useQuery({
    queryKey: ['calendar', 'list'],
    queryFn: api.calendar.calendars,
    enabled: sync.data?.scopeGranted === true,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!waiting) return;
    const scopes = googleStatus.data?.account?.scopes ?? [];
    if (scopes.includes(GOOGLE_CALENDAR_SCOPE)) {
      setWaiting(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendarSync });
      showToast('Google Calendar access granted.');
    } else if (googleStatus.data && !googleStatus.data.pending) {
      setWaiting(false);
    }
  }, [waiting, googleStatus.data, queryClient]);

  const invalidateEvents = () => queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents });

  const grant = useMutation({
    mutationFn: async () => {
      const { url } = await api.googleAuth.start([GOOGLE_CALENDAR_SCOPE]);
      if (!(await openInBrowser(url))) throw new Error('Could not open the browser. Copy this link manually: ' + url);
    },
    onSuccess: () => setWaiting(true),
    onError: (error) => showToast(error instanceof Error ? error.message : 'Could not start.', 'error'),
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

  if (!signedIn) return null;
  const data = sync.data;

  return (
    <section className="settings-section">
      <h3>Google Calendar</h3>
      {!data && <p className="settings-help">Checking…</p>}

      {data && !data.scopeGranted && (
        <>
          <p className="settings-help">
            Show your Google Calendar events next to your tasks, and mirror dated tasks into a “MyTodoEase” calendar so
            they appear on your phone. Needs permission to read and write your calendars.
          </p>
          <div className="settings-actions">
            {waiting ? (
              <span className="settings-help">Finish granting access in your browser…</span>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => grant.mutate()} disabled={grant.isPending}>
                <CalendarSync size={14} />
                <span>Allow calendar access</span>
              </button>
            )}
          </div>
        </>
      )}

      {data && data.scopeGranted && (
        <>
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
                Open tasks with a date become events in a “MyTodoEase” calendar; completing or deleting removes them.
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
            <span className="settings-field-label">Show these calendars in MyTodoEase</span>
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
