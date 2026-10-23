import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { GoogleAuthStatus } from '../api/types';
import { showToast } from '../lib/toast';
import type { ConfirmOptions } from './Dialogs';
import { GoogleMark } from './GoogleMark';

const STATUS_KEY = ['google-auth'] as const;
const SETUP_URL = 'https://console.cloud.google.com/apis/credentials';

/** Open the consent page in the system browser (Electron) or a new tab (web). */
async function openInBrowser(url: string): Promise<boolean> {
  const desktop = window.mytodoease;
  if (desktop?.openExternal) return desktop.openExternal(url);
  return window.open(url, '_blank', 'noopener') !== null;
}

export function GoogleAccountSection({ confirm }: { confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: api.googleAuth.status,
    // While the browser tab is open, poll so the dialog flips to "signed in" by itself.
    refetchInterval: waiting ? 1500 : false,
  });

  useEffect(() => {
    if (waiting && status.data?.signedIn) {
      setWaiting(false);
      showToast(`Signed in as ${status.data.account?.email}.`);
    }
    if (waiting && status.data && !status.data.pending && !status.data.signedIn) {
      // The callback ran but failed or was cancelled; the browser tab explains why.
      setWaiting(false);
    }
  }, [waiting, status.data]);

  const update = (next: GoogleAuthStatus) => queryClient.setQueryData(STATUS_KEY, next);

  const configure = useMutation({
    mutationFn: () => api.googleAuth.configure(clientId.trim(), clientSecret.trim()),
    onSuccess: (next) => {
      update(next);
      setShowSetup(false);
      setClientSecret('');
      showToast('Google client saved.');
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'Could not save.', 'error'),
  });

  const signIn = useMutation({
    mutationFn: async () => {
      const { url } = await api.googleAuth.start();
      // The web app signs in through a popup and is already done when there is no URL to open.
      if (!url) return 'done' as const;
      const opened = await openInBrowser(url);
      if (!opened) throw new Error('Could not open the browser. Copy this link manually: ' + url);
      return 'waiting' as const;
    },
    onSuccess: (outcome) => {
      if (outcome === 'waiting') setWaiting(true);
      else void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'Could not start sign-in.', 'error'),
  });

  const signOut = useMutation({
    mutationFn: api.googleAuth.signOut,
    onSuccess: (next) => {
      update(next);
      showToast('Signed out of Google.');
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'Could not sign out.', 'error'),
  });

  const data = status.data;
  const setupForm = (
    <form
      className="settings-setup"
      onSubmit={(event) => {
        event.preventDefault();
        if (clientId.trim()) configure.mutate();
      }}
    >
      <p className="settings-help">
        This build has no Google OAuth client. Paste one from your Google Cloud project (type{' '}
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
        {data?.configured && (
          <button type="button" className="btn" onClick={() => setShowSetup(false)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );

  return (
    <section className="settings-section">
      <h3>Account</h3>
      {status.isLoading && <p className="settings-help">Checking…</p>}
      {status.error && <p className="settings-help">Could not reach the API to check the Google account.</p>}

      {data && data.signedIn && data.account && (
        <div className="account-card">
          {data.account.picture ? (
            <img className="account-avatar" src={data.account.picture} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="account-avatar account-avatar-fallback">{data.account.name.charAt(0).toUpperCase()}</span>
          )}
          <div className="account-text">
            <strong>{data.account.name}</strong>
            <span className="muted small">{data.account.email}</span>
          </div>
          <button
            type="button"
            className="btn"
            disabled={signOut.isPending}
            onClick={async () => {
              const ok = await confirm({
                title: 'Sign out of Google?',
                message: 'MyTodoEase will forget this account and revoke its access. You can sign in again any time.',
                confirmLabel: 'Sign out',
              });
              if (ok) signOut.mutate();
            }}
          >
            <LogOut size={14} />
            <span>Sign out</span>
          </button>
        </div>
      )}

      {data && !data.signedIn && (data.configured && !showSetup ? (
        <>
          <p className="settings-help">
            Connect your Google account to prepare for email reminders and email-to-task. Identity only for now; features
            ask for extra permissions when you turn them on.
          </p>
          <div className="settings-actions">
            {waiting ? (
              <>
                <span className="settings-help">Finish signing in in your browser…</span>
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
              <>
                <button type="button" className="btn google-btn" onClick={() => signIn.mutate()} disabled={signIn.isPending}>
                  <GoogleMark />
                  <span>Sign in with Google</span>
                </button>
              </>
            )}
          </div>
        </>
      ) : (
        setupForm
      ))}
    </section>
  );
}
