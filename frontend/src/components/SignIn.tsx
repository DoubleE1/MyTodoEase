import { Apple, BarChart3, Bot, CalendarClock, Download, Repeat, Sparkles, SunMedium } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { signInWithGoogle } from '../api/firestoreClient';
import { GoogleMark } from './GoogleMark';
import { Logo, Wordmark } from './Logo';

const WINDOWS_URL = import.meta.env.VITE_DOWNLOAD_WINDOWS_URL || '';
const MAC_URL = import.meta.env.VITE_DOWNLOAD_MAC_URL || '';

const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <SunMedium size={18} />, title: 'Today, Upcoming, Inbox', text: 'Projects, sections, labels, priorities and sub-tasks, with quick add that understands "tomorrow 3pm" and "every 2 weeks".' },
  { icon: <CalendarClock size={18} />, title: 'Time-blocking with Google Calendar', text: 'Drag tasks onto an hour-by-hour week next to your meetings, and let Plan my day fill the gaps. Dated tasks mirror to a calendar on your phone.' },
  { icon: <Repeat size={18} />, title: 'Recurring tasks that roll forward', text: 'Daily, weekdays, weekly, every two weeks, monthly or yearly. Completing one moves it to the next date and still counts.' },
  { icon: <BarChart3 size={18} />, title: 'Insights', text: 'A GitHub-style year heatmap of what you finished, streaks, best day and weekday patterns.' },
  { icon: <Sparkles size={18} />, title: 'Mini window and dock', text: 'On Windows, shrink to a small always-on-top list or dock it to the screen edge like the taskbar.' },
  { icon: <Bot size={18} />, title: 'Works with your AI assistant', text: 'Claude, Codex and other MCP clients can list, add, reschedule and complete your tasks through the desktop app.' },
];

/**
 * Web landing page: what signed-out visitors see at the hosted address. Signing in with Google opens the app
 * in the browser; the download buttons give the desktop installers. The app itself is never shown before sign-in.
 */
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
            : code === 'auth/unauthorized-domain'
              ? `${window.location.hostname} is not yet allowed to sign in. Add it under Authentication → Settings → Authorized domains in the Firebase console.`
              : (e as Error).message || 'Sign-in failed.',
      );
    } finally {
      setBusy(false);
    }
  };

  const googleButton = (className: string) => (
    <button type="button" className={`btn google-btn ${className}`} onClick={() => void signIn()} disabled={busy}>
      <GoogleMark size={18} />
      <span>{busy ? 'Signing in…' : 'Continue with Google'}</span>
    </button>
  );

  return (
    <div className="landing">
      <header className="landing-header">
        <Wordmark size={26} />
        {googleButton('landing-header-signin')}
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <Logo size={72} />
          <h1>
            Your tasks, <span className="landing-gradient">everywhere.</span>
          </h1>
          <p className="landing-lead">
            A Todoist-style planner for people who live in their calendar. Use it in the browser, or install the
            desktop app for time-blocking, Google Calendar sync and a dockable mini window. Sign in with Google
            and the same tasks follow you to every device.
          </p>
          <div className="landing-ctas">
            {googleButton('landing-cta')}
            {WINDOWS_URL ? (
              <a className="btn btn-primary landing-cta" href={WINDOWS_URL} download>
                <Download size={16} />
                <span>Download for Windows</span>
              </a>
            ) : (
              <span className="btn landing-cta is-disabled" aria-disabled="true">
                <Download size={16} />
                <span>Windows download coming soon</span>
              </span>
            )}
            {MAC_URL ? (
              <a className="btn landing-cta" href={MAC_URL} download>
                <Apple size={16} />
                <span>Download for macOS</span>
              </a>
            ) : (
              <span className="btn landing-cta is-disabled" aria-disabled="true" title="The macOS build is not available yet">
                <Apple size={16} />
                <span>macOS coming soon</span>
              </span>
            )}
          </div>
          {error && (
            <p className="signin-error" role="alert">
              {error}
            </p>
          )}
          <p className="landing-footnote">
            Free. Only your tasks are stored, under your own Google account. Nothing is shared with anyone.
          </p>
        </section>

        <section className="landing-features" aria-label="Features">
          {FEATURES.map((f) => (
            <article key={f.title} className="landing-feature">
              <span className="landing-feature-icon">{f.icon}</span>
              <h2>{f.title}</h2>
              <p>{f.text}</p>
            </article>
          ))}
        </section>
      </main>

      <footer className="landing-footer">
        <span>MyTodoEase</span>
        <span>Windows desktop app plus web. Your data lives in your Google account; the desktop app can also work fully offline.</span>
      </footer>
    </div>
  );
}
