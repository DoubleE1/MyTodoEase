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
import { useQueryClient } from '@tanstack/react-query';
import {
  addDays,
  addMonths,
  addWeeks,
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
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { queryKeys, useCalendarEvents, useTaskMutations } from '../api/hooks';
import type { ExternalEvent, Project, Task } from '../api/types';
import { PRIORITY_META } from '../lib/colors';
import { compareDue, formatTime, toDateStr, todayStr } from '../lib/dates';
import { layoutLanes, planDay, SNAP_MINUTES, taskDuration, toMinutes, toTime } from '../lib/plan';
import { projectedOccurrences } from '../lib/recurrence';
import { showToast } from '../lib/toast';
import { taskToInput } from './TaskEditor';

interface CalendarViewProps {
  tasks: Task[];
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
const HOUR_PX = 56;
const MIN_BLOCK_MINUTES = 15;

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

// ---------- Chips (month grid, all-day row, unscheduled panel) ----------

function TaskChip({
  task,
  project,
  onOpen,
  overlay,
  projected,
}: {
  task: Task;
  project?: Project;
  onOpen?: () => void;
  overlay?: boolean;
  /** A preview of a future occurrence of a recurring task: not draggable, drawn faded. */
  projected?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: overlay || projected });
  const priority = PRIORITY_META[task.priority];
  const subtitle = [task.dueTime ? formatTime(task.dueTime) : null, project && !project.isInbox ? project.name : null]
    .filter(Boolean)
    .join(' · ');
  const draggable = !overlay && !projected;
  return (
    <button
      type="button"
      ref={draggable ? setNodeRef : undefined}
      className={`cal-chip ${isDragging ? 'is-dragging' : ''} ${overlay ? 'is-overlay' : ''} ${projected ? 'is-projected' : ''}`}
      title={projected ? `${task.content} (repeats here after the current one is completed)` : task.content}
      onClick={onOpen}
      {...(draggable ? { ...attributes, ...listeners } : {})}
    >
      <span className="cal-chip-dot" style={{ borderColor: priority.hex, background: task.priority < 4 ? `${priority.hex}33` : undefined }} />
      <span className="cal-chip-text">
        <span className="cal-chip-title">{task.content}</span>
        {subtitle && <span className="cal-chip-sub">{subtitle}</span>}
      </span>
      {task.recurrence !== 'none' && <Repeat size={10} className="cal-chip-repeat" />}
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
      title={`${event.title} · ${event.calendarName}${event.location ? ` · ${event.location}` : ''}`}
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
}) {
  const dateStr = toDateStr(day);
  const isToday = dateStr === todayStr();
  const isPast = dateStr < todayStr();
  const { setNodeRef, isOver } = useDroppable({ id: DAY_PREFIX + dateStr });
  return (
    <div
      ref={setNodeRef}
      className={`cal-cell cal-cell-month ${inMonth ? '' : 'is-outside'} ${isToday ? 'is-today' : ''} ${isPast ? 'is-past' : ''} ${isOver ? 'is-over' : ''}`}
    >
      <div className="cal-cell-head">
        <span className="cal-day-number">{format(day, 'd')}</span>
        {tasks.length > 0 && <span className="cal-count muted">{tasks.length}</span>}
        <button
          type="button"
          className="icon-btn cal-add"
          title={`Add task on ${format(day, 'd MMM')}`}
          aria-label={`Add task on ${format(day, 'd MMMM')}`}
          onClick={() => onAddTask(dateStr)}
        >
          <Plus size={13} />
        </button>
      </div>
      <div className="cal-cell-body">
        {events.map((event) => (
          <EventChip key={`e-${event.calendarId}-${event.id}`} event={event} />
        ))}
        {tasks.map((task) => (
          <TaskChip key={task.id} task={task} project={projectById.get(task.projectId)} onOpen={() => onOpenTask(task.id)} />
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
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: overlay });
  const [previewHeight, setPreviewHeight] = useState<number | null>(null);
  const priority = PRIORITY_META[task.priority];
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
      ref={overlay ? undefined : setNodeRef}
      className={`tl-block ${isDragging ? 'is-dragging' : ''} ${overlay ? 'is-overlay' : ''}`}
      style={style}
      title={task.content}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onOpen) onOpen();
      }}
      {...(overlay ? {} : { ...attributes, ...listeners })}
    >
      <span className="tl-block-title">
        <span className="tl-block-dot" style={{ borderColor: priority.hex, background: task.priority < 4 ? `${priority.hex}33` : undefined }} />
        {task.content}
        {task.recurrence !== 'none' && <Repeat size={10} className="cal-chip-repeat" style={{ marginLeft: 4 }} />}
      </span>
      <span className="tl-block-sub">{subtitle}</span>
      {!overlay && onResize && <span className="tl-resize" onPointerDown={startResize} aria-hidden="true" />}
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
      title={`${event.title} · ${event.calendarName}${event.location ? ` · ${event.location}` : ''}`}
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

function AllDayCell({ date, children }: { date: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: ALLDAY_PREFIX + date });
  return (
    <div ref={setNodeRef} className={`tl-allday-cell ${isOver ? 'is-over' : ''}`}>
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

export function CalendarView({ tasks, projects, onOpenTask, onAddTask }: CalendarViewProps) {
  const queryClient = useQueryClient();
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

  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.dueDate) continue;
      const list = map.get(task.dueDate) ?? [];
      list.push(task);
      map.set(task.dueDate, list);
    }
    for (const list of map.values()) list.sort((a, b) => compareDue(a, b) || a.priority - b.priority || a.order - b.order);
    return map;
  }, [tasks]);

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

  const update = (task: Task, changes: Partial<Task>) => {
    // Optimistic: the chip or block lands on its new slot immediately.
    queryClient.setQueryData<Task[]>(queryKeys.tasks, (old) => old?.map((t) => (t.id === task.id ? { ...t, ...changes } : t)));
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

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    const activator = event.activatorEvent as PointerEvent | MouseEvent | undefined;
    const startY = activator && 'clientY' in activator ? activator.clientY : 0;
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
    const task = taskById.get(String(active.id));
    if (!task) return;
    const overId = String(over.id);
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
      for (const { task, dueTime } of placed) {
        await taskMut.update.mutateAsync({ id: task.id, input: { ...taskToInput(task), dueDate: today, dueTime } });
      }
      if (placed.length === 0 && unplaced.length === 0) showToast('Nothing left to plan: every task today already has a time.');
      else if (unplaced.length === 0) showToast(`Planned ${placed.length} task${placed.length === 1 ? '' : 's'} into today's free time.`);
      else showToast(`Planned ${placed.length}; ${unplaced.length} did not fit before 6 pm.`);
    } finally {
      setPlanning(false);
    }
  };

  const activeTask = activeId ? taskById.get(activeId) : undefined;
  const today = todayStr();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

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
        <div className="tl-gutter">all day</div>
        {days.map((day) => {
          const date = toDateStr(day);
          const dayTasks = (tasksByDate.get(date) ?? []).filter((t) => !t.dueTime);
          const dayEvents = (eventsByDate.get(date) ?? []).filter((e) => e.allDay);
          return (
            <AllDayCell key={date} date={date}>
              {dayEvents.map((event) => (
                <EventChip key={`e-${event.calendarId}-${event.id}`} event={event} />
              ))}
              {dayTasks.map((task) => (
                <TaskChip key={task.id} task={task} project={projectById.get(task.projectId)} onOpen={() => onOpenTask(task.id)} />
              ))}
              {(projectedByDate.get(date) ?? []).map((task) => (
                <TaskChip key={`p-${task.id}`} task={task} project={projectById.get(task.projectId)} onOpen={() => onOpenTask(task.id)} projected />
              ))}
            </AllDayCell>
          );
        })}
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
        {days.map((day) => (
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
          />
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
                title="Give today's untimed and overdue tasks a time slot in the gaps between your meetings"
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
