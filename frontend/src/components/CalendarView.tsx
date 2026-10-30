import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, Repeat, Sparkles } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useCalendarEvents, useTaskMutations } from '../api/hooks';
import type { ExternalEvent, Project, Task } from '../api/types';
import { PRIORITY_META } from '../lib/colors';
import { compareDue, formatTime, toDateStr, todayStr } from '../lib/dates';
import { layoutLanes, planDay, SNAP_MINUTES, taskDuration, toMinutes, toTime } from '../lib/plan';
import { projectedOccurrences } from '../lib/recurrence';
import { showToast } from '../lib/toast';
import { recordEvent } from '../lib/achievements';
import { taskToInput } from './TaskEditor';

interface CalendarViewProps {
  tasks: Task[];
  /** Finished tasks: still drawn on the day they were planned, greyed and struck through. */
  completedTasks: Task[];
  projects: Project[];
  onOpenTask: (id: string) => void;
  onAddTask: (dueDate: string, dueTime?: string) => void;
}

type Mode = 'month' | 'week';

const WEEK_STARTS_ON = 1; // Monday
const DAY_PREFIX = 'day:'; // month cell: sets the date
const ALLDAY_PREFIX = 'allday:'; // week all-day row: sets the date, clears the time
const COL_PREFIX = 'col:'; // week time column: sets date and time from the drop position
const UNSCHEDULED_ID = 'unscheduled';
const SPAN_PREFIX = 'span:'; // draggable id of a multi-day bar segment: span:<taskId>:<row>
const HOUR_PX = 56;
const MIN_BLOCK_MINUTES = 15;
/** Height of one lane of multi-day bars (bar plus gap). */
const LANE_PX = 24;
/** Month cells: bars start below the day number row (cell padding + head + gap). */
const MONTH_BAR_TOP = 32;
const ALLDAY_BAR_TOP = 4;

type Edge = 'start' | 'end';

const shiftDate = (date: string, days: number) => toDateStr(addDays(parseISO(date), days));
const daysBetween = (from: string, to: string) => differenceInCalendarDays(parseISO(to), parseISO(from));

/** The day cell under a point: month cells, all-day cells and timeline columns carry data-date. */
function dateAt(x: number, y: number): string | undefined {
  const hit = document.elementsFromPoint(x, y).find((el) => el instanceof HTMLElement && el.dataset.date);
  return (hit as HTMLElement | undefined)?.dataset.date;
}

/** First and last day a task covers (equal for a one-day task). */
interface Span {
  start: string;
  end: string;
}

/** One week row's piece of a multi-day task: columns `from`..`to` (inclusive) in lane `lane`. */
interface SpanSegment {
  task: Task;
  from: number;
  to: number;
  lane: number;
  /** The task started before this row / goes on after it, so that end of the bar is drawn flat. */
  before: boolean;
  after: boolean;
}

/** Cuts multi-day tasks into per-row segments and stacks overlapping ones into lanes (longest first). */
function layoutSpans(items: { task: Task; span: Span }[], rowDays: string[]): { segments: SpanSegment[]; lanes: number } {
  const first = rowDays[0];
  const last = rowDays[rowDays.length - 1];
  const inRow = items
    .filter(({ span }) => span.start <= last && span.end >= first)
    .map(({ task, span }) => ({
      task,
      from: Math.max(0, daysBetween(first, span.start)),
      to: Math.min(rowDays.length - 1, daysBetween(first, span.end)),
      before: span.start < first,
      after: span.end > last,
    }))
    .sort((a, b) => a.from - b.from || b.to - b.from - (a.to - a.from) || a.task.order - b.task.order);
  const laneEnds: number[] = [];
  const segments = inRow.map((seg) => {
    let lane = laneEnds.findIndex((end) => end < seg.from);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = seg.to;
    return { ...seg, lane };
  });
  return { segments, lanes: laneEnds.length };
}

// The cell under the pointer wins; the overlay chip is wider than a cell, so its centre would be misleading.
// Keyboard drags have no pointer and fall back to the nearest centre.
const collisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : closestCenter(args);
};

const openExternal = (url: string | null) => {
  if (!url) return;
  const desktop = window.mytodoease;
  if (desktop?.openExternal) void desktop.openExternal(url);
  else window.open(url, '_blank', 'noopener');
};

const snap = (minutes: number) => Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;

/** Priority-coloured ring; a finished task gets a plain filled grey dot instead. */
function dotStyle(task: Task) {
  if (task.isCompleted) return { borderColor: 'var(--text-muted)', background: 'var(--text-muted)' };
  const priority = PRIORITY_META[task.priority];
  return { borderColor: priority.hex, background: task.priority < 4 ? `${priority.hex}33` : undefined };
}

// ---------- Chips (month grid, all-day row, unscheduled panel) ----------

