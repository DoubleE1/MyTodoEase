# TodoEase developer guide

How the project is built, run, released and wired together. The product overview is in the
[README](../README.md).

## Stack


| Layer    | Tech                                              | Folder      |
| -------- | ------------------------------------------------- | ----------- |
| Desktop  | Electron 41                                       | `desktop/`  |
| UI       | React 19, Vite 8, TypeScript, TanStack Query      | `frontend/` |
| API      | ASP.NET Core minimal API (.NET 10), LiteDB         | `backend/`  |
| Database | LiteDB (embedded, single file)                    | `%LOCALAPPDATA%\TodoEase\mytodoease.db` |

## Prerequisites


- Node 20 (`nvm use 20`, see `.nvmrc`)
- .NET 10 SDK

## Run in development


```bash
npm install
npm run dev       # API (5080) + Vite (5173) + Electron window
```

Data lives in `%LOCALAPPDATA%\TodoEase\mytodoease.db`, shared by development runs and the installed app.
Set `MYTODOEASE_DATA_DIR` (or `Storage:Path` in `appsettings.json`) to store it somewhere else.

Or run pieces individually: `npm run api`, `npm run web`, `npm run desktop`.
The API also works from a browser at http://localhost:5173 without Electron.

## Configuration


- API: `backend/MyTodoEase.Api/appsettings.json` → `Storage.Path` (LiteDB file; empty = `%LOCALAPPDATA%\TodoEase\mytodoease.db`), or the `MYTODOEASE_DATA_DIR` environment variable
- UI: `frontend/.env` holds the public Firebase web config (`VITE_FIREBASE_*`, used by both the desktop renderer and the web build; tracked in git). The `apiKey` in it is a Firebase web API key: it only identifies the project, every visitor's browser receives it anyway, and it is restricted to Firebase APIs in Google Cloud; data access is enforced by Firebase Auth and `firestore.rules`, so secret-scanning alerts about it are expected. `VITE_API_URL` (default `http://localhost:5080`) can be overridden in the git-ignored `frontend/.env.local`

## Build a Windows installer


```bash
npm run build
```

This publishes the API (`desktop/build/api`) and the app-bar helper (`desktop/build/appbar`) as self-contained
Windows executables (no .NET runtime needed on the target PC), builds the UI into `desktop/renderer/`, and runs
electron-builder, which writes `release/TodoEase-Setup.exe` (NSIS, per-user, choosable install folder,
desktop + Start Menu shortcuts) plus the unpacked app in `release/win-unpacked/`.

The installed `TodoEase.exe` starts the bundled API on `http://localhost:5080` (unless something already answers
there), waits for it to become healthy, and stops it on exit. The database is an embedded LiteDB file, so a clean PC
needs nothing else installed. If the API cannot start, the app shows a dialog saying so and keeps retrying in the
window. Override the API address with the `MYTODOEASE_API_URL` environment variable.

## Publish a release


