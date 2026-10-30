# TodoEase roadmap: next features

Planned 2026-10-30. Build order: **project map → hour heatmap → board view**. The map is cheapest and makes the
other two faster to build; the heatmap is self-contained; the board view is the largest.

Ideas borrowed from an open-source admin scaffold (`wbr664393425-lgtm/scaffold-master`, Vue + Spring). Only the
ideas are reused; no code is copied (different stack).

Shipped first, ahead of this list (2026-10-30): the **command palette** (sidebar "Search", Ctrl+K) and
**custom shortcuts** in Settings > Shortcuts.

| # | Feature | Estimate | Touches the API? |
| - | ------- | -------- | ---------------- |
| 1 | Project map + changelog | 30–45 min | No |
| 2 | "When I get things done" heatmap | 1–2 h | No |
| 3 | Board view | 3–4 h | No |

---

## 1. Project map + changelog

**Problem.** Finding where a feature lives means grepping across `frontend/`, `backend/`, `desktop/` and `mcp/`.
There is no record of what changed between releases beyond `git log`.

**Success criteria.**
- Any feature can be traced from UI to storage in one lookup.
- Each release has a human-readable list of changes.

**Plan.**
1. `docs/PROJECT_MAP.md`: one table row per feature with these columns:
   - UI component
   - `lib/` helpers
   - API endpoint
   - Backend file
   - Firestore path (cloud mode)
   - Settings key, when the feature has one
2. Cover these features: tasks, projects, sections, labels, notes, quick add, Inbox filter, view options,
   calendar sync, Insights and World, mini mode, MCP server, updates and release, cloud sign-in.
3. `CHANGELOG.md`: backfill from the git tags, newest first. Group each release's entries as Added, Changed and
   Fixed.
4. Link both from `docs/DEVELOPMENT.md`.
5. Rule: a commit that adds or moves a feature updates the map in the same commit.

---

## 2. "When I get things done" heatmap

**Problem.** Insights shows *which days* you complete tasks (the year heatmap) but not *what time of day* you
work best, which is the useful signal for planning.

**Success criteria.**
- Insights shows a 7 × 24 grid (weekday × hour) of completions for the selected year.
- One sentence names the strongest slot, for example "You get the most done on Tuesday mornings".
- Readable without colour: every cell has a text label, and the summary is plain text.

**Assumptions (to check first).**
- `CompletionItem.completedAt` is an ISO timestamp. It is bucketed in the user's **local** time zone, not UTC.
- The completion history already includes recurring-task completions and deleted tasks, so counts are complete.

**Plan.**
1. `frontend/src/lib/hourHeatmap.ts`: `bucketCompletions(items): number[7][24]` plus a `bestSlot()` summary,
   with unit tests. Tests cover:
   - local-time conversion
   - an empty year
   - ties between equally busy slots
2. `InsightsView.tsx`: a new card under the year heatmap.
   - Cells use 5 shade levels from the accent colour.
   - Hours are labelled every 3 hours.
   - Weekdays start on `WEEK_STARTS_ON`, the same constant the year heatmap uses.
3. Interaction:
   - Hovering or focusing a cell shows a tooltip such as "Tue 9–10 am · 6 tasks".
   - The grid has `role="grid"`, and arrow keys move between cells.
4. Narrow layouts (mini mode, Insights pane): the grid keeps 24 columns at about 18 px each. Below 420 px it
   scrolls horizontally rather than shrinking the text.
5. Respect Reduce motion: no staggered fade-in when it is on.

**Risks.**
- Sparse data makes the summary misleading. Hide the summary below about 20 completions and say "Not enough
  history yet".

---

## 3. Board view (kanban)

**Problem.** Lists hide the shape of work. With Group by now available, columns are the natural next layout
(Todoist and Trello users expect it).

**Success criteria.**
- Any task page can switch between **List** and **Board** from the View options menu. The choice is remembered per
  page.
- Columns come from the current Group by, so sections, priority, due date, project and label all work.
- Dragging a card to another column changes that field, and the change syncs in both local and cloud mode.
- Everything works by keyboard: each card has a "Move to…" menu.

**Design.**
- **Columns** = the groups `arrangeGroups()` already builds in `TaskList.tsx`. The board is a second renderer
  over the same data, not new grouping logic.
- **Drop behaviour by grouping:**

  | Group by | Dropping in a column sets | Notes |
  | -------- | ------------------------- | ----- |
  | Sections (project default) | `sectionId` + order | Reuses `persistOrder()`; reordering within a column only with Manual sort |
  | Priority | `priority` | |
  | Due date | `dueDate` | The Overdue column is not a drop target |
  | Project | `projectId` (and clears `sectionId`) | |
  | Label | not draggable | A task can have several labels, so a drop is ambiguous; "Move to…" is hidden too |
  | None | — | Board layout is disabled; the List option only |

- **Cards** show the title, due date, priority flag, labels and a subtask count ("2/5"). Subtasks are not nested
  on the board.
- **Columns** each have an "Add task" button at the bottom that pre-fills the column's field. A project board
  ends with an "Add section" column.
- **Layout:** columns are 272 px wide and the board scrolls horizontally with scroll snap. Mini mode always shows
  the list, because the board needs width.
- **Accessibility:**
  - Columns are `role="list"` with a heading.
  - Cards are focusable and Enter opens the task.
  - Dragging works with the dnd-kit keyboard sensor, and "Move to…" is the plain alternative.
  - Each drop is announced through the existing toast or live region.

**Plan.**
1. `lib/viewOptions.ts`: add `layout: 'list' | 'board'`, defaulting to list. Add a "Layout" row (a segmented
   control) at the top of the menu.
2. `components/BoardView.tsx`: render columns and cards. Use dnd-kit with one `SortableContext` per column,
   reusing the `DroppableList` pattern from `TaskList.tsx`.
3. `TaskList.tsx`: when the layout is board, render `BoardView` with `groups` and an `onMove(task, group)` callback
   that maps the drop to an update (per the table above).
4. Styles: column, card and board scroller tokens in `styles.css`, plus a dark-mode check.
5. Verify in the web preview for each grouping, in cloud mode (Firestore), and by keyboard only.

**Risks.**
- **Drag across a horizontally scrolling container:** dnd-kit needs auto-scroll enabled on the board element.
- **Large boards (100+ cards):** check render cost. Virtualising is out of scope unless it is slow.

**Out of scope.**
- Swimlanes (rows as well as columns)
- Column WIP limits
- Collapsing columns (could reuse the collapsed-groups store later)