function TaskChip({
  task,
  project,
  onOpen,
  overlay,
  projected,
  onResizeStart,
  onNudgeEnd,
}: {
  task: Task;
  project?: Project;
  onOpen?: () => void;
  overlay?: boolean;
  /** A preview of a future occurrence of a recurring task: not draggable, drawn faded. */
  projected?: boolean;
  /** Dated chips: drag either end across days to turn the task into a multi-day one. */
  onResizeStart?: (edge: Edge, event: ReactPointerEvent) => void;
  /** Keyboard alternative: Shift+→ / Shift+← moves the last day. */
  onNudgeEnd?: (days: number) => void;
}) {
  const done = task.isCompleted;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: overlay || projected || done });
  const subtitle = [task.dueTime ? formatTime(task.dueTime) : null, project && !project.isInbox ? project.name : null]
    .filter(Boolean)
    .join(' · ');
  const draggable = !overlay && !projected && !done;
  const resizable = draggable && !!onResizeStart;
  return (
    <button
      type="button"
      ref={draggable ? setNodeRef : undefined}
      className={`cal-chip ${isDragging ? 'is-dragging' : ''} ${overlay ? 'is-overlay' : ''} ${projected ? 'is-projected' : ''} ${done ? 'is-done' : ''}`}
      data-tooltip={
        projected
          ? `${task.content} (repeats here after the current one is completed)`
          : done
            ? `${task.content} (completed)`
            : task.content
      }
      onClick={onOpen}
      {...(draggable ? { ...attributes, ...listeners } : {})}
      onKeyDown={(e) => {
        if (onNudgeEnd && resizable && e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
          e.preventDefault();
          onNudgeEnd(e.key === 'ArrowRight' ? 1 : -1);
          return;
        }
        if (draggable) listeners?.onKeyDown?.(e);
      }}
    >
      {resizable && <ResizeHandle edge="start" onResizeStart={onResizeStart} />}
      <span className="cal-chip-dot" style={dotStyle(task)} />
      <span className="cal-chip-text">
        <span className="cal-chip-title">{task.content}</span>
        {subtitle && <span className="cal-chip-sub">{subtitle}</span>}
      </span>
      {task.recurrence !== 'none' && <Repeat size={10} className="cal-chip-repeat" />}
      {resizable && <ResizeHandle edge="end" onResizeStart={onResizeStart} />}
    </button>
  );
}

