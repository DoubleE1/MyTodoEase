# MyTodoEase

A Todoist-style todo app: Windows desktop shell (Electron) around a React UI, backed by an ASP.NET Core API with an embedded LiteDB database. Nothing else to install.
The same React code is also served as a web app (https://mytodoease.web.app) backed by Firestore, and once you
sign in with Google on the desktop both use the same cloud data, so tasks follow you across PCs and browsers
(see [Cloud sync](#cloud-sync-desktop--web)). Without signing in the desktop keeps everything in its local file.

## Stack

| Layer    | Tech                                              | Folder      |
| -------- | ------------------------------------------------- | ----------- |
| Desktop  | Electron 41                                       | `desktop/`  |
| UI       | React 19, Vite 8, TypeScript, TanStack Query      | `frontend/` |
| API      | ASP.NET Core minimal API (.NET 10), LiteDB         | `backend/`  |
| Database | LiteDB (embedded, single file)                    | `%LOCALAPPDATA%\MyTodoEase\mytodoease.db` |

## Prerequisites

- Node 20 (`nvm use 20`, see `.nvmrc`)
- .NET 10 SDK

## Run in development

```bash
npm install
npm run dev       # API (5080) + Vite (5173) + Electron window
```

Data lives in `%LOCALAPPDATA%\MyTodoEase\mytodoease.db`, shared by development runs and the installed app.
Set `MYTODOEASE_DATA_DIR` (or `Storage:Path` in `appsettings.json`) to store it somewhere else.

Or run pieces individually: `npm run api`, `npm run web`, `npm run desktop`.
The API also works from a browser at http://localhost:5173 without Electron.

## Features (v1)

- Projects with colors, favorites, and sections
- Tasks with description, due date and time, priority P1 to P4, labels, sub-tasks
- Recurring tasks (daily, weekdays, weekly, every 2 weeks, monthly, yearly; quick-add understands "every 2 weeks", "biweekly", "fortnightly"); completing one rolls it to the next date
- Views: Inbox, Today (with overdue and "reschedule to today"), Upcoming (7 days + later), per project, per label, search, Completed
- Collapsible groups: click a section heading (or a day heading in Upcoming) to fold it; the state is remembered per device
- Time-blocking (Calendar → Week): an hour-by-hour timeline per day with your Google events and timed tasks as blocks. Drag a task from the all-day row, the "No date" panel or another slot onto a time to block it; drag a block's bottom edge to change its length (tasks carry a duration, default 30 minutes); double-click an empty slot to add a task there. **Plan my day** (Week view and Today view) slots today's untimed and overdue tasks into the free gaps between meetings, highest priority first, from now until 6 pm
- Calendar: month grid; drag a task to another day to reschedule it, drag undated tasks from the "No date" panel onto a day, "+" on a day to add a task there. Recurring tasks also show faded, dashed previews on the future dates they will roll to (click one to open the task; a recurring task is still a single task that moves forward when completed)
- Dashboard card in the sidebar: today's progress ring, a status line, last-7-days bars, streak, overdue shortcut
- Insights page (click the dashboard): GitHub-style year heatmap of completions with a year switcher, streaks, best day, weekday pattern, and top projects. Completions are kept in a separate log so recurring tasks and later-deleted tasks still count
- Light, dark, or follow-system theme (toggle at the bottom of the sidebar, remembered between launches)
- Pin on top: keeps the window above other windows (desktop only, button in the title bar next to minimize)
- Settings (sidebar footer): theme choice, accent color (presets or any custom color; the whole palette, brand gradient and header halos are derived from it in OKLCH and remembered per device), Account (cloud sync, below), Google Calendar, AI assistants, and Data backup. **Export backup…** writes one JSON file with every project, section, label, task and completion; **Import backup…** replaces all data with such a file (after confirmation). In local mode data lives only on this computer, so this is how you back up, move to another PC, or recover after a reinstall; in cloud mode the same buttons back up and restore the cloud data (`GET /api/backup`, `POST /api/backup/import`)
- Dock (mini mode, Windows): a title bar button reserves the mini window as a Windows app bar on the right screen edge, like the taskbar, so maximized apps stop at its edge instead of covering it. While docked only Close is shown; dragging or snapping the window puts it back. Expanding to the full window releases the strip and going back to mini re-docks, until you undock explicitly. The dock state survives restarts. Uses the small .NET helper in `desktop/appbar` (built by `npm run build:appbar` as a self-contained exe)
- Mini mode: shrinks the window to a small two-pane list. Today (with overdue) on top; below it a pane you choose (No date, Inbox, Upcoming, any project, any label, or hidden) with a draggable divider. Add, complete, edit, and delete work in both panes; the window size, pane choice, and split are remembered (title bar button; sidebar footer in the browser)
- Quick add with natural-language parsing: `Pay rent tomorrow at 9am p1 #Home @finance every month`
- Drag and drop (project views): grab the handle at the left of a row to reorder tasks or move them between sections; works with the keyboard too (focus the handle, Space to pick up, arrows to move, Space to drop)
- Keyboard: `q` opens quick add, `Enter` adds, `Esc` cancels

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

## Logo and icons

The source artwork is `desktop/build/source-icon.webp`. The in-app logo (`frontend/src/assets/logo.png`), favicon
(`frontend/public/logo.png`), and the Windows icon (`desktop/build/icon.png`, `icon.ico`) are that image cropped to the
tile with transparent rounded corners. To regenerate after replacing the artwork, crop the tile, apply a rounded-rect
alpha mask (radius about 23% of the side), and export 512px PNGs plus an ICO with 16 to 256px entries.

## Configuration

- API: `backend/MyTodoEase.Api/appsettings.json` → `Storage.Path` (LiteDB file; empty = `%LOCALAPPDATA%\MyTodoEase\mytodoease.db`), or the `MYTODOEASE_DATA_DIR` environment variable
- UI: `frontend/.env` holds the public Firebase web config (`VITE_FIREBASE_*`, used by both the desktop renderer and the web build; tracked in git). `VITE_API_URL` (default `http://localhost:5080`) can be overridden in the git-ignored `frontend/.env.local`

## Publish a release

The installer is distributed through [GitHub Releases](https://github.com/DoubleE1/MyTodoEase/releases); the landing
page's **Download for Windows** button always fetches `releases/latest/download/MyTodoEase-Setup.exe`, so the asset
name must stay `MyTodoEase-Setup.exe` (the release tag carries the version). After `npm run build`:

```bash
gh release create v0.1.0 release/MyTodoEase-Setup.exe --title "MyTodoEase 0.1.0" --generate-notes
```

(or create the release on GitHub and drag `release/MyTodoEase-Setup.exe` into it). Bump `version` in the three
`package.json` files first so the installer and the tag agree.

## Build a Windows installer

```bash
npm run build
```

This publishes the API (`desktop/build/api`) and the app-bar helper (`desktop/build/appbar`) as self-contained
Windows executables (no .NET runtime needed on the target PC), builds the UI into `desktop/renderer/`, and runs
electron-builder, which writes `release/MyTodoEase-Setup.exe` (NSIS, per-user, choosable install folder,
desktop + Start Menu shortcuts) plus the unpacked app in `release/win-unpacked/`.

The installed `MyTodoEase.exe` starts the bundled API on `http://localhost:5080` (unless something already answers
there), waits for it to become healthy, and stops it on exit. The database is an embedded LiteDB file, so a clean PC
needs nothing else installed. If the API cannot start, the app shows a dialog saying so and keeps retrying in the
window. Override the API address with the `MYTODOEASE_API_URL` environment variable.

## Cloud sync (desktop ↔ web)

Settings → Account → **Sign in with Google** switches the desktop app from its local file to the cloud: tasks,
projects, sections, labels and completion history then live in Firestore under your Google account (project
`mytodoease-883bf`, `users/{uid}/…`, the same tree the web app uses), update live on every signed-in device, and the
web app at https://mytodoease.web.app shows exactly the same data. Sign out and the PC goes back to its local
file; the cloud data stays in your account.

- **Sign-in flow.** Firebase's Google popup cannot run inside Electron, so the renderer asks the local API for a
  one-time page (`POST /api/auth/firebase/start` → `http://localhost:5080/api/auth/firebase/page?state=…`) and
  opens it in your default browser. That page loads the Firebase SDK, runs the normal Google popup and posts the
  Google ID token back to the API (same origin); the app polls `GET /api/auth/firebase/pending/{state}` and finishes
  with `signInWithCredential`. `localhost` is one of Firebase's default authorized domains, so no console setup is
  needed. The Firebase session is persisted by the SDK inside the app (IndexedDB), like in the web app.
- **Data layer.** `frontend/src/api/client.ts` exposes one `api` object that routes each call to the active backend:
  the REST client (local) or the Firestore client (cloud, `firestoreClient.ts`). `SessionGate.tsx` flips it when the
  Firebase user appears or leaves, clears the query cache and re-mounts the app. Google Calendar settings and sync
  stay on the local API in both modes.
- **Local API follows the session.** After signing in, the renderer shares the Firebase refresh token with the API
  (`PUT /api/cloud/session`, stored DPAPI-encrypted in `%LOCALAPPDATA%\MyTodoEase\cloud-session.json`). While a
  session exists every `/api/projects|sections|labels|tasks|stats|backup` call is served from Firestore through the
  Firestore REST API (`Data/FirestoreStore.cs`, under the same security rules) instead of LiteDB
  (`Data/LiteDbStore.cs`), so the **MCP server** and **Google Calendar sync** read and write the same cloud data as
  the apps without changes. `GET /api/health` reports `cloud: true` and the account. The renderer's Firestore
  listener also posts changed task ids to `POST /api/calendar/changed`, so the calendar mirror reacts to edits made
  in the app or on another device right away (a full reconcile still runs on sign-in and every 15 minutes).
- **Moving local data.** After the first sign-in, Settings → Account shows how many tasks the local file still holds
  and offers **Move local data to the cloud** (local backup export `GET /api/backup/local` → cloud import, replacing
  the cloud data after confirmation). The local file is left unchanged as a backup.

## Google Calendar connection

Settings → Google Calendar connects a Google account for calendar access (this is separate from the cloud account:
it is an OAuth grant held by the local API on this PC). The app uses the OAuth 2.0 authorization-code flow with
PKCE and a loopback redirect into the local API; the refresh token and client secret are stored in
`%LOCALAPPDATA%\MyTodoEase\google-auth.json`, encrypted with Windows DPAPI for your user.

The app ships with its OAuth client, so users just click **Connect Google Calendar**. To build with your own client (free):

1. Open [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials) and
   create a project if you have none.
2. Configure the OAuth consent screen (External, app name "MyTodoEase", your email). While the app is in **Testing**,
   add the Google addresses that may sign in under Test users.
3. Create credentials → OAuth client ID → Application type **Desktop app** → Download JSON.
4. Save that file as `backend/MyTodoEase.Api/google-client.json` (git-ignored). The build copies it next to the API,
   which reads `installed.client_id` / `installed.client_secret` from it.

Alternatives: `MYTODOEASE_GOOGLE_CLIENT_ID` / `MYTODOEASE_GOOGLE_CLIENT_SECRET` environment variables, or
`Google:ClientId` / `Google:ClientSecret` in `appsettings.json`. Without any client the Account section shows a form to
paste one, stored encrypted on that PC. Google treats a desktop client's secret as non-confidential.
Endpoints: `GET /api/auth/google` (status), `PUT /api/auth/google/config`, `POST /api/auth/google/start` (consent
URL), `GET /api/auth/google/callback`, `POST /api/auth/google/cancel`, `DELETE /api/auth/google` (revoke + forget).

## Google Calendar sync

Settings → Google Calendar, once connected, offers two things (they work in local and in cloud mode; in cloud mode
the mirror follows the cloud tasks):

- **Mirror tasks to Google Calendar**: every open task with a due date becomes an event in a dedicated "MyTodoEase"
  calendar (all-day, or 30 minutes at the due time; recurring tasks become recurring events with an RRULE). Creating,
  editing, rescheduling, completing or deleting a task updates or removes its event. Pushes are queued per task and a
  full reconcile runs on enable and every 15 minutes; "Sync now" forces one. Turning the switch off deletes the mirrored
  events. Links between tasks and events live in the `calendar_links` collection; settings in
  `%LOCALAPPDATA%\MyTodoEase\calendar-sync.json`.
- **Show these calendars**: events from the Google calendars you tick appear in the Calendar grid, and under the day
  headings in Today and Upcoming (read-only; click one to open it in Google). The MyTodoEase mirror calendar is always
  excluded so tasks never show twice.

Endpoints: `GET/PUT /api/calendar/sync`, `POST /api/calendar/sync/run`, `GET /api/calendar/calendars`,
`GET /api/calendar/events?from&to` (local dates, at most 120 days).

## Web app (Firebase Hosting + Firestore)

Live at **https://mytodoease.web.app** (Firebase project `mytodoease-883bf`, Hosting site `mytodoease`, Firestore in asia-southeast1).

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

The installer bundles the server as `resources/mcp/index.mjs` and runs it through `MyTodoEase.exe` in Node mode
(`ELECTRON_RUN_AS_NODE=1`), so end users need no separate Node.js install. In a development checkout the snippets
point at `node mcp/dist/index.js` instead (`npm run build:mcp` builds both). [mcp/README.md](mcp/README.md) has
the manual commands and the tool list.

## Not yet

- The local API itself has no auth and CORS is wide open (it only listens on localhost; cloud data is protected by Firebase Auth and Firestore rules)
- Reordering projects, sections, or sub-tasks by drag (only top-level tasks are draggable)
- Comments, attachments, reminders, notifications
- Email / Telegram integration and email-to-task analysis
