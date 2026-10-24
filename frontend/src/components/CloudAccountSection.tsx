import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudUpload, ExternalLink, LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IS_WEB_APP } from '../api/backend';
import { desktopCloud } from '../api/client';
import { signOutOfCloud, SignInCancelled, startDesktopSignIn, type DesktopSignIn } from '../api/cloudSession';
import { firestoreApi } from '../api/firestoreClient';
import { showToast } from '../lib/toast';
import type { ConfirmOptions } from './Dialogs';
import { GoogleMark } from './GoogleMark';
import { useCloudUser } from './SessionGate';

const WEB_APP_URL = 'https://mytodoease.web.app';

async function openInBrowser(url: string): Promise<void> {
  const desktop = window.mytodoease;
  if (desktop?.openExternal) await desktop.openExternal(url);
  else window.open(url, '_blank', 'noopener');
}

/**
 * Settings > Account: the Google account whose cloud data this app uses.
 * Web app: just the account and sign-out. Desktop: sign in to switch from the local file to the cloud, sign out
 * to go back, and a one-time "move my local data to the cloud" when the local file still holds tasks.
 */
export function CloudAccountSection({ confirm }: { confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const user = useCloudUser();
  const [attempt, setAttempt] = useState<DesktopSignIn | null>(null);
  const attemptRef = useRef<DesktopSignIn | null>(null);

  // Leaving the dialog while the browser tab is open stops waiting; the tab says the attempt expired.
  useEffect(() => () => attemptRef.current?.cancel(), []);

  const signIn = useMutation({
    mutationFn: async () => {
      const started = startDesktopSignIn();
      attemptRef.current = started;
      setAttempt(started);
      try {
        return await started.done;
      } finally {
        attemptRef.current = null;
        setAttempt(null);
      }
    },
    onSuccess: (signedIn) => showToast(`Signed in as ${signedIn.email}. Your tasks now sync through the cloud.`),
    onError: (error) => {
      if (error instanceof SignInCancelled) return;
      showToast(error instanceof Error ? error.message : 'Sign-in failed.', 'error');
    },
  });

  const signOut = useMutation({
    mutationFn: signOutOfCloud,
    onSuccess: () => showToast(IS_WEB_APP ? 'Signed out.' : 'Signed out. This PC is back to its local tasks.'),
    onError: (error) => showToast(error instanceof Error ? error.message : 'Could not sign out.', 'error'),
  });

  return (
    <section className="settings-section">
      <h3>Account</h3>

      {user ? (
        <>
          <div className="account-card">
            {user.photoURL ? (
              <img className="account-avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="account-avatar account-avatar-fallback">{(user.displayName ?? user.email ?? '?').charAt(0).toUpperCase()}</span>
            )}
            <div className="account-text">
              <strong>{user.displayName ?? user.email}</strong>
              <span className="muted small">{user.email}</span>
            </div>
            <button
              type="button"
              className="btn"
              disabled={signOut.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Sign out?',
                  message: IS_WEB_APP
                    ? 'You can sign in again any time; your tasks stay in your account.'
                    : 'This PC goes back to the tasks stored locally on this computer. Your cloud tasks stay in your Google account and keep syncing to your other devices.',
                  confirmLabel: 'Sign out',
                });
                if (ok) signOut.mutate();
              }}
            >
              <LogOut size={14} />
              <span>Sign out</span>
            </button>
          </div>
          <p className="settings-help">
            Your tasks are stored in the cloud under this Google account and synced live to every device signed in with it:
            this PC, other PCs running MyTodoEase, and the web app at{' '}
            <a href={WEB_APP_URL} onClick={(e) => { e.preventDefault(); void openInBrowser(WEB_APP_URL); }}>
              {WEB_APP_URL.replace('https://', '')} <ExternalLink size={11} />
            </a>
            .
          </p>
          {!IS_WEB_APP && <MoveLocalDataCard confirm={confirm} />}
        </>
      ) : (
        <>
          <p className="settings-help">
            Right now your tasks live only on this computer. Sign in with Google to keep them in the cloud instead,
            synced live to the web app and to every PC where you sign in. You can move the tasks on this PC over afterwards.
          </p>
          <div className="settings-actions">
            {attempt ? (
              <>
                <span className="settings-help">Finish signing in in your browser…</span>
                <button type="button" className="btn" onClick={() => attempt.cancel()}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="btn google-btn" onClick={() => signIn.mutate()} disabled={signIn.isPending}>
                <GoogleMark />
                <span>Sign in with Google</span>
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** Desktop, signed in: offer to upload the LiteDB file's contents to the cloud (replacing what is there). */
function MoveLocalDataCard({ confirm }: { confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const queryClient = useQueryClient();
  const local = useQuery({ queryKey: ['backup', 'local'], queryFn: desktopCloud.exportLocal, staleTime: 60_000 });
  const cloud = useQuery({ queryKey: ['backup', 'cloud-size'], queryFn: firestoreApi.backup.export, staleTime: 60_000 });

  const move = useMutation({
    mutationFn: async () => {
      const doc = await desktopCloud.exportLocal();
      return firestoreApi.backup.import(doc);
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries();
      showToast(`Moved ${result.tasks} tasks, ${result.projects} projects and ${result.labels} labels to the cloud.`);
    },
    onError: (error) => showToast(error instanceof Error ? error.message : 'Could not move your data.', 'error'),
  });

  const localDoc = local.data;
  if (!localDoc) return null;
  const localTasks = localDoc.tasks.length;
  const localProjects = localDoc.projects.filter((p) => !p.isInbox).length;
  if (localTasks === 0 && localProjects === 0) return null;

  const cloudTasks = cloud.data?.tasks.length ?? 0;
  const cloudHasData = cloudTasks > 0 || (cloud.data?.projects.filter((p) => !p.isInbox).length ?? 0) > 0;

  return (
    <div className="settings-callout">
      <div>
        <strong>Tasks still on this PC</strong>
        <p className="muted small">
          The local file holds {localTasks} task{localTasks === 1 ? '' : 's'} and {localProjects} project{localProjects === 1 ? '' : 's'} that
          are not in the cloud. Move them over to see them everywhere.{' '}
          {cloudHasData && `The cloud currently has ${cloudTasks} task${cloudTasks === 1 ? '' : 's'}; moving replaces them.`}
        </p>
      </div>
      <button
        type="button"
        className="btn btn-primary"
        disabled={move.isPending || cloud.isLoading}
        onClick={async () => {
          const ok = await confirm({
            title: cloudHasData ? 'Replace cloud data with this PC’s tasks?' : 'Move local tasks to the cloud?',
            message: cloudHasData
              ? `Everything currently in the cloud (${cloudTasks} task${cloudTasks === 1 ? '' : 's'}) is deleted and replaced by the ${localTasks} task${localTasks === 1 ? '' : 's'} stored on this PC. The local file itself is kept unchanged. This cannot be undone.`
              : `The ${localTasks} task${localTasks === 1 ? '' : 's'} and ${localProjects} project${localProjects === 1 ? '' : 's'} stored on this PC are uploaded to your account. The local file is kept unchanged as a backup.`,
            confirmLabel: cloudHasData ? 'Replace and move' : 'Move to the cloud',
          });
          if (ok) move.mutate();
        }}
      >
        <CloudUpload size={14} />
        <span>{move.isPending ? 'Moving…' : 'Move local data to the cloud'}</span>
      </button>
    </div>
  );
}