/** Grip on the left or right end of a chip or bar; dragging it across days changes the first or last day. */
function ResizeHandle({ edge, onResizeStart }: { edge: Edge; onResizeStart: (edge: Edge, event: ReactPointerEvent) => void }) {
  return (
    <span
      className={`cal-span-handle is-${edge}`}
      aria-hidden="true"
      onPointerDown={(e) => onResizeStart(edge, e)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/**
 * One week row's piece of a multi-day task, laid over the day cells in the same grid. Drag the body to move
 * the whole span, drag an end to stretch or shrink it, click to open.
 */
function SpanBar({
  segment,
  row,
  column,
  top,
  project,
  onOpen,
  onResizeStart,
  onNudgeEnd,
}: {
  segment: SpanSegment;
  /** Grid row and first grid column of the row's day cells. */
  row: number;
  column: number;
  /** Offset of lane 0 from the top of the row. */
  top: number;
  project?: Project;
  onOpen: () => void;
  onResizeStart: (edge: Edge, event: ReactPointerEvent) => void;
  onNudgeEnd: (days: number) => void;
}) {
  const { task, from, to, lane, before, after } = segment;
  const done = task.isCompleted;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `${SPAN_PREFIX}${task.id}:${row}`, disabled: done });
  const range = `${format(parseISO(task.startDate ?? task.dueDate!), 'd MMM')} – ${format(parseISO(task.dueDate!), 'd MMM')}`;
  return (
    <button
      type="button"
      ref={done ? undefined : setNodeRef}
      className={`cal-span ${before ? 'is-continued' : ''} ${after ? 'is-continuing' : ''} ${isDragging ? 'is-dragging' : ''} ${done ? 'is-done' : ''}`}
      style={{ gridRow: row, gridColumn: `${column + from} / ${column + to + 1}`, marginTop: top + lane * LANE_PX }}
      data-tooltip={`${task.content} · ${range}${project && !project.isInbox ? ` · ${project.name}` : ''}${done ? ' (completed)' : ''}`}
      aria-label={`${task.content}, ${range}`}
      onClick={onOpen}
      {...(done ? {} : { ...attributes, ...listeners })}
      onKeyDown={(e) => {
        if (!done && e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
          e.preventDefault();
          onNudgeEnd(e.key === 'ArrowRight' ? 1 : -1);
          return;
        }
        if (!done) listeners?.onKeyDown?.(e);
      }}
    >
      {!done && !before && <ResizeHandle edge="start" onResizeStart={onResizeStart} />}
      <span className="cal-chip-dot" style={dotStyle(task)} />
      <span className="cal-span-title">{task.content}</span>
      {task.recurrence !== 'none' && <Repeat size={10} className="cal-chip-repeat" />}
      {!done && !after && <ResizeHandle edge="end" onResizeStart={onResizeStart} />}
    </button>
  );
}

/** A Google Calendar event as a chip: read-only, opens in Google on click. */
function EventChip({ event }: { event: ExternalEvent }) {
  const time = event.allDay ? 'All day' : `${formatTime(event.startTime!)}${event.endTime ? `–${formatTime(event.endTime)}` : ''}`;
  return (
    <button
      type="button"
      className="cal-chip is-event"
      data-tooltip={`${event.title} · ${event.calendarName}${event.location ? ` · ${event.location}` : ''}`}
      onClick={() => openExternal(event.htmlLink)}
    >
      <span className="cal-chip-dot cal-event-dot" style={{ background: event.color ?? 'var(--text-muted)', borderColor: event.color ?? 'var(--text-muted)' }} />
      <span className="cal-chip-text">
        <span className="cal-chip-title">{event.title}</span>
        <span className="cal-chip-sub">{time}</span>
      </span>
    </button>
  );
}

// ---------- Month grid ----------

function DayCell({
  day,
  inMonth,
  tasks,
  projected,
  events,
  projectById,
  onOpenTask,
  onAddTask,
  row,
  column,
  reservedLanes,
  spanCount,
  onResizeStart,
  onNudgeEnd,
}: {
  day: Date;
  inMonth: boolean;
  tasks: Task[];
  /** Recurring tasks that will land on this day once their current occurrence is done. */
  projected: Task[];
  /** Google Calendar events on this day. */
  events: ExternalEvent[];
  projectById: Map<string, Project>;
  onOpenTask: (id: string) => void;
  onAddTask: (dueDate: string) => void;
  /** Placement in the month grid; multi-day bars share the grid and sit over the cells. */
  row: number;
  column: number;
  /** Lanes of multi-day bars in this week row: the cell keeps that much room free at the top. */
  reservedLanes: number;
  /** Open multi-day tasks covering this day, for the count. */
  spanCount: number;
  onResizeStart: (task: Task, edge: Edge, event: ReactPointerEvent) => void;
  onNudgeEnd: (task: Task, days: number) => void;
}) {
  const dateStr = toDateStr(day);
  const isToday = dateStr === todayStr();
  const isPast = dateStr < todayStr();
  const { setNodeRef, isOver } = useDroppable({ id: DAY_PREFIX + dateStr });
  const openCount = tasks.filter((t) => !t.isCompleted).length + spanCount;
  return (
    <div
      ref={setNodeRef}
      data-date={dateStr}
      style={{ gridRow: row, gridColumn: column }}
      className={`cal-cell cal-cell-month ${inMonth ? '' : 'is-outside'} ${isToday ? 'is-today' : ''} ${isPast ? 'is-past' : ''} ${isOver ? 'is-over' : ''}`}
    >
      <div className="cal-cell-head">
        <span className="cal-day-number">{format(day, 'd')}</span>
        {openCount > 0 && <span className="cal-count muted">{openCount}</span>}
        <button
          type="button"
          className="icon-btn cal-add"
          data-tooltip={`Add task on ${format(day, 'd MMM')}`}
          aria-label={`Add task on ${format(day, 'd MMMM')}`}
          onClick={() => onAddTask(dateStr)}
        >
          <Plus size={13} />
        </button>
      </div>
      <div className="cal-cell-body" style={reservedLanes ? { marginTop: reservedLanes * LANE_PX } : undefined}>
        {events.map((event) => (
          <EventChip key={`e-${event.calendarId}-${event.id}`} event={event} />
        ))}
        {tasks.map((task) => (
          <TaskChip
            key={task.id}
            task={task}
            project={projectById.get(task.projectId)}
            onOpen={() => onOpenTask(task.id)}
            onResizeStart={(edge, e) => onResizeStart(task, edge, e)}
            onNudgeEnd={(days) => onNudgeEnd(task, days)}
          />
        ))}
        {projected.map((task) => (
          <TaskChip key={`p-${task.id}`} task={task} project={projectById.get(task.projectId)} onOpen={() => onOpenTask(task.id)} projected />
        ))}
      </div>
    </div>
  );
}

// ---------- Week timeline ----------

/** A timed task on the timeline: draggable to another slot, resizable at the bottom edge. */
function TimeBlock({
  task,
  project,
  top,
  height,
  lane,
  lanes,
  overlay,
  onOpen,
  onResize,
}: {
  task: Task;
  project?: Project;
  top: number;
  height: number;
  lane: number;
  lanes: number;
  overlay?: boolean;
  onOpen?: () => void;
  onResize?: (durationMinutes: number) => void;
}) {
  const done = task.isCompleted;
  const interactive = !overlay && !done;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: !interactive });
  const [previewHeight, setPreviewHeight] = useState<number | null>(null);
  const duration = taskDuration(task);
  const start = task.dueTime ? toMinutes(task.dueTime) : 0;
  const shownMinutes = previewHeight !== null ? (previewHeight / HOUR_PX) * 60 : duration;
  const subtitle = `${formatTime(toTime(start))} – ${formatTime(toTime(start + shownMinutes))}${project && !project.isInbox ? ` · ${project.name}` : ''}`;

  // Resize: track the pointer from the bottom handle; commit on release, snapped to 15 minutes.
  const startResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!onResize) return;
    event.stopPropagation();
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const next = Math.max((MIN_BLOCK_MINUTES / 60) * HOUR_PX, startHeight + (e.clientY - startY));
      setPreviewHeight(next);
    };
    const up = (e: PointerEvent) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      const finalHeight = Math.max((MIN_BLOCK_MINUTES / 60) * HOUR_PX, startHeight + (e.clientY - startY));
      const minutes = Math.max(MIN_BLOCK_MINUTES, snap((finalHeight / HOUR_PX) * 60));
      setPreviewHeight(null);
      if (minutes !== duration) onResize(minutes);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  const widthPct = 100 / lanes;
  const style = overlay
    ? { height: Math.max(22, height) }
    : { top, height: Math.max(22, previewHeight ?? height), left: `calc(${lane * widthPct}% + 2px)`, width: `calc(${widthPct}% - 4px)` };

  return (
    <div
      ref={interactive ? setNodeRef : undefined}
      className={`tl-block ${isDragging ? 'is-dragging' : ''} ${overlay ? 'is-overlay' : ''} ${done ? 'is-done' : ''}`}
      style={style}
      data-tooltip={done ? `${task.content} (completed)` : task.content}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onOpen) onOpen();
      }}
      {...(interactive ? { ...attributes, ...listeners } : {})}
    >
      <span className="tl-block-title">
        <span className="tl-block-dot" style={dotStyle(task)} />
        {task.content}
        {task.recurrence !== 'none' && <Repeat size={10} className="cal-chip-repeat" style={{ marginLeft: 4 }} />}
      </span>
      <span className="tl-block-sub">{subtitle}</span>
      {interactive && onResize && <span className="tl-resize" onPointerDown={startResize} aria-hidden="true" />}
    </div>
  );
}

