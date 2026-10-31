import { ChevronDown, Laptop, LogOut, Monitor, Moon, Settings, ShoppingBag, Sun, Trophy, UserRoundPen } from 'lucide-react';
import { useState } from 'react';
import { IS_WEB_APP } from '../api/backend';
import { signOutOfCloud, SignInCancelled, startDesktopSignIn } from '../api/cloudSession';
import { signInWithGoogle } from '../api/firestoreClient';
import type { ThemePreference } from '../lib/theme';
import type { View } from '../lib/views';
import { showToast } from '../lib/toast';
import type { ConfirmOptions } from './Dialogs';
import { Popover } from './Popover';
import { useCloudUser } from './SessionGate';
import { t } from '../i18n';

const THEMES: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: t('Light'), icon: <Sun size={14} /> },
  { value: 'dark', label: t('Dark'), icon: <Moon size={14} /> },
  { value: 'system', label: t('System'), icon: <Monitor size={14} /> },
];

/** Shortcut shown next to Settings (handled in App). */
const SETTINGS_SHORTCUT = /Mac/i.test(navigator.platform) ? '⌘,' : 'Ctrl+,';

/**
 * Sidebar footer profile button and its menu: who is signed in (or "This PC" for the local file), Achievements,
 * the Shop, Settings, the theme, and for a Google account: switch account and sign out. Switching signs in again with the account chooser; Firebase replaces the current user only when
 * that succeeds, so cancelling leaves the current account in place.
 */
export function ProfileMenu({
  confirm,
  rail,
  onOpenSettings,
  onSelectView,
  themePreference,
  onSetTheme,
}: {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** The sidebar shows icons only: the button is just the avatar. */
  rail: boolean;
  onOpenSettings: () => void;
  onSelectView: (view: View) => void;
  themePreference: ThemePreference;
  onSetTheme: (preference: ThemePreference) => void;
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
      showToast(error instanceof Error ? error.message : t('Could not switch account.'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    const ok = await confirm({
      title: t('Sign out?'),
      message: IS_WEB_APP
        ? t('You can sign in again any time; your tasks stay in your account.')
        : 'This PC goes back to the tasks stored locally on this computer. Your cloud tasks stay in your Google account.',
      confirmLabel: t('Sign out'),
    });
    if (!ok) return;
    setBusy('signout');
    try {
      await signOutOfCloud();
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('Could not sign out.'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const name = user ? (user.displayName ?? user.email ?? t('Account')) : t('This PC');
  const where = user ? t('Cloud') : t('Local');
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
              <ChevronDown size={14} className="profile-btn-chevron" aria-hidden="true" />
            </>
          )}
        </button>
      )}
    >
      {(close) => (
        <div className="account-menu" role="menu">
          <div className="account-menu-identity">
            <strong>{user?.email ?? t('This PC')}</strong>
            <span className="muted small">
              {user ? t('Synced through your Google account') : t('Tasks are stored on this computer')}
            </span>
          </div>
          {(
            [
              ['achievements', t('Achievements'), <Trophy key="a" size={14} />],
              ['shop', t('Shop'), <ShoppingBag key="s" size={14} />],
            ] as const
          ).map(([kind, label, icon]) => (
            <button
              key={kind}
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                close();
                onSelectView({ kind });
              }}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
          <div className="menu-sep" role="separator" />
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
            <span>{t('Settings')}</span>
            <kbd className="menu-item-kbd">{SETTINGS_SHORTCUT}</kbd>
          </button>
          {/* Theme: pick one; the menu stays open so the change can be seen. */}
          <div className="menu-theme" role="group" aria-label={t('Theme')}>
            <span className="menu-theme-label">{t('Theme')}</span>
            <div className="menu-theme-options">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`menu-theme-option ${themePreference === t.value ? 'is-selected' : ''}`}
                  aria-pressed={themePreference === t.value}
                  aria-label={t.label}
                  data-tooltip={t.label}
                  onClick={() => onSetTheme(t.value)}
                >
                  {t.icon}
                </button>
              ))}
            </div>
          </div>
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
                <span>{busy === 'switch' ? t('Waiting for Google…') : t('Switch Google account')}</span>
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
                <span>{t('Sign out')}</span>
              </button>
            </>
          )}
        </div>
      )}
    </Popover>
  );
}
