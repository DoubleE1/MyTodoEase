import { Wordmark } from './Logo';

/**
 * Public privacy policy for the web app (served at /privacy, no sign-in needed). Google's OAuth consent screen
 * requires a privacy policy link; this page states plainly what the app stores and where.
 */
export function PrivacyPage() {
  return (
    <div className="landing">
      <header className="landing-header">
        <a href="/" className="landing-home">
          <Wordmark size={26} />
        </a>
      </header>
      <main className="landing-main landing-doc">
        <h1>Privacy policy</h1>
        <p className="muted">Last updated 24 October 2026</p>

        <h2>What TodoEase stores</h2>
        <p>
          TodoEase stores the tasks, projects, sections, labels and completion history you create. When you sign in with
          Google, this data is kept in a Google Firebase (Cloud Firestore) database under your own Google account and is
          readable only by you; the security rules allow each user to read and write their own data only. Without
          signing in, the Windows app keeps everything in a file on your computer and nothing is sent anywhere.
        </p>

        <h2>Your Google account</h2>
        <p>
          Signing in uses Google Sign-In. TodoEase receives your name, email address and profile picture to show who is
          signed in. It does not read your contacts, Gmail or Drive.
        </p>
        <p>
          If you connect Google Calendar in the Windows app, TodoEase asks for calendar permission separately. The
          access token for that permission is stored encrypted on your computer only, and it is used to show your
          calendar events next to your tasks and to mirror dated tasks into a calendar named “TodoEase”. Disconnecting
          removes the mirrored events and forgets the token.
        </p>

        <h2>What TodoEase does not do</h2>
        <ul>
          <li>No advertising, no analytics trackers, no sale or sharing of your data with third parties.</li>
          <li>No access to your data by the developer, other than what Google Cloud operations require.</li>
        </ul>

        <h2>Deleting your data</h2>
        <p>
          Settings → Data lets you export everything as a JSON file. To delete your cloud data, import an empty backup
          or ask us to remove your account; signing out of the Windows app leaves your cloud data untouched until then.
        </p>

        <h2>Contact</h2>
        <p>Questions about this policy: open an issue on the project’s GitHub repository or reply to the email shown on the Google sign-in screen.</p>
      </main>
    </div>
  );
}