function EventBlock({ event, top, height, lane, lanes }: { event: ExternalEvent; top: number; height: number; lane: number; lanes: number }) {
  const widthPct = 100 / lanes;
  return (
    <button
      type="button"
      className="tl-block is-event"
      style={{ top, height: Math.max(22, height), left: `calc(${lane * widthPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`, ['--event-color' as string]: event.color ?? undefined }}
      data-tooltip={`${event.title} · ${event.calendarName}${event.location ? ` · ${event.location}` : ''}`}
      onClick={() => openExternal(event.htmlLink)}
    >
      <span className="tl-block-title">{event.title}</span>
      <span className="tl-block-sub">
        {formatTime(event.startTime!)}
        {event.endTime ? ` – ${formatTime(event.endTime)}` : ''} · {event.calendarName}
      </span>
    </button>
  );
}

function AllDayCell({
  date,
  column,
  reservedLanes,
  children,
}: {
  date: string;
  /** Grid column; multi-day bars share the row's grid and sit over the cells. */
  column: number;
  reservedLanes: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: ALLDAY_PREFIX + date });
  return (
    <div
      ref={setNodeRef}
      data-date={date}
      style={{ gridRow: 1, gridColumn: column, paddingTop: ALLDAY_BAR_TOP + reservedLanes * LANE_PX }}
      className={`tl-allday-cell ${isOver ? 'is-over' : ''}`}
    >
      {children}
    </div>
  );
}

function TimeColumn({
  date,
  isToday,
  columnRef,
  children,
  onAddAt,
}: {
  date: string;
  isToday: boolean;
  columnRef: (el: HTMLDivElement | null) => void;
  children: React.ReactNode;
  onAddAt: (minutes: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: COL_PREFIX + date });
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        columnRef(el);
      }}
      data-date={date}
      className={`tl-col ${isToday ? 'is-today' : ''} ${date < todayStr() ? 'is-past' : ''} ${isOver ? 'is-over' : ''}`}
      style={{ height: 24 * HOUR_PX, ['--hour-px' as string]: `${HOUR_PX}px` }}
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const rect = e.currentTarget.getBoundingClientRect();
        onAddAt(snap(((e.clientY - rect.top) / HOUR_PX) * 60));
      }}
    >
      {children}
    </div>
  );
}

function UnscheduledPanel({
  tasks,
  projectById,
  onOpenTask,
}: {
  tasks: Task[];
  projectById: Map<string, Project>;
  onOpenTask: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: UNSCHEDULED_ID });
  return (
    <aside ref={setNodeRef} className={`cal-unscheduled ${isOver ? 'is-over' : ''}`}>
      <div className="cal-unscheduled-head">
        <span>No date</span>
        <span className="muted">{tasks.length}</span>
      </div>
      <p className="muted small cal-hint">Drag a task onto a day or a time slot to schedule it, or drop one here to clear its date.</p>
      <div className="cal-unscheduled-list">
        {tasks.length === 0 && <p className="muted small">Everything is scheduled.</p>}
        {tasks.map((task) => (
          <TaskChip key={task.id} task={task} project={projectById.get(task.projectId)} onOpen={() => onOpenTask(task.id)} />
        ))}
      </div>
    </aside>
  );
}

// ---------- View ----------

