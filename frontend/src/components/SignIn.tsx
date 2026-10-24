import { Apple, BarChart3, Bot, CalendarClock, Download, Repeat, Sparkles, SunMedium } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { signInWithGoogle } from '../api/firestoreClient';
import { GoogleMark } from './GoogleMark';
import { Logo, Wordmark } from './Logo';

const WINDOWS_URL = import.meta.env.VITE_DOWNLOAD_WINDOWS_URL || '';
const MAC_URL = import.meta.env.VITE_DOWNLOAD_MAC_URL || '';

const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <SunMedium size={18} />, title: 'Capture in plain words', text: 'Type "call the dentist tomorrow 3pm every 2 weeks" and it lands in the right place with the right date, time and repeat. Projects, sections, labels, priorities and sub-tasks when you want structure.' },
  { icon: <CalendarClock size={18} />, title: 'Your day on a timeline', text: 'Tasks and Google Calendar events share one hour-by-hour week. Drag a task into a free slot, stretch it to the time it needs, or press Plan my day and let the gaps fill themselves.' },
  { icon: <Repeat size={18} />, title: 'Routines that keep going', text: 'Daily, weekdays, weekly, every two weeks, monthly or yearly. Finish one and it moves to its next date; the finish still counts in your history.' },
  { icon: <BarChart3 size={18} />, title: 'See the year you built', text: 'A heatmap of every finished task, your current streak, your best day and the weekdays you get the most done.' },
  { icon: <Sparkles size={18} />, title: 'A list that stays beside you', text: 'On Windows, shrink the app to a slim always-on-top list, or dock it to the edge of the screen so other windows make room for it.' },
  { icon: <Bot size={18} />, title: 'Talk to it through your assistant', text: 'Claude, Codex and other MCP-capable assistants can read your agenda, add tasks, reschedule and tick things off for you.' },
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
            Plan the day. <span className="landing-gradient">Ease through it.</span>
          </h1>
          <p className="landing-lead">
            TodoEase keeps your tasks and your calendar on one screen. Capture quickly, give each task a time, and
            watch the day fill in around your meetings. It runs in the browser and as a Windows app, and your Google
            account keeps both in step.
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
        <span>TodoEase</span>
        <span>In the browser and on Windows. Your tasks live in your own Google account; the Windows app also works fully offline.</span>
      </footer>
    </div>
  );
}