The installer is distributed through [GitHub Releases](https://github.com/dbo-e/TodoEase/releases); the landing
page's **Download for Windows** button always fetches `releases/latest/download/TodoEase-Setup.exe`, so the asset
name must stay `TodoEase-Setup.exe` (the release tag carries the version). Installed apps update themselves from the
same release (see [Automatic updates](#automatic-updates)), which needs two more assets next to the installer:
`latest.yml` (version, size and sha512 of the installer) and, optionally, `TodoEase-Setup.exe.blockmap` for
differential downloads. electron-builder writes all three into `release/`.

First bump `version` in the four `package.json` files (root, `frontend`, `desktop`, `mcp`) so the installer, the
About tab and the tag agree, commit, and push. Then either:

**A. Build and publish from this machine.** Needs a GitHub token with `repo` (classic) or *Contents: read and write*
(fine-grained) access to `dbo-e/TodoEase` in `GH_TOKEN`:

```bash
GH_TOKEN=ghp_xxx npm run release
```

This runs the full build and then `electron-builder --publish always`, which creates the GitHub release `v<version>`
(tagging the default branch if the tag does not exist yet) and uploads the installer, the blockmap and `latest.yml`.
The release is published immediately, not as a draft (`build.publish.releaseType` in `desktop/package.json`); change
that to `draft` if you prefer to review and publish by hand. Set `GH_TOKEN` in the environment, never in a file
that is committed.

**B. Push a version tag and let GitHub Actions do it.** `.github/workflows/release.yml` builds the installer on a
Windows runner and attaches it, `latest.yml` and the blockmap to a release for that tag (also runnable by hand from
the Actions tab):

```bash
git tag v0.2.0 && git push origin v0.2.0
```

The manual fallback still works, as long as `latest.yml` goes up too:

```bash
gh release create v0.2.0 release/TodoEase-Setup.exe release/TodoEase-Setup.exe.blockmap release/latest.yml --title "TodoEase 0.2.0" --generate-notes
```

Add the repository secret `GOOGLE_CLIENT_JSON` (the contents of `backend/MyTodoEase.Api/google-client.json`) so the
built installer ships the Google Calendar OAuth client; without it users are asked to paste one.

### Automatic updates

The desktop app uses [electron-updater](https://www.electron.build/auto-update) with the GitHub Releases provider
(`build.publish` in `desktop/package.json`, baked into the installed app as `resources/app-update.yml`). GitHub
Releases is the right host for this: it is free and has no bandwidth cap, while Firebase Hosting's free tier
(360 MB of transfer per day) would be exhausted by a couple of downloads of a ~150 MB installer.

How it behaves (`desktop/main.cjs`, bottom):

- Five seconds after start the installed app asks `https://api.github.com/repos/dbo-e/TodoEase/releases/latest`
  for the newest tag, reads that release's `latest.yml` and, if the version is newer, downloads the installer
  silently (to `%LOCALAPPDATA%\todoease-desktop-updater`). Once per start; no retries, no dialogs.
- When the download is complete the UI shows a **Restart to update** banner and Settings → About says the same.
  Nothing is installed until the user clicks it: not on the automatic check, and not on a normal quit either
  (`autoInstallOnAppQuit` is off). A dismissed banner comes back on the next start.
- **Restart to update** stops the bundled API first (the same graceful shutdown as closing the app, so LiteDB flushes
  and the installer can replace `resources/api`), then runs the installer silently, which relaunches the app.
- Offline, or when GitHub is unreachable, the check fails quietly: it is logged to the console and shown as a status
  line in Settings → About, nothing else. The app works as usual.
- In a development run (`npm run dev`) electron-updater does nothing (there is no `app-update.yml`); the shell logs
  that it skipped the check and About shows the version with the check disabled.
- The pre-release and prerelease channels are not used: only the release GitHub marks as *latest* counts, which
  with `make_latest: legacy` in the workflow is the highest version.

Gotchas: electron-updater verifies the installer's sha512 against `latest.yml`, so a release whose installer was
replaced after the fact (code signing included) needs `latest.yml` regenerated from the final file; the workflow
does this. A release without `latest.yml` makes every installed app report "No update information has been
published for the latest release yet" in About; the public download link keeps working regardless.

### Code signing (SignPath Foundation)

Unsigned installers trip Windows SmartScreen until they earn reputation. The workflow is ready to sign through the
[SignPath Foundation](https://signpath.org), which signs open-source releases for free:

1. Apply at signpath.org with this repository (public, MIT licence), the maintainers and the build setup
   (GitHub Actions, workflow `release.yml`, artifact `TodoEase-Setup-unsigned`).
2. When approved, create a project `TodoEase` with a signing policy `release-signing` in SignPath, install the
   SignPath GitHub app on the repository, and add the repository secret `SIGNPATH_API_TOKEN` and the repository
   variable `SIGNPATH_ORGANIZATION_ID`.
3. Push the next tag: the workflow uploads the unsigned installer, waits for SignPath to sign it, and publishes the
   signed file. Until the secret exists the unsigned installer is published as before.

When signing is active, keep this notice in the README, as SignPath requires: *Free code signing provided by
[SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).*

## API


Base URL `http://localhost:5080`. Swagger-style document at `/openapi/v1.json` in Development.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/health` | |
| GET/POST | `/api/projects` | Inbox is created automatically and cannot be deleted |
| PUT/DELETE | `/api/projects/{id}` | Delete cascades to sections and tasks |
| GET/POST | `/api/sections?projectId=` | |
| PUT/DELETE | `/api/sections/{id}` | Delete moves tasks out of the section |
| GET/POST | `/api/labels` | POST is idempotent by name |
| PUT/DELETE | `/api/labels/{id}` | Delete pulls the label from tasks |
| GET | `/api/tasks` | Active tasks. `?completed=true&limit=200` for the completed log |
| POST | `/api/tasks` | |
| PUT/DELETE | `/api/tasks/{id}` | Full update; delete cascades to sub-tasks |
| POST | `/api/tasks/{id}/complete` | Recurring tasks roll forward instead of closing |
| POST | `/api/tasks/{id}/reopen` | |
| POST | `/api/tasks/reorder` | `{ items: [{ id, order, sectionId?, parentId? }] }` |
| GET | `/api/stats/completions?from=yyyy-MM-dd&to=yyyy-MM-dd` | Completion history (local calendar dates) plus the list of years with data |
| GET | `/api/backup` | Whole database as one JSON document (`app`, `version`, `exportedAt`, collections) |
| POST | `/api/backup/import` | Replace all data with a backup document; validates ids, drops dangling references, keeps one Inbox |
| POST | `/api/shutdown` | Stop the API gracefully so LiteDB flushes its log (used by the desktop shell on quit) |

Due dates are stored as plain `yyyy-MM-dd` / `HH:mm` strings (local calendar dates), never as UTC instants, so they do
not shift across time zones.

## Cloud sync (desktop ↔ web)


Settings → Account → **Sign in with Google** switches the desktop app from its local file to the cloud: tasks,
projects, sections, labels and completion history then live in Firestore under your Google account (project
`mytodoease-883bf`, `users/{uid}/…`, the same tree the web app uses), update live on every signed-in device, and the
web app at https://todoease.com shows exactly the same data. Sign out and the PC goes back to its local
file; the cloud data stays in your account.

- **Sign-in flow.** One Google sign-in covers everything. The local API runs the OAuth 2.0 authorization-code flow
  with PKCE and a loopback redirect (`POST /api/auth/google/start` returns the consent URL, which the app opens in
  your default browser) and keeps the refresh token for Google Calendar. The desktop OAuth client lives in the same
  Google Cloud project as Firebase, so the renderer then opens the matching Firebase session with the ID token of
  that very sign-in (`GET /api/auth/google/id-token`, handed out once, then `signInWithCredential`): no second
  consent screen. Google's consent page lists calendar access as a tickable permission; leaving it unticked still
  signs you in, and Settings offers **Allow calendar access** later. The Firebase session is persisted by the SDK
  inside the app (IndexedDB), like in the web app.
- **Data layer.** `frontend/src/api/client.ts` exposes one `api` object that routes each call to the active backend:
  the REST client (local) or the Firestore client (cloud, `firestoreClient.ts`). `SessionGate.tsx` flips it when the
  Firebase user appears or leaves, clears the query cache and re-mounts the app. Google Calendar settings and sync
  stay on the local API in both modes.
- **Local API follows the session.** After signing in, the renderer shares the Firebase refresh token with the API
  (`PUT /api/cloud/session`, stored DPAPI-encrypted in `%LOCALAPPDATA%\TodoEase\cloud-session.json`). While a
  session exists every `/api/projects|sections|labels|tasks|stats|backup` call is served from Firestore through the
  Firestore REST API (`Data/FirestoreStore.cs`, under the same security rules) instead of LiteDB
  (`Data/LiteDbStore.cs`), so the **MCP server** and **Google Calendar sync** read and write the same cloud data as
  the apps without changes. `GET /api/health` reports `cloud: true` and the account. The renderer's Firestore
  listener also posts changed task ids to `POST /api/calendar/changed`, so the calendar mirror reacts to edits made
  in the app or on another device right away (a full reconcile still runs on sign-in and every 15 minutes).
- **Moving local data.** After the first sign-in, Settings → Account shows how many tasks the local file still holds
  and offers **Move local data to the cloud** (local backup export `GET /api/backup/local` → cloud import, replacing
  the cloud data after confirmation). The local file is left unchanged as a backup.

## Google OAuth client (sign-in and Calendar)


The desktop app signs in through an OAuth client of type **Desktop app** that belongs to the Firebase project
(`mytodoease-883bf`), named "TodoEase Desktop". It must be in that project: Firebase only accepts ID tokens issued to
clients of its own project, and that is what lets one consent screen produce both the cloud session and the calendar
permission. The refresh token and the client secret are stored in `%LOCALAPPDATA%\TodoEase\google-auth.json`,
encrypted with Windows DPAPI for your user; the client secret of an installed app is not confidential by Google's own
definition, so bundling it is the standard approach.

The app ships with its client, so users just click **Sign in with Google**. To build with your own client (free):

1. In [Google Cloud Console](https://console.cloud.google.com/) select the Firebase project, enable the **Google
   Calendar API**, and under Google Auth Platform → Data Access add the scope `https://www.googleapis.com/auth/calendar`.
2. Google Auth Platform → Clients → Create client → Application type **Desktop app** → Download JSON.
3. Save that file as `backend/MyTodoEase.Api/google-client.json` (git-ignored). The build copies it next to the API,
   which reads `installed.client_id` / `installed.client_secret` from it; the release workflow takes it from the
   `GOOGLE_CLIENT_JSON` secret. A build whose client differs from the one a user signed in with asks that user to
   sign in again (refresh tokens are bound to the client).

Alternatives: `MYTODOEASE_GOOGLE_CLIENT_ID` / `MYTODOEASE_GOOGLE_CLIENT_SECRET` environment variables, or
`Google:ClientId` / `Google:ClientSecret` in `appsettings.json`. Without any client the Google Calendar tab shows a
form to paste one, stored encrypted on that PC.
Endpoints: `GET /api/auth/google` (status), `PUT /api/auth/google/config`, `POST /api/auth/google/start` (consent
URL), `GET /api/auth/google/callback`, `GET /api/auth/google/id-token` (one-time), `POST /api/auth/google/cancel`,
`DELETE /api/auth/google` (revoke + forget).

Until Google verifies the app for the calendar scope, the consent screen shows its "unverified app" warning for
calendar access and limits it to 100 users; identity-only sign-in has no such limit.

## Google Calendar sync


Settings → Google Calendar, once calendar access is allowed, offers two things (they work in local and in cloud mode;
in cloud mode the mirror follows the cloud tasks):

- **Mirror tasks to Google Calendar**: every open task with a due date becomes an event in a dedicated "TodoEase"
  calendar (all-day, or 30 minutes at the due time; recurring tasks become recurring events with an RRULE). Creating,
  editing, rescheduling, completing or deleting a task updates or removes its event. Pushes are queued per task and a
  full reconcile runs on enable and every 15 minutes; "Sync now" forces one. Turning the switch off deletes the mirrored
  events. Links between tasks and events live in the `calendar_links` collection; settings in
  `%LOCALAPPDATA%\TodoEase\calendar-sync.json`.
- **Show these calendars**: events from the Google calendars you tick appear in the Calendar grid, and under the day
  headings in Today and Upcoming (read-only; click one to open it in Google). The TodoEase mirror calendar can be
  ticked too: events the app mirrored are skipped so tasks never show twice, while events you add to that calendar
  by hand appear like any other.

Endpoints: `GET/PUT /api/calendar/sync`, `POST /api/calendar/sync/run`, `GET /api/calendar/calendars`,
`GET /api/calendar/events?from&to` (local dates, at most 120 days).

## Web app (Firebase Hosting + Firestore)


Live at **https://todoease.com** (custom domain on Firebase Hosting site `mytodoease`, also reachable as https://mytodoease.web.app; Firebase project `mytodoease-883bf`, Firestore in asia-southeast1).

The same React code also runs as a hosted web app where data lives in Firestore under the user's Google account,
so tasks follow the user to any PC or phone browser. `vite build --mode web` picks the Firebase backend
(`frontend/.env.web`, `VITE_BACKEND=firebase`); the desktop app and `npm run dev` start on the local API and switch
to the same Firestore data when the user signs in (see Cloud sync above).

- **Landing page:** signed-out visitors see a landing page (`frontend/src/components/SignIn.tsx`) with
  **Continue with Google** and download buttons; the app itself only renders after sign-in. The download links come
  from `VITE_DOWNLOAD_WINDOWS_URL` / `VITE_DOWNLOAD_MAC_URL` in `frontend/.env.web`; the Windows one points at the
  newest GitHub release asset (see "Publish a release" below) and an empty URL shows the button as "coming soon"
  (there is no macOS build yet).
- **Sign-in:** Firebase Auth with Google (popup). Everything is stored under `users/{uid}/…` and
  `firestore.rules` lets a user read and write only their own tree.
- **Data client:** `frontend/src/api/firestoreClient.ts` implements the same `Api` surface as the REST client,
  including the API's rules (validation, cascades, recurring roll-forward, backup import), and ids keep the 24-hex
  shape, so a backup exported on the desktop imports on the web and back.
- **Live updates:** `frontend/src/api/realtime.ts` feeds Firestore snapshots into the query cache; the SDK's
  persistent cache keeps the app usable offline.
- **Desktop-only for now:** Google Calendar sync and the MCP copy buttons; Settings says so on the web. Both work
  against the cloud data once the desktop app is signed in with the same account.

Setup once: create a Firebase project (Authentication → Google enabled, Firestore in production mode), register a
web app, copy its config into `frontend/.env` (see `.env.web.example`), put the project id in `.firebaserc`,
then:

```bash
npx firebase login
npm run deploy:site      # builds frontend/dist-web, deploys hosting + Firestore rules
```

`npm run dev:site` runs the web build locally on port 5174; `npm run emulators` starts the Auth and Firestore
emulators (needs Java 21+) and `frontend/.env.web.local` with `VITE_FIREBASE_EMULATOR=1` points the app at them.

## MCP server (Claude, Codex, other assistants)


`mcp/` holds an MCP server that exposes the same API as tools, so an AI assistant can list what is due, add and
reschedule tasks, complete them and review your week. It starts the bundled API itself when the desktop app is closed.
It always talks to the local API, which serves the local file or, while the desktop app is signed in, the cloud data.

The easiest way to connect is **Settings → AI assistants**, Figma-style: one click copies a ready-to-paste snippet
for this machine. "Copy setup prompt" produces a natural-language prompt (with the config embedded) that you paste
into any AI chat and the assistant registers the connection itself; the other buttons copy a `claude mcp add`
command, a `codex mcp add` command, or the `mcpServers` JSON block for Claude Desktop, Cursor and Windsurf.

The installer bundles the server as `resources/mcp/index.mjs` and runs it through `TodoEase.exe` in Node mode
(`ELECTRON_RUN_AS_NODE=1`), so end users need no separate Node.js install. In a development checkout the snippets
point at `node mcp/dist/index.js` instead (`npm run build:mcp` builds both). [mcp/README.md](../mcp/README.md) has
the manual commands and the tool list.

## Logo and icons


The source artwork is `desktop/build/source-icon.webp`. The in-app logo (`frontend/src/assets/logo.png`), favicon
(`frontend/public/logo.png`), and the Windows icon (`desktop/build/icon.png`, `icon.ico`) are that image cropped to the
tile with transparent rounded corners. To regenerate after replacing the artwork, crop the tile, apply a rounded-rect
alpha mask (radius about 23% of the side), and export 512px PNGs plus an ICO with 16 to 256px entries.

## Not yet


- The local API itself has no auth and CORS is wide open (it only listens on localhost; cloud data is protected by Firebase Auth and Firestore rules)
- Reordering projects, sections, or sub-tasks by drag (only top-level tasks are draggable)
- Comments, attachments, reminders, notifications
- Email / Telegram integration and email-to-task analysis