export function CalendarView({ tasks, completedTasks, projects, onOpenTask, onAddTask }: CalendarViewProps) {
  const taskMut = useTaskMutations();
  const [mode, setMode] = useState<Mode>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const columnRefs = useRef(new Map<string, HTMLDivElement>());
  const scrollRef = useRef<HTMLDivElement>(null);
  // Where the pointer is during a drag and how far below the block's top it grabbed it, so a drop
  // lands where the user sees the block even if the timeline auto-scrolled meanwhile.
  const pointerY = useRef(0);
  const grabOffsetY = useRef(0);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const { days, rangeStart, rangeEnd } = useMemo(() => {
    const start = startOfWeek(mode === 'month' ? startOfMonth(anchor) : anchor, { weekStartsOn: WEEK_STARTS_ON });
    const end = endOfWeek(mode === 'month' ? endOfMonth(anchor) : anchor, { weekStartsOn: WEEK_STARTS_ON });
    return { days: eachDayOfInterval({ start, end }), rangeStart: start, rangeEnd: end };
  }, [anchor, mode]);

  // While an end of a chip or bar is being dragged: the span it would get, drawn live.
  const [resizePreview, setResizePreview] = useState<({ taskId: string } & Span) | null>(null);

  /** The days a dated task covers, using the live preview while it is being stretched. */
  const spanOf = (task: Task & { dueDate: string }): Span =>
    resizePreview?.taskId === task.id
      ? resizePreview
      : { start: task.startDate && task.startDate < task.dueDate ? task.startDate : task.dueDate, end: task.dueDate };

  // Open tasks win over a stale completed copy while a complete or reopen is still settling.
  const datedTasks = useMemo(() => {
    const byId = new Map<string, Task & { dueDate: string }>();
    for (const task of completedTasks) if (task.dueDate) byId.set(task.id, task as Task & { dueDate: string });
    for (const task of tasks) if (task.dueDate) byId.set(task.id, task as Task & { dueDate: string });
    return [...byId.values()];
  }, [tasks, completedTasks]);

  /** Tasks covering more than one day: drawn as bars across the cells instead of a chip on one day. */
  const spanItems = datedTasks
    .map((task) => ({ task, span: spanOf(task) }))
    .filter(({ span }) => span.start < span.end);
  const spanIds = new Set(spanItems.map(({ task }) => task.id));

  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of datedTasks) {
      if (spanIds.has(task.id)) continue;
      const list = map.get(task.dueDate) ?? [];
      list.push(task);
      map.set(task.dueDate, list);
    }
    // Finished tasks sink below the open ones in a day's list; on the timeline their time decides.
    for (const list of map.values())
      list.sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted) || compareDue(a, b) || a.priority - b.priority || a.order - b.order);
    return map;
    // spanIds is derived from datedTasks and the resize preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datedTasks, resizePreview]);

  // Future occurrences of recurring tasks inside the visible range, so a fortnightly release shows
  // on every date it will land on, not only the next one.
  const projectedByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    const from = toDateStr(rangeStart);
    const to = toDateStr(rangeEnd);
    for (const task of tasks) {
      for (const date of projectedOccurrences(task, from, to)) {
        const list = map.get(date) ?? [];
        list.push(task);
        map.set(date, list);
      }
    }
    return map;
  }, [tasks, rangeStart, rangeEnd]);

  // Google Calendar events for the visible range, spread over every day a multi-day event covers.
  const externalEvents = useCalendarEvents(toDateStr(rangeStart), toDateStr(rangeEnd));
  const eventsByDate = useMemo(() => {
    const map = new Map<string, ExternalEvent[]>();
    for (const event of externalEvents.data ?? []) {
      let cursor = parseISO(event.date);
      const last = parseISO(event.endDate);
      for (let i = 0; i < 62 && cursor <= last; i++) {
        const key = toDateStr(cursor);
        map.set(key, [...(map.get(key) ?? []), event]);
        cursor = addDays(cursor, 1);
      }
    }
    return map;
  }, [externalEvents.data]);

  const unscheduled = useMemo(
    () => tasks.filter((t) => !t.dueDate).sort((a, b) => a.priority - b.priority || a.order - b.order),
    [tasks],
  );

  // Week mode: scroll to the working morning once, and keep the "now" line moving.
  useEffect(() => {
    if (mode !== 'week') return;
    const el = scrollRef.current;
    if (el) el.scrollTop = 7.5 * HOUR_PX;
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [mode]);

  const title =
    mode === 'month'
      ? format(anchor, 'MMMM yyyy')
      : `${format(rangeStart, 'd MMM')} – ${format(rangeEnd, 'd MMM yyyy')}`;

  const shift = (direction: -1 | 1) =>
    setAnchor((a) => (mode === 'month' ? addMonths(a, direction) : addWeeks(a, direction)));

  // The update hook applies the change to the cache at once, so the chip or block lands on its new slot immediately.
  const update = (task: Task, changes: Partial<Task>) => {
    taskMut.update.mutate({ id: task.id, input: { ...taskToInput(task), ...changes } });
  };

  const reschedule = (task: Task, dueDate: string | null, dueTime?: string | null) => {
    const nextTime = dueTime === undefined ? task.dueTime : dueTime;
    if (task.dueDate === dueDate && task.dueTime === nextTime) return;
    const changes: Partial<Task> = dueDate
      ? { dueDate, dueTime: nextTime }
      : { dueDate: null, dueTime: null, recurrence: 'none' };
    update(task, changes);
  };

  /** Saves a task's first and last day; equal days make it a one-day task again. */
  const setSpan = (task: Task, start: string, end: string) => {
    const startDate = start < end ? start : null;
    if (task.dueDate === end && (task.startDate ?? null) === startDate) return;
    // '' tells the API to clear the start (null would mean "leave it as it is").
    taskMut.update.mutate({ id: task.id, input: { ...taskToInput(task), dueDate: end, startDate: startDate ?? '' } });
  };

  /**
   * Stretching: follow the pointer from an end grip over the day cells, preview the new span live, save it on
   * release. The first day can never pass the last one (and the other way round).
   */
  const startResize = (task: Task, edge: Edge, event: ReactPointerEvent) => {
    if (!task.dueDate) return;
    event.stopPropagation();
    event.preventDefault();
    const origin = spanOf(task as Task & { dueDate: string });
    let current = origin;
    const move = (e: PointerEvent) => {
      const date = dateAt(e.clientX, e.clientY);
      if (!date) return;
      current =
        edge === 'end'
          ? { start: origin.start, end: date < origin.start ? origin.start : date }
          : { start: date > origin.end ? origin.end : date, end: origin.end };
      setResizePreview({ taskId: task.id, ...current });
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.classList.remove('is-resizing-span');
      setResizePreview(null);
      if (current.start !== origin.start || current.end !== origin.end) setSpan(task, current.start, current.end);
    };
    document.body.classList.add('is-resizing-span');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  /** Keyboard stretching (Shift+← / Shift+→ on a focused chip or bar): move the last day by one. */
  const nudgeEnd = (task: Task, days: number) => {
    if (!task.dueDate) return;
    const { start } = spanOf(task as Task & { dueDate: string });
    const end = shiftDate(task.dueDate, days);
    if (end < start) return;
    setSpan(task, start, end);
  };

  // A multi-day bar is dragged by its middle: remember which day was grabbed so the drop shifts the whole span
  // by the distance moved, rather than snapping its first day to the drop.
  const grabDate = useRef<string | null>(null);

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    const activator = event.activatorEvent as PointerEvent | MouseEvent | undefined;
    const startY = activator && 'clientY' in activator ? activator.clientY : 0;
    grabDate.current = activator && 'clientX' in activator ? (dateAt(activator.clientX, activator.clientY) ?? null) : null;
    pointerY.current = startY;
    // Measure the grabbed element directly: dnd-kit's own initial rect is not reliable this early.
    const grabbed = activator?.target instanceof Element ? activator.target.closest('.tl-block, .cal-chip') : null;
    grabOffsetY.current = grabbed ? Math.max(0, startY - grabbed.getBoundingClientRect().top) : 0;
  };

  useEffect(() => {
    if (!activeId) return;
    const track = (e: PointerEvent) => {
      pointerY.current = e.clientY;
    };
    document.addEventListener('pointermove', track);
    return () => document.removeEventListener('pointermove', track);
  }, [activeId]);

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const activeKey = String(active.id);
    const overId = String(over.id);

    if (activeKey.startsWith(SPAN_PREFIX)) {
      const task = taskById.get(activeKey.slice(SPAN_PREFIX.length).split(':')[0]);
      if (!task?.dueDate) return;
      if (overId === UNSCHEDULED_ID) {
        update(task, { dueDate: null, startDate: null, dueTime: null, recurrence: 'none' });
        return;
      }
      const target = [DAY_PREFIX, ALLDAY_PREFIX, COL_PREFIX].find((p) => overId.startsWith(p));
      if (!target) return;
      const { start, end } = spanOf(task as Task & { dueDate: string });
      // Keyboard drags have no pointer to read the grabbed day from; they move the first day to the drop.
      const days = daysBetween(grabDate.current ?? start, overId.slice(target.length));
      if (days !== 0) setSpan(task, shiftDate(start, days), shiftDate(end, days));
      return;
    }

    const task = taskById.get(activeKey);
    if (!task) return;
    if (overId === UNSCHEDULED_ID) reschedule(task, null);
    else if (overId.startsWith(DAY_PREFIX)) reschedule(task, overId.slice(DAY_PREFIX.length));
    else if (overId.startsWith(ALLDAY_PREFIX)) reschedule(task, overId.slice(ALLDAY_PREFIX.length), null);
    else if (overId.startsWith(COL_PREFIX)) {
      const date = overId.slice(COL_PREFIX.length);
      const column = columnRefs.current.get(date);
      if (!column) return;
      const blockTop = pointerY.current - grabOffsetY.current;
      const minutes = ((blockTop - column.getBoundingClientRect().top) / HOUR_PX) * 60;
      const clamped = Math.min(24 * 60 - taskDuration(task), Math.max(0, snap(minutes)));
      reschedule(task, date, toTime(clamped));
    }
  };

  const planToday = async () => {
    const today = todayStr();
    setPlanning(true);
    try {
      const { placed, unplaced } = planDay({ date: today, tasks, events: eventsByDate.get(today) ?? [] });
      recordEvent('planDay');
      await taskMut.updateMany(
        `planned ${placed.length} task${placed.length === 1 ? '' : 's'} into today`,
        placed.map(({ task, dueTime }) => ({ task, input: { ...taskToInput(task), dueDate: today, dueTime } })),
      );
      if (placed.length === 0 && unplaced.length === 0) showToast('Nothing left to plan: every task today already has a time.');
      else if (unplaced.length === 0) showToast(`Planned ${placed.length} task${placed.length === 1 ? '' : 's'} into today's free time.`);
      else showToast(`Planned ${placed.length}; ${unplaced.length} did not fit before 6 pm.`);
    } finally {
      setPlanning(false);
    }
  };

  const activeTask = activeId
    ? taskById.get(activeId.startsWith(SPAN_PREFIX) ? activeId.slice(SPAN_PREFIX.length).split(':')[0] : activeId)
    : undefined;

  /** Bars for one row of days (a month week or the week view), laid over that row's cells. */
  const renderSpans = (segments: SpanSegment[], row: number, column: number, top: number) =>
    segments.map((segment) => (
      <SpanBar
        key={`${segment.task.id}:${row}`}
        segment={segment}
        row={row}
        column={column}
        top={top}
        project={projectById.get(segment.task.projectId)}
        onOpen={() => onOpenTask(segment.task.id)}
        onResizeStart={(edge, e) => startResize(segment.task, edge, e)}
        onNudgeEnd={(days) => nudgeEnd(segment.task, days)}
      />
    ));

  /** Open multi-day tasks covering a day, for the day's count. */
  const spanCountOn = (date: string) =>
    spanItems.filter(({ task, span }) => !task.isCompleted && span.start <= date && date <= span.end).length;
  const today = todayStr();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const weekLayout = mode === 'week' ? layoutSpans(spanItems, days.map(toDateStr)) : null;

  const renderWeek = () => (
    <div className="tl-wrap" ref={scrollRef}>
      <div className="tl-head">
        <div className="tl-gutter" />
        {days.map((day) => {
          const date = toDateStr(day);
          return (
            <div key={date} className={`tl-head-cell ${date === today ? 'is-today' : ''}`}>
              {format(day, 'EEE')} <span className="tl-day-number">{format(day, 'd')}</span>
            </div>
          );
        })}
      </div>
      <div className="tl-allday">
        <div className="tl-gutter" style={{ gridRow: 1, gridColumn: 1 }}>
          all day
        </div>
        {days.map((day, i) => {
          const date = toDateStr(day);
          const dayTasks = (tasksByDate.get(date) ?? []).filter((t) => !t.dueTime);
          const dayEvents = (eventsByDate.get(date) ?? []).filter((e) => e.allDay);
          return (
            <AllDayCell key={date} date={date} column={i + 2} reservedLanes={weekLayout?.lanes ?? 0}>
              {dayEvents.map((event) => (
                <EventChip key={`e-${event.calendarId}-${event.id}`} event={event} />
              ))}
              {dayTasks.map((task) => (
                <TaskChip
                  key={task.id}
                  task={task}
                  project={projectById.get(task.projectId)}
                  onOpen={() => onOpenTask(task.id)}
                  onResizeStart={(edge, e) => startResize(task, edge, e)}
                  onNudgeEnd={(days) => nudgeEnd(task, days)}
                />
              ))}
              {(projectedByDate.get(date) ?? []).map((task) => (
                <TaskChip key={`p-${task.id}`} task={task} project={projectById.get(task.projectId)} onOpen={() => onOpenTask(task.id)} projected />
              ))}
            </AllDayCell>
          );
        })}
        {weekLayout && renderSpans(weekLayout.segments, 1, 2, ALLDAY_BAR_TOP)}
      </div>
      <div className="tl-body">
        <div className="tl-gutter" style={{ height: 24 * HOUR_PX }}>
          {Array.from({ length: 23 }, (_, i) => i + 1).map((hour) => (
            <span key={hour} className="tl-hour" style={{ top: hour * HOUR_PX }}>
              {formatTime(`${String(hour).padStart(2, '0')}:00`)}
            </span>
          ))}
        </div>
        {days.map((day) => {
          const date = toDateStr(day);
          const timed = (tasksByDate.get(date) ?? []).filter((t): t is Task & { dueTime: string } => t.dueTime !== null);
          const timedEvents = (eventsByDate.get(date) ?? []).filter((e) => !e.allDay && e.startTime);
          const items = [
            ...timed.map((task) => ({ kind: 'task' as const, task, start: toMinutes(task.dueTime), end: toMinutes(task.dueTime) + taskDuration(task) })),
            ...timedEvents.map((event) => {
              const start = event.date === date ? toMinutes(event.startTime!) : 0;
              const end = event.endDate === date && event.endTime ? toMinutes(event.endTime) : 24 * 60;
              return { kind: 'event' as const, event, start, end: Math.max(end, start + MIN_BLOCK_MINUTES) };
            }),
          ];
          const laid = layoutLanes(items);
          return (
            <TimeColumn
              key={date}
              date={date}
              isToday={date === today}
              columnRef={(el) => {
                if (el) columnRefs.current.set(date, el);
                else columnRefs.current.delete(date);
              }}
              onAddAt={(minutes) => onAddTask(date, toTime(minutes))}
            >
              {laid.map(({ item, lane, lanes }) =>
                item.kind === 'task' ? (
                  <TimeBlock
                    key={item.task.id}
                    task={item.task}
                    project={projectById.get(item.task.projectId)}
                    top={(item.start / 60) * HOUR_PX}
                    height={((item.end - item.start) / 60) * HOUR_PX}
                    lane={lane}
                    lanes={lanes}
                    onOpen={() => onOpenTask(item.task.id)}
                    onResize={(durationMinutes) => update(item.task, { durationMinutes })}
                  />
                ) : (
                  <EventBlock
                    key={`e-${item.event.calendarId}-${item.event.id}`}
                    event={item.event}
                    top={(item.start / 60) * HOUR_PX}
                    height={((item.end - item.start) / 60) * HOUR_PX}
                    lane={lane}
                    lanes={lanes}
                  />
                ),
              )}
              {date === today && <div className="tl-now" style={{ top: (nowMinutes / 60) * HOUR_PX }} />}
            </TimeColumn>
          );
        })}
      </div>
    </div>
  );

  // Month: one row per week, each with its own bar layout.
  const monthRows =
    mode === 'month'
      ? Array.from({ length: days.length / 7 }, (_, w) => {
          const rowDays = days.slice(w * 7, w * 7 + 7);
          return { rowDays, layout: layoutSpans(spanItems, rowDays.map(toDateStr)) };
        })
      : [];

  const renderMonth = () => (
    <div className="cal-grid-wrap">
      <div className="cal-weekdays">
        {days.slice(0, 7).map((d) => (
          <div key={toDateStr(d)} className="cal-weekday">
            {format(d, 'EEE')}
          </div>
        ))}
      </div>
      <div className="cal-grid cal-grid-month">
        {monthRows.map(({ rowDays, layout }, w) => (
          <Fragment key={toDateStr(rowDays[0])}>
            {rowDays.map((day, i) => (
              <DayCell
                key={toDateStr(day)}
                day={day}
                inMonth={isSameMonth(day, anchor)}
                projected={projectedByDate.get(toDateStr(day)) ?? []}
                events={eventsByDate.get(toDateStr(day)) ?? []}
                tasks={tasksByDate.get(toDateStr(day)) ?? []}
                projectById={projectById}
                onOpenTask={onOpenTask}
                onAddTask={onAddTask}
                row={w + 1}
                column={i + 1}
                reservedLanes={layout.lanes}
                spanCount={spanCountOn(toDateStr(day))}
                onResizeStart={startResize}
                onNudgeEnd={nudgeEnd}
              />
            ))}
            {renderSpans(layout.segments, w + 1, 1, MONTH_BAR_TOP)}
          </Fragment>
        ))}
      </div>
    </div>
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="view view-calendar">
        <header className="view-header cal-header">
          <div className="cal-title-row">
            <h1>{title}</h1>
            <div className="cal-nav">
              <button type="button" className="icon-btn" aria-label="Previous" onClick={() => shift(-1)}>
                <ChevronLeft size={18} />
              </button>
              <button type="button" className="btn" onClick={() => setAnchor(new Date())}>
                Today
              </button>
              <button type="button" className="icon-btn" aria-label="Next" onClick={() => shift(1)}>
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="segmented" role="radiogroup" aria-label="Calendar mode">
              {(['month', 'week'] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  className={`segmented-option ${mode === m ? 'is-selected' : ''}`}
                  onClick={() => setMode(m)}
                >
                  {m === 'month' ? 'Month' : 'Week'}
                </button>
              ))}
            </div>
            {mode === 'week' && (
              <button
                type="button"
                className="btn cal-plan-btn"
                onClick={() => void planToday()}
                disabled={planning}
                data-tooltip="Give today's untimed and overdue tasks a time slot in the gaps between your meetings"
              >
                <Sparkles size={14} />
                <span>{planning ? 'Planning…' : 'Plan my day'}</span>
              </button>
            )}
          </div>
          {mode === 'week' && <p className="muted small">Drag a task onto a time to block it. Drag the bottom edge to change its length. Double-click an empty slot to add a task there.</p>}
        </header>

        <div className="cal-layout">
          {mode === 'week' ? renderWeek() : renderMonth()}
          <UnscheduledPanel tasks={unscheduled} projectById={projectById} onOpenTask={onOpenTask} />
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          activeTask.dueTime && mode === 'week' ? (
            <TimeBlock task={activeTask} project={projectById.get(activeTask.projectId)} top={0} height={(taskDuration(activeTask) / 60) * HOUR_PX} lane={0} lanes={1} overlay />
          ) : (
            <TaskChip task={activeTask} project={projectById.get(activeTask.projectId)} overlay />
          )
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
