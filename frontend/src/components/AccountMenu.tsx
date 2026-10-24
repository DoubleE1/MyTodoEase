import { LogOut, UserRoundPen } from 'lucide-react';
import { useState } from 'react';
import { IS_WEB_APP } from '../api/backend';
import { signOutOfCloud, SignInCancelled, startDesktopSignIn } from '../api/cloudSession';
import { signInWithGoogle } from '../api/firestoreClient';
import { showToast } from '../lib/toast';
import type { ConfirmOptions } from './Dialogs';
import { Popover } from './Popover';
import { useCloudUser } from './SessionGate';

/**
 * Sidebar footer control for the signed-in Google account: who is signed in, switch to another account, sign out.
 * Switching signs in again with the account chooser; Firebase replaces the current user only when that succeeds,
 * so cancelling leaves the current account in place. Hidden while the desktop app works on its local file.
 */
export function AccountMenu({ confirm }: { confirm: (options: ConfirmOptions) => Promise<boolean> }) {
  const user = useCloudUser();
  const [busy, setBusy] = useState<'switch' | 'signout' | null>(null);
  if (!user) return null;

  const switchAccount = async () => {
    setBusy('switch');
    try {
      const next = IS_WEB_APP ? await signInWithGoogle() : await startDesktopSignIn().done;
      if (next.uid !== user.uid) showToast(`Switched to ${next.email}.`);
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      if (error instanceof SignInCancelled || code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      showToast(error instanceof Error ? error.message : 'Could not switch account.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    const ok = await confirm({
      title: 'Sign out?',
      message: IS_WEB_APP
        ? 'You can sign in again any time; your tasks stay in your account.'
        : 'This PC goes back to the tasks stored locally on this computer. Your cloud tasks stay in your Google account.',
      confirmLabel: 'Sign out',
    });
    if (!ok) return;
    setBusy('signout');
    try {
      await signOutOfCloud();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not sign out.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const initial = (user.displayName ?? user.email ?? '?').charAt(0).toUpperCase();

  return (
    <Popover
      align="left"
      trigger={({ onClick, open }) => (
        <button
          type="button"
          className={`footer-btn footer-btn-icon account-btn ${open ? 'is-active' : ''}`}
          onClick={onClick}
          title={`${user.displayName ?? user.email}: account options`}
          aria-label="Account options"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {user.photoURL ? (
            <img className="account-btn-avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="account-btn-avatar account-avatar-fallback">{initial}</span>
          )}
        </button>
      )}
    >
      {(close) => (
        <div className="account-menu" role="menu">
          <div className="account-menu-identity">
            <strong>{user.displayName ?? user.email}</strong>
            <span className="muted small">{user.email}</span>
          </div>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={busy !== null}
            onClick={() => {
              close();
              void switchAccount();
            }}
          >
            <UserRoundPen size={14} />
            <span>{busy === 'switch' ? 'Waiting for Google…' : 'Switch Google account'}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={busy !== null}
            onClick={() => {
              close();
              void signOut();
            }}
          >
            <LogOut size={14} />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </Popover>
  );
}
