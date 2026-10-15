# MyTodoEase

A Todoist-style todo app: Windows desktop shell (Electron) around a React UI, backed by an ASP.NET Core API and MongoDB.
The same React code can later be served as a web app, and the API is the single source of truth for a future mobile app
and for notification jobs (email, Telegram).

## Stack

| Layer    | Tech                                              | Folder      |
| -------- | ------------------------------------------------- | ----------- |
| Desktop  | Electron 41                                       | `desktop/`  |
| UI       | React 19, Vite 8, TypeScript, TanStack Query      | `frontend/` |
| API      | ASP.NET Core minimal API (.NET 10), MongoDB.Driver | `backend/`  |
| Database | MongoDB 7 in Docker                               | `docker-compose.yml` |

## Prerequisites

- Node 20 (`nvm use 20`, see `.nvmrc`)
- .NET 10 SDK
- Docker Desktop (for MongoDB)

## Run in development

```bash
npm install
npm run db        # MongoDB in Docker on localhost:27018 (skip if MongoDB already runs locally)
npm run dev       # API (5080) + Vite (5173) + Electron window
```

The API defaults to `mongodb://localhost:27017`, which is where a MongoDB installed as a Windows service listens.
To use the Docker container instead, set `Mongo.ConnectionString` to `mongodb://localhost:27018` in
`backend/MyTodoEase.Api/appsettings.json` (or an `appsettings.Development.json` override).

Or run pieces individually: `npm run api`, `npm run web`, `npm run desktop`.
The API also works from a browser at http://localhost:5173 without Electron.

## Features (v1)

- Projects with colors, favorites, and sections
- Tasks with description, due date and time, priority P1 to P4, labels, sub-tasks
- Recurring tasks (daily, weekdays, weekly, monthly, yearly); completing one rolls it to the next date
- Views: Inbox, Today (with overdue and "reschedule to today"), Upcoming (7 days + later), per project, per label, search, Completed
- Calendar: month and week grids; drag a task to another day to reschedule it, drag undated tasks from the "No date" panel onto a day, "+" on a day to add a task there
- Dashboard card in the sidebar: today's progress ring, a status line, last-7-days bars, streak, overdue shortcut
- Insights page (click the dashboard): GitHub-style year heatmap of completions with a year switcher, streaks, best day, weekday pattern, and top projects. Completions are kept in a separate log so recurring tasks and later-deleted tasks still count
- Light, dark, or follow-system theme (toggle at the bottom of the sidebar, remembered between launches)
- Pin on top: keeps the window above other windows (desktop only, button in the title bar next to minimize)
- Dock (mini mode, Windows): a title bar button reserves the mini window as a Windows app bar on the right screen edge, like the taskbar, so maximized apps stop at its edge instead of covering it. While docked only Close is shown; dragging or snapping the window puts it back. Expanding to the full window releases the strip and going back to mini re-docks, until you undock explicitly. The dock state survives restarts. Uses the small .NET helper in `desktop/appbar` (built by `npm run build:appbar`, needs the .NET 10 runtime)
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

Due dates are stored as plain `yyyy-MM-dd` / `HH:mm` strings (local calendar dates), never as UTC instants, so they do
not shift across time zones.

## Configuration

- API: `backend/MyTodoEase.Api/appsettings.json` → `Mongo.ConnectionString`, `Mongo.Database`
- UI: `frontend/.env` → `VITE_API_URL` (defaults to `http://localhost:5080`)

## Build a Windows installer

```bash
npm run build
```

Vite builds the UI into `desktop/renderer/`, then electron-builder produces an NSIS installer in `release/`.
The installed app still needs the API and MongoDB running; bundling them is a later step.

## Not yet

- Authentication / multi-user (single local user for now; the API has no auth and CORS is wide open)
- Reordering projects, sections, or sub-tasks by drag (only top-level tasks are draggable)
- Comments, attachments, reminders, notifications
- Email / Telegram integration and email-to-task analysis
