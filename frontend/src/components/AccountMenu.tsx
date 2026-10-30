import { ChevronsUpDown, Laptop, LogOut, Minimize2, Settings, UserRoundPen } from 'lucide-react';
import { useState } from 'react';
import { IS_WEB_APP } from '../api/backend';
import { signOutOfCloud, SignInCancelled, startDesktopSignIn } from '../api/cloudSession';
import { signInWithGoogle } from '../api/firestoreClient';
import { showToast } from '../lib/toast';
import type { ConfirmOptions } from './Dialogs';
import { Popover } from './Popover';
import { useCloudUser } from './SessionGate';

/** Shortcut shown next to Settings (handled in App). */
const SETTINGS_SHORTCUT = /Mac/i.test(navigator.platform) ? '⌘,' : 'Ctrl+,';

/**
 * Sidebar footer profile button and its menu: who is signed in (or "This PC" for the local file), Settings,
 * Mini mode (browser only; the desktop title bar has its own), and for a Google account: switch account and
 * sign out. Switching signs in again with the account chooser; Firebase replaces the current user only when
 * that succeeds, so cancelling leaves the current account in place.
 */
export function ProfileMenu({
  confirm,
  rail,
  onOpenSettings,
  onCompact,
}: {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** The sidebar shows icons only: the button is just the avatar. */
  rail: boolean;
  onOpenSettings: () => void;
  /** Mini mode; omitted where the title bar offers it instead. */
  onCompact?: () => void;
}) {
  const user = useCloudUser();
  const [busy, setBusy] = useState<'switch' | 'signout' | null>(null);

  const switchAccount = async () => {
    if (!user) return;
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

  const name = user ? (user.displayName ?? user.email ?? 'Account') : 'This PC';
  const where = user ? 'Cloud' : 'Local';
  const avatar = user ? (
    user.photoURL ? (
      <img className="account-btn-avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
    ) : (
      <span className="account-btn-avatar account-avatar-fallback">{name.charAt(0).toUpperCase()}</span>
    )
  ) : (
    <span className="account-btn-avatar profile-avatar-local">
      <Laptop size={13} />
    </span>
  );

  return (
    <Popover
      align="left"
      trigger={({ onClick, open }) => (
        <button
          type="button"
          className={`profile-btn ${open ? 'is-active' : ''}`}
          onClick={onClick}
          data-tooltip={rail ? `${name} · ${where}` : undefined}
          data-tooltip-side="right"
          aria-label={`${name}: profile and settings`}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {avatar}
          {!rail && (
            <>
              <span className="profile-btn-text">
                <strong>{name}</strong>
                <span className="muted"> · {where}</span>
              </span>
              <ChevronsUpDown size={13} className="profile-btn-chevron" aria-hidden="true" />
            </>
          )}
        </button>
      )}
    >
      {(close) => (
        <div className="account-menu" role="menu">
          <div className="account-menu-identity">
            <strong>{user?.email ?? 'This PC'}</strong>
            <span className="muted small">
              {user ? 'Synced through your Google account' : 'Tasks are stored on this computer'}
            </span>
          </div>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              close();
              onOpenSettings();
            }}
          >
            <Settings size={14} />
            <span>Settings</span>
            <kbd className="menu-item-kbd">{SETTINGS_SHORTCUT}</kbd>
          </button>
          {onCompact && (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                close();
                onCompact();
              }}
            >
              <Minimize2 size={14} />
              <span>Mini mode</span>
            </button>
          )}
          {user && (
            <>
              <div className="menu-sep" role="separator" />
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
            </>
          )}
        </div>
      )}
    </Popover>
  );
}
