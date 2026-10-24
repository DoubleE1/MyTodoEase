import { useState } from 'react';
import { signInWithGoogle } from '../api/firestoreClient';
import { GoogleMark } from './GoogleMark';
import { Logo } from './Logo';

/** Web app sign-in page (the hosted build has no local data to fall back to). */
export function SignInScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      setError(
        code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request'
          ? null
          : code === 'auth/popup-blocked'
            ? 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.'
            : (e as Error).message || 'Sign-in failed.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin-screen">
      <div className="signin-card">
        <Logo size={44} />
        <h1>MyTodoEase</h1>
        <p>Your tasks, synced to your Google account and available on every device.</p>
        <button type="button" className="btn google-btn signin-btn" onClick={() => void signIn()} disabled={busy}>
          <GoogleMark size={18} />
          <span>{busy ? 'Signing in…' : 'Continue with Google'}</span>
        </button>
        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}
        <p className="signin-footnote">Only your tasks are stored. Nothing is shared with anyone.</p>
      </div>
    </div>
  );
}
