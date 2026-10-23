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
import { ChevronLeft, ChevronRight, Plus, Repeat } from 'lucide-react';
import { useMemo, useState } from 'react';
import { projectedOccurrences } from '../lib/recurrence';
import { useCalendarEvents } from '../api/hooks';
import type { ExternalEvent } from '../api/types';
import { queryKeys, useTaskMutations } from '../api/hooks';
import type { Project, Task } from '../api/types';
import { PRIORITY_META } from '../lib/colors';
import { compareDue, formatTime, toDateStr, todayStr } from '../lib/dates';
import { taskToInput } from './TaskEditor';

interface CalendarViewProps {
  tasks: Task[];
  projects: Project[];
  onOpenTask: (id: string) => void;
  onAddTask: (dueDate: string) => void;
}

type Mode = 'month' | 'week';

const WEEK_STARTS_ON = 1; // Monday
const DAY_PREFIX = 'day:';
const UNSCHEDULED_ID = 'unscheduled';

// The cell under the pointer wins; the overlay chip is wider than a cell, so its centre would be misleading.
// Keyboard drags have no pointer and fall back to the nearest centre.
const collisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : closestCenter(args);
};

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

/** A Google Calendar event: read-only, opens in Google on click. */
function EventChip({ event }: { event: ExternalEvent }) {
  const open = () => {
    if (!event.htmlLink) return;
    const desktop = window.mytodoease;
    if (desktop?.openExternal) void desktop.openExternal(event.htmlLink);
    else window.open(event.htmlLink, '_blank', 'noopener');
  };
  const time = event.allDay ? 'All day' : `${formatTime(event.startTime!)}${event.endTime ? `–${formatTime(event.endTime)}` : ''}`;
  return (
    <button
      type="button"
      className="cal-chip is-event"
      title={`${event.title} · ${event.calendarName}${event.location ? ` · ${event.location}` : ''}`}
      onClick={open}
    >
      <span className="cal-chip-dot cal-event-dot" style={{ background: event.color ?? 'var(--text-muted)', borderColor: event.color ?? 'var(--text-muted)' }} />
      <span className="cal-chip-text">
        <span className="cal-chip-title">{event.title}</span>
        <span className="cal-chip-sub">{time}</span>
      </span>
    </button>
  );
}

function DayCell({
  day,
  mode,
  inMonth,
  tasks,
  projected,
  events,
  projectById,
  onOpenTask,
  onAddTask,
}: {
  day: Date;
  mode: Mode;
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
      className={`cal-cell cal-cell-${mode} ${inMonth ? '' : 'is-outside'} ${isToday ? 'is-today' : ''} ${isPast ? 'is-past' : ''} ${isOver ? 'is-over' : ''}`}
    >
      <div className="cal-cell-head">
        {/* Week mode shows the date in the column header row instead, so the cell stays uncluttered. */}
        {mode === 'month' && <span className="cal-day-number">{format(day, 'd')}</span>}
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
          <TaskChip
            key={`p-${task.id}`}
            task={task}
            project={projectById.get(task.projectId)}
            onOpen={() => onOpenTask(task.id)}
            projected
          />
        ))}
      </div>
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
      <p className="muted small cal-hint">Drag a task onto a day to schedule it, or drop one here to clear its date.</p>
      <div className="cal-unscheduled-list">
        {tasks.length === 0 && <p className="muted small">Everything is scheduled.</p>}
        {tasks.map((task) => (
          <TaskChip key={task.id} task={task} project={projectById.get(task.projectId)} onOpen={() => onOpenTask(task.id)} />
        ))}
      </div>
    </aside>
  );
}

export function CalendarView({ tasks, projects, onOpenTask, onAddTask }: CalendarViewProps) {
  const queryClient = useQueryClient();
  const taskMut = useTaskMutations();
  const [mode, setMode] = useState<Mode>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [activeId, setActiveId] = useState<string | null>(null);
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

  const title =
    mode === 'month'
      ? format(anchor, 'MMMM yyyy')
      : `${format(rangeStart, 'd MMM')} – ${format(rangeEnd, 'd MMM yyyy')}`;

  const shift = (direction: -1 | 1) =>
    setAnchor((a) => (mode === 'month' ? addMonths(a, direction) : addWeeks(a, direction)));

  const reschedule = (task: Task, dueDate: string | null) => {
    if (task.dueDate === dueDate) return;
    const changes = dueDate
      ? { dueDate }
      : { dueDate: null, dueTime: null, recurrence: 'none' as const };
    // Optimistic: the chip lands on its new day immediately.
    queryClient.setQueryData<Task[]>(queryKeys.tasks, (old) =>
      old?.map((t) => (t.id === task.id ? { ...t, ...changes } : t)),
    );
    taskMut.update.mutate({ id: task.id, input: { ...taskToInput(task), ...changes } });
  };

  const onDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const task = taskById.get(String(active.id));
    if (!task) return;
    const overId = String(over.id);
    if (overId === UNSCHEDULED_ID) reschedule(task, null);
    else if (overId.startsWith(DAY_PREFIX)) reschedule(task, overId.slice(DAY_PREFIX.length));
  };

  const activeTask = activeId ? taskById.get(activeId) : undefined;
  const today = todayStr();
  const weekdayHeaders = days.slice(0, 7).map((d) => ({
    key: toDateStr(d),
    label: mode === 'week' ? format(d, 'EEE d') : format(d, 'EEE'),
    isToday: mode === 'week' && toDateStr(d) === today,
  }));

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
          </div>
        </header>

        <div className="cal-layout">
          <div className="cal-grid-wrap">
            <div className="cal-weekdays">
              {weekdayHeaders.map((h) => (
                <div key={h.key} className={`cal-weekday ${h.isToday ? 'is-today' : ''}`}>
                  {h.isToday ? <span className="cal-weekday-today">{h.label}</span> : h.label}
                </div>
              ))}
            </div>
            <div className={`cal-grid cal-grid-${mode}`}>
              {days.map((day) => (
                <DayCell
                  key={toDateStr(day)}
                  day={day}
                  mode={mode}
                  inMonth={mode === 'week' || isSameMonth(day, anchor)}
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
          <UnscheduledPanel tasks={unscheduled} projectById={projectById} onOpenTask={onOpenTask} />
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask ? <TaskChip task={activeTask} project={projectById.get(activeTask.projectId)} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}
