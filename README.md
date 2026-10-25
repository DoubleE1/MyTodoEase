# TodoEase

A planner that keeps your tasks and your calendar on one screen. Capture quickly, give each task a time, and watch
the day fill in around your meetings. It runs in the browser and as a Windows app; sign in with Google and the same
tasks follow you to every device.

- **Web:** https://todoease.com
- **Windows:** [download the installer](https://github.com/dbo-e/TodoEase/releases/latest/download/TodoEase-Setup.exe)
  (Windows may show a SmartScreen warning until the app is code-signed; choose *More info → Run anyway*).
  The app keeps itself current: it checks for a new version when it starts, downloads it in the background and
  shows **Restart to update** when it is ready. *Settings → About* shows the version and has a manual check.

## Features

**Capture and organise**
- Quick add in plain words: `Pay rent tomorrow at 9am p1 #Home @finance every month`
- Projects with colours, favourites and sections; labels; priorities P1 to P4; descriptions; sub-tasks
- Drag and drop to reorder tasks or move them between sections (keyboard works too)
- Search across everything; `q` opens quick add from anywhere

**Plan the day**
- Inbox, Today (with overdue and one-click “reschedule to today”), Upcoming, per project, per label, Completed
- Calendar month view: drag tasks between days, drop undated tasks onto a day
- Week timeline for time-blocking: your Google Calendar events and timed tasks side by side; drag a task into a
  free slot, stretch it to the time it needs
- **Plan my day** fills the gaps between meetings with today’s open tasks, highest priority first
- Recurring tasks (daily, weekdays, weekly, every 2 weeks, monthly, yearly) that roll forward when completed, with
  faded previews of future occurrences on the calendar

**Google Calendar**
- Mirror dated tasks into a dedicated “TodoEase” calendar so they show on your phone; edits, completions and
  deletions keep the events in step
- Show events from the calendars you choose next to your tasks
- Allow it once, on the web app or in the Windows app: when you are signed in the sync runs in the cloud, every
  15 minutes and whenever a task changes, so every device shows the same calendar even while no app is open

**Your data, everywhere**
- One Google sign-in: tasks sync live between the Windows app, the web app and any other PC you sign in on
- Works without signing in too: the Windows app keeps everything in a local file
- Backup export and import as a single JSON file

**Insights**
- Dashboard card with today’s progress, a 7‑day bar chart and your streak
- Year heatmap of completed tasks, best day, weekday pattern, top projects

**Windows extras**
- Mini mode: a slim two-pane list you can keep beside your work
- Dock the mini window to the screen edge like the taskbar, or pin it on top
- Light, dark or system theme and a custom accent colour

**AI assistants**
- Built-in MCP server: Claude, Codex and other assistants can list what is due, add, reschedule and complete tasks
  (Settings → AI assistants gives copy-paste setup)

## Privacy

Your tasks are stored under your own Google account (or only on your PC in local mode) and are never shared.
Details: https://todoease.com/privacy.

## For developers

Setup, build, release and architecture notes live in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md); the MCP server has
its own [README](mcp/README.md).

## License

[MIT](LICENSE). Issues and pull requests are welcome at https://github.com/dbo-e/TodoEase.
