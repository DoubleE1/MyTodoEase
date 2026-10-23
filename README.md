# MyTodoEase

A Todoist-style todo app: Windows desktop shell (Electron) around a React UI, backed by an ASP.NET Core API with an embedded LiteDB database. Nothing else to install.
The same React code can later be served as a web app, and the API is the single source of truth for a future mobile app
and for notification jobs (email, Telegram).

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
- Calendar: month and week grids; drag a task to another day to reschedule it, drag undated tasks from the "No date" panel onto a day, "+" on a day to add a task there. Recurring tasks also show faded, dashed previews on the future dates they will roll to (click one to open the task; a recurring task is still a single task that moves forward when completed)
- Dashboard card in the sidebar: today's progress ring, a status line, last-7-days bars, streak, overdue shortcut
- Insights page (click the dashboard): GitHub-style year heatmap of completions with a year switcher, streaks, best day, weekday pattern, and top projects. Completions are kept in a separate log so recurring tasks and later-deleted tasks still count
- Light, dark, or follow-system theme (toggle at the bottom of the sidebar, remembered between launches)
- Pin on top: keeps the window above other windows (desktop only, button in the title bar next to minimize)
- Settings (sidebar footer): theme choice, accent color (presets or any custom color; the whole palette, brand gradient and header halos are derived from it in OKLCH and remembered per device) plus Data backup. **Export backup…** writes one JSON file with every project, section, label, task and completion; **Import backup…** replaces all data with such a file (after confirmation). Data lives only on this computer, so this is how you back up, move to another PC, or recover after a reinstall (`GET /api/backup`, `POST /api/backup/import`)
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
- UI: `frontend/.env` → `VITE_API_URL` (defaults to `http://localhost:5080`)

## Build a Windows installer

```bash
npm run build
```

This publishes the API (`desktop/build/api`) and the app-bar helper (`desktop/build/appbar`) as self-contained
Windows executables (no .NET runtime needed on the target PC), builds the UI into `desktop/renderer/`, and runs
electron-builder, which writes `release/MyTodoEase-Setup-<version>.exe` (NSIS, per-user, choosable install folder,
desktop + Start Menu shortcuts) plus the unpacked app in `release/win-unpacked/`.

The installed `MyTodoEase.exe` starts the bundled API on `http://localhost:5080` (unless something already answers
there), waits for it to become healthy, and stops it on exit. The database is an embedded LiteDB file, so a clean PC
needs nothing else installed. If the API cannot start, the app shows a dialog saying so and keeps retrying in the
window. Override the API address with the `MYTODOEASE_API_URL` environment variable.

## MCP server (Claude, Codex, other assistants)

`mcp/` holds an MCP server that exposes the same API as tools, so an AI assistant can list what is due, add and
reschedule tasks, complete them and review your week. Build it with `npm run build:mcp`, then register
`node <checkout>\mcp\dist\index.js` with your client; [mcp/README.md](mcp/README.md) has the exact commands for
Claude Code, Claude Desktop and Codex. It starts the bundled API itself when the desktop app is closed.

## Not yet

- Authentication / multi-user (single local user for now; the API has no auth and CORS is wide open)
- Reordering projects, sections, or sub-tasks by drag (only top-level tasks are draggable)
- Comments, attachments, reminders, notifications
- Email / Telegram integration and email-to-task analysis
