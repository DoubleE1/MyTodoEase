# Changelog

Newest first. Each release is a GitHub release with the Windows installer; todoease.com runs the same version.

## Unreleased

### Added
- Home: click the TodoEase logo for a plain page with one card per module: Todo (tasks, projects, calendar, sticky notes)
  with today's counts, and Notebook and Wallet (coming soon). Also in search as "Home".
- Board view: any task page can switch between List and Board; columns follow Group by, and dragging a card to
  another column changes that field.
- "When I get things done" heatmap in Insights: completions by weekday and hour, with your best slot.
- Achievements and points (50 achievements, 10,000 points) and a skin shop preview (coming soon). Both open from the profile menu at the bottom of the sidebar.
- Languages: English, 简体中文, 日本語, 한국어 (Settings > Appearance > Language). Dates and times follow the language. Still English: the web sign-in page and the setup pages for Account & sync, Google Calendar and AI assistants.
- Desktop app runs in the background (Settings > Desktop app): Start with Windows (opens in the tray at sign-in),
  closing the window keeps TodoEase in the notification area, and shortcuts that work in any app: Ctrl+Alt+T opens
  a small New task box, Ctrl+Alt+N opens a new sticky note. Both shortcuts can be changed or turned off.
  Both windows are loaded in the background, so they open at once (a new note in about 0.2 s) and never flash
  white; the New task box is only as tall as its content. All TodoEase windows share one taskbar icon.
  Pressing Ctrl+Alt+N over and over (or holding it) opens notes one at a time instead of loading many at once;
  notes restored at start-up open one after another.
- Notes board: press Delete on a selected note to remove it (a note with text asks first).
- Notes board right-click menus. On the empty board: New note here, New sticky note window (desktop app),
  Paste as note, Show all notes, Back to 100%, Show/Hide archived. On a note: its colours, Open in its own window,
  Archive, Delete and Turn into tasks. Shift+F10 or the menu key opens a selected note's menu.
  Paste as note reads the clipboard in the desktop app; a browser that blocks it gets an empty note and a Ctrl+V hint.
- Notes board: drag an archived note from the Archived panel onto the board to put it back where you drop it.
- Shop: skins grouped by what they change (Background, Tab, Dashboard and Calendar effects, Sticky notes, Insights,
  Profile, Bundles), each with a small preview, its rarity and price, and how many points to go. Buttons at the top
  jump to a section. A section with more than 5 skins ends in a Show more card that opens a page with only that
  section (Back returns to where you were).

### Fixed
- Notes board: a note dragged or resized quickly now keeps up with the mouse instead of stopping halfway.
- Turn into tasks and quick add understand more date phrases ("next Friday at 3pm", "end of the month", "in 2 weeks")
  and times of day: morning 9:00, noon 12:00, afternoon 2:00 PM, evening 6:00 PM, tonight 8:00 PM, midnight 11:59 PM
  ("tomorrow morning", "next weekend afternoon", "by midnight"). "Morning routine" or "game night" stay titles.

### Docs
- Project map (`docs/PROJECT_MAP.md`), this changelog, and a mobile app plan (`docs/MOBILE_PLAN.md`).

## 0.2.6 — 2026-10-31

### Added
- Sticky notes use the description editor (bold, italic, lists, links…), with formatted previews.
- Sticky notes list in mini mode; desktop notes open in their own windows, remembered across restarts.
- Ctrl+Z undoes the last task action.
- Markdown description editor in quick add and inline add.

### Changed
- Settings > Google Calendar uses the row-and-card layout.
- Due dates: only overdue (red) and today (green) are coloured.
- Mini mode: labels fold under one row in the pane picker; the formatting toolbar folds into one menu.

### Fixed
- Docking on extended screens with different scaling.
- Menus close when a drag starts outside them; a note's colour band keeps its height when resized.
- Notes board arrow keys move a selected note.

## 0.2.5 — 2026-10-30

### Added
- Command palette (Ctrl+K) and rebindable shortcuts (Ctrl+/ lists them all).
- Inbox project filter, grouped by project and sorted by due date.
- View options: group and sort any task page.
- Multi-day tasks on the calendar (drag an end to stretch).
- Settings redesign with search and grouped sections; switch to hide the Insights card.

### Fixed
- Dialogs opened from a page are no longer drawn under the sidebar.
- Reduce motion also turns off the click ripple.

## 0.2.4 — 2026-10-30

### Added
- Notes board: an endless canvas of glass sticky notes, resizable, with Turn into tasks.
- Motion system and themed tooltips; completion toast with Undo; collapsible sidebar.

## 0.2.3 — 2026-10-29

### Added
- Markdown descriptions with a rich-text editor, table tools and clickable checklists.

## 0.2.2 — 2026-10-27

### Added
- Completed tasks stay on the calendar, greyed; Continue tomorrow.

## 0.2.1 — 2026-10-25

### Changed
- Google Calendar sync in cloud mode runs in the app and is shared across devices.

## 0.2.0 — 2026-10-25

### Added
- Desktop app updates itself from GitHub Releases; About tab in Settings.

## 0.1.x — 2026-10-24

### Added
- First public versions: installer built on GitHub Actions, landing page and account menu.
- Renamed to TodoEase.
- One Google sign-in for cloud sync and Google Calendar.
