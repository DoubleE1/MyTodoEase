import { Wordmark } from './Logo';

const GOOGLE_USER_DATA_POLICY = 'https://developers.google.com/terms/api-services-user-data-policy#additional_requirements_for_specific_api_scopes';
const GOOGLE_PERMISSIONS = 'https://myaccount.google.com/permissions';

/**
 * Public privacy policy for the web app (served at /privacy, no sign-in needed). Google's OAuth consent screen
 * requires a privacy policy link; this page states plainly what the app stores, where, how it is protected and
 * how Google Calendar data and tokens are handled (Google's verification asks for all of these).
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
        <p className="muted">Last updated 31 October 2026</p>

        <h2>What TodoEase stores</h2>
        <p>
          TodoEase stores the tasks, projects, sections, labels, notes and completion history you create. When you sign
          in with Google, this data is kept in a Google Firebase (Cloud Firestore) database under your own Google
          account and is readable only by you; the security rules allow each user to read and write their own data
          only. Without signing in, the Windows app keeps everything in a file on your computer and nothing is sent
          anywhere.
        </p>

        <h2>Your Google account</h2>
        <p>
          Signing in uses Google Sign-In. TodoEase receives your name, email address and profile picture to show who is
          signed in. It does not read your contacts, Gmail or Drive.
        </p>

        <h2>Google Calendar</h2>
        <p>
          Connecting Google Calendar is optional and asks for the calendar permission separately. With it, TodoEase
          does two things, and nothing else:
        </p>
        <ul>
          <li>
            <strong>Shows your events next to your tasks.</strong> It reads the list of your calendars and, from the
            calendars you tick, the events from about two weeks ago to three months ahead. Of each event it keeps the
            title, time, location, calendar name and a link to open it in Google. It does not store attendees, event
            descriptions or attachments.
          </li>
          <li>
            <strong>Mirrors dated tasks into a calendar named “TodoEase”.</strong> It creates that calendar in your
            account and creates, updates and deletes only the events it made there. It never changes events in your
            other calendars.
          </li>
        </ul>
        <p>
          The events it keeps are stored in the same Firestore database as your tasks, under your account, and are
          replaced on every sync. Sync runs when you press <em>Sync now</em> or change a task; TodoEase has no server
          that reads your calendar in the background.
        </p>
        <p>
          TodoEase’s use and transfer to any other app of information received from Google APIs will adhere to the{' '}
          <a href={GOOGLE_USER_DATA_POLICY} target="_blank" rel="noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Google user data is used only to provide the features described
          here, is never used for advertising, never sold, never shared with third parties and never used to train
          AI models, and no person reads it except with your explicit permission to resolve a problem you report.
        </p>

        <h2>How your data is protected</h2>
        <ul>
          <li>
            <strong>Encryption in transit.</strong> All traffic between the app, Google and the database uses HTTPS
            (TLS). The site is served over HTTPS only.
          </li>
          <li>
            <strong>Encryption at rest.</strong> Cloud Firestore encrypts everything it stores at rest with Google
            managed keys. On Windows, the local data file lives inside your own user profile, protected by your
            account.
          </li>
          <li>
            <strong>Access control.</strong> Every request to the database carries your Firebase Authentication
            identity, and the security rules reject any read or write outside your own data and any document that
            does not match the shapes the app writes. There is no administrator path that exposes user data in the
            app.
          </li>
          <li>
            <strong>Google tokens.</strong> In the web app, the calendar permission is a short-lived access token
            (about one hour) that stays in your browser; it is never sent to or stored by TodoEase’s servers or
            database, and Google asks you to confirm again when it expires. In the Windows app, the longer-lived
            refresh token is stored on your computer only, encrypted with the Windows Data Protection API for your
            user account, and it never leaves the device.
          </li>
          <li>
            <strong>Least privilege.</strong> TodoEase requests only the calendar scope it needs and only when you
            choose to connect a calendar; sign-in alone grants no calendar access.
          </li>
          <li>
            <strong>Incident response.</strong> If we learn of a security incident affecting your data, we will notify
            affected users by the email of their Google account without undue delay.
          </li>
        </ul>

        <h2>What TodoEase does not do</h2>
        <ul>
          <li>No advertising, no analytics trackers, no sale or sharing of your data with third parties.</li>
          <li>No access to your data by the developer, other than what Google Cloud operations require.</li>
        </ul>

        <h2>Deleting your data</h2>
        <p>
          <strong>Google Calendar:</strong> Settings → Google Calendar → <em>Disconnect</em> removes the events TodoEase
          mirrored, deletes the stored calendar events and forgets the token; you can also revoke TodoEase at any time
          under{' '}
          <a href={GOOGLE_PERMISSIONS} target="_blank" rel="noreferrer">
            your Google account’s third-party access
          </a>
          . <strong>Everything else:</strong> Settings → Data lets you export everything as a JSON file. To delete your
          cloud data, import an empty backup or ask us to remove your account, which deletes all data stored for it;
          signing out of the Windows app leaves your cloud data untouched until then.
        </p>

        <h2>Contact</h2>
        <p>Questions about this policy: open an issue on the project’s GitHub repository or reply to the email shown on the Google sign-in screen.</p>
      </main>
    </div>
  );
}
