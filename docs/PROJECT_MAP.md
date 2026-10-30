# TodoEase project map

Where each feature lives, from the screen down to storage. Paths are relative to the repo root; `fe/` is
`frontend/src/`, `api/` is `backend/MyTodoEase.Api/`. Firestore paths are under `users/{uid}/` (cloud mode).

**Keep it current:** a commit that adds, moves or renames a feature updates its row here in the same commit.

## How the pieces fit

| Layer | Where | Notes |
| ----- | ----- | ----- |
| Desktop shell | `desktop/main.cjs`, `desktop/preload.cjs` | Electron window, mini mode, docking, note windows, updates |
| Dock helper | `desktop/appbar/Program.cs` | Windows app bar (reserves the right-hand strip) |
| UI | `frontend/` (React 19, Vite, TanStack Query) | Same build for the desktop app and todoease.com |
| Data access | `fe/api/client.ts` | Picks the local API (desktop) or `fe/api/firestoreClient.ts` (web / cloud) |
| Local API | `api/` (ASP.NET Core minimal API) | LiteDB file, or Firestore when the desktop is signed in (`api/Data/FirestoreStore.cs`) |
| MCP server | `mcp/src/` | Tools for AI assistants; talks to the local API |
| Security rules | `firestore.rules` | Shape checks for every cloud document |

## Features

| Feature | UI | `fe/lib` helpers | Local API | Backend | Firestore |
| ------- | -- | ---------------- | --------- | ------- | --------- |
| Tasks: list, add, edit, complete | `TaskList.tsx`, `TaskItem.tsx`, `TaskEditor.tsx`, `TaskDetail.tsx` | `views.ts`, `dates.ts` | `/api/tasks` (+ `/{id}/complete`, `/{id}/reopen`, `/reorder`) | `Endpoints/TasksEndpoints.cs`, `Models/TodoTask.cs` | `tasks/{id}`, `completions/{id}` |
| Quick add words (#project @label p1 dates) | `TaskEditor.tsx` | `quickAdd.ts` | — | — | — |
| Repeating tasks | `Pickers.tsx` (DuePicker) | `recurrence.ts` | `/api/tasks/{id}/complete` rolls forward | `Services/RecurrenceService.cs` | `tasks/{id}` |
| Multi-day tasks (start date) | `CalendarView.tsx` (bars), `TaskItem.tsx` (range) | `dates.ts` | `/api/tasks` (`startDate`) | `TasksEndpoints.cs` (`Apply`) | `tasks/{id}.startDate` |
| Projects and sections | `Sidebar.tsx`, `Dialogs.tsx` (ProjectDialog), `TaskList.tsx` | `colors.ts` | `/api/projects`, `/api/sections` | `ProjectsEndpoints.cs`, `SectionsEndpoints.cs` | `projects/{id}`, `sections/{id}` |
| Labels | `Sidebar.tsx`, `Dialogs.tsx` (LabelDialog), `Pickers.tsx` | — | `/api/labels` | `LabelsEndpoints.cs` | `labels/{id}` |
| Inbox project filter | `TaskList.tsx` (InboxFilterPicker) | `inboxFilter.ts` | — | — | — |
| View options (group, sort, list/board) | `TaskList.tsx` (ViewOptionsMenu), `BoardView.tsx` | `viewOptions.ts` | — | — | — |
| Undo (Ctrl+Z) | everywhere via hooks | `undo.ts` | — | — | — |
| Command palette (Ctrl+K) | `CommandPalette.tsx` | `hotkeys.ts` | — | — | — |
| Keyboard shortcuts | `KeyboardShortcuts.tsx` | `hotkeys.ts` | — | — | — |
| Calendar (month, week, timeline) | `CalendarView.tsx` | `plan.ts` (Plan my day), `dates.ts` | `/api/calendar/events` | `CalendarEndpoints.cs` | — |
| Google Calendar sync | `CalendarSyncSection.tsx` | — | `/api/calendar/sync`, `/sync/run`, `/calendars` | `Services/CalendarSyncService.cs`, `GoogleCalendarClient.cs` | `calendarSync/`, `calendarLinks/`, `calendarEvents/` |
| Sticky notes board | `NotesView.tsx`, `NoteEditor.tsx` | `notes.ts` | `/api/notes` | `NotesEndpoints.cs`, `Models/Note.cs` | `notes/{id}` |
| Note windows and list (desktop, mini) | `NoteWindow.tsx`, `NotesListPane.tsx` | `notes.ts`, `useNoteDraft.ts` | — | `desktop/main.cjs` (`openNoteWindow`) | — |
| Turn note into tasks | `NoteToTasksDialog.tsx` | `noteToTasks.ts` | — | — | — |
| Insights, streaks, World | `InsightsView.tsx`, `Dashboard.tsx`, `WorldView.tsx` | `stats.ts`, `world.ts` | `/api/stats/completions` | `StatsEndpoints.cs` | `completions/{id}` |
| Achievements and points | `AchievementsView.tsx` | `achievements.ts` | — | — | — |
| Languages (i18n) | every component via `t()` | `i18n/` | — | — | — |
| Mini mode | `CompactView.tsx`, `TitleBar.tsx` | `desktop.ts` | — | `desktop/main.cjs` (`applyCompact`) | — |
| Docking (right edge) | `TitleBar.tsx` | `desktop.ts` | — | `desktop/main.cjs` (`setDocked`), `desktop/appbar/` | — |
| Settings | `SettingsDialog.tsx`, `SettingRows.tsx` | `theme.ts`, `accent.ts`, `motion.ts`, `insightsCard.ts` | — | — | — |
| Cloud account and sign-in | `CloudAccountSection.tsx`, `SessionGate.tsx`, `SignIn.tsx`, `AccountMenu.tsx` | — | `/api/cloud/session`, `/api/auth/google` | `CloudSessionService.cs`, `GoogleAuthService.cs` | — |
| Backup and restore | `SettingsDialog.tsx` (Data) | — | `/api/backup`, `/api/backup/import` | `BackupEndpoints.cs` | all collections |
| Desktop updates | `UpdateBanner.tsx`, `AboutSection.tsx` | `updates.ts` | — | `desktop/main.cjs` (electron-updater) | — |
| AI assistants (MCP) | `McpSection.tsx` | `mcpSetup.ts` | the whole `/api` | `mcp/src/tools/tasks.ts`, `workspace.ts` | — |
| Landing and privacy pages | `frontend/index.html`, `frontend/public/privacy.html` | — | — | — | — |
