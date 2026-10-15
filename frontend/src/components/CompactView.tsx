import { addDays, format } from 'date-fns';
import { CalendarDays, Check, ChevronDown, ChevronUp, EyeOff, Inbox, Maximize2, Plus, Tag } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useTaskMutations } from '../api/hooks';
import type { Label, Project, Section, Task, TaskInput } from '../api/types';
import { colorHex } from '../lib/colors';
import { toDateStr, todayStr, tomorrowStr } from '../lib/dates';
import { isOverdue, sortByOrder, sortForAgenda } from '../lib/views';
import { Popover } from './Popover';
import { TaskEditor, taskToInput } from './TaskEditor';
import { TaskItem } from './TaskItem';

interface CompactViewProps {
  tasks: Task[];
  projects: Project[];
  sections: Section[];
  labels: Label[];
  /** Browser only: the desktop title bar has its own expand button. */
  showExpand: boolean;
  onExpand: () => void;
  onOpenTask: (id: string) => void;
  onDeleteTask: (task: Task) => void;
  onCreateLabel: (name: string) => Promise<Label>;
}

/** What the lower pane of the mini window shows. Serialized as "kind" or "kind:id". */
type Secondary =
  | { kind: 'nodate' }
  | { kind: 'inbox' }
  | { kind: 'upcoming' }
  | { kind: 'project'; id: string }
  | { kind: 'label'; id: string };

const SECONDARY_KEY = 'mytodoease.compact.secondary';
const SPLIT_KEY = 'mytodoease.compact.split';
const COLLAPSED_KEY = 'mytodoease.compact.lowerCollapsed';
const MIN_RATIO = 0.15;
/** Largest share Today keeps while the lower pane is open; releasing a drag past this collapses the pane. */
const MAX_RATIO = 0.85;
const DEFAULT_RATIO = 0.55;

const serialize = (s: Secondary): string => ('id' in s ? `${s.kind}:${s.id}` : s.kind);

function deserialize(value: string | null): Secondary {
  if (!value) return { kind: 'nodate' };
  const [kind, id] = value.split(':');
  if (kind === 'project' && id) return { kind, id };
  if (kind === 'label' && id) return { kind, id };
  if (kind === 'nodate' || kind === 'inbox' || kind === 'upcoming') return { kind };
  return { kind: 'nodate' };
}

function readStored<T>(key: string, parse: (raw: string | null) => T): T {
  try {
    return parse(window.localStorage.getItem(key));
  } catch {
    return parse(null);
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not persisted; fine.
  }
}

/** Mini window: today's tasks on top, a user-chosen list below, with a draggable divider between them. */
export function CompactView({
  tasks,
  projects,
  sections,
  labels,
  showExpand,
  onExpand,
  onOpenTask,
  onDeleteTask,
  onCreateLabel,
}: CompactViewProps) {
  const taskMut = useTaskMutations();
  const [addingTop, setAddingTop] = useState(false);
  const [addingBottom, setAddingBottom] = useState(false);
  const [secondary, setSecondaryState] = useState<Secondary>(() => readStored(SECONDARY_KEY, deserialize));
  const [ratio, setRatio] = useState<number>(() =>
    readStored(SPLIT_KEY, (raw) => {
      const n = Number(raw);
      return Number.isFinite(n) && n >= MIN_RATIO && n <= MAX_RATIO ? n : DEFAULT_RATIO;
    }),
  );
  const [dragging, setDragging] = useState(false);
  const [lowerCollapsed, setLowerCollapsedState] = useState<boolean>(() =>
    readStored(COLLAPSED_KEY, (raw) => raw === 'true'),
  );
  const splitRef = useRef<HTMLDivElement>(null);
  const dragPosition = useRef<number | null>(null);
  const dragStartRatio = useRef(DEFAULT_RATIO);

  const setLowerCollapsed = (flag: boolean) => {
    setLowerCollapsedState(flag);
    store(COLLAPSED_KEY, String(flag));
  };

  const today = todayStr();
  const inbox = projects.find((p) => p.isInbox);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const overdue = sortForAgenda(tasks.filter((t) => isOverdue(t, today)));
  const dueToday = sortForAgenda(tasks.filter((t) => t.dueDate === today));
  const remaining = overdue.length + dueToday.length;

  // If the chosen project or label was deleted, fall back to "No date".
  useEffect(() => {
    if (secondary.kind === 'project' && !projects.some((p) => p.id === secondary.id)) setSecondary({ kind: 'nodate' });
    if (secondary.kind === 'label' && !labels.some((l) => l.id === secondary.id)) setSecondary({ kind: 'nodate' });
  });

  const setSecondary = (next: Secondary) => {
    setSecondaryState(next);
    store(SECONDARY_KEY, serialize(next));
    setAddingBottom(false);
    // Picking a list is a clear signal the user wants to see it.
    setLowerCollapsed(false);
  };

  // Functional update so rapid key repeats or pointer moves never work from a stale value.
  // `max` is 1 while dragging so the pane can follow the pointer all the way to the bottom edge.
  const commitRatio = useCallback((update: number | ((previous: number) => number), max = MAX_RATIO) => {
    setRatio((previous) => {
      const next = typeof update === 'function' ? update(previous) : update;
      return Math.min(max, Math.max(MIN_RATIO, next));
    });
  }, []);

  useEffect(() => {
    // Only remember sizes the pane can actually be reopened at.
    if (ratio <= MAX_RATIO) store(SPLIT_KEY, ratio.toFixed(3));
  }, [ratio]);

  // Divider drag: pointer capture keeps the drag alive even when the cursor leaves the bar.
  const onDividerPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bar = event.currentTarget;
    try {
      bar.setPointerCapture(event.pointerId);
    } catch {
      // Some pointer sources cannot be captured; the drag still works while over the bar.
    }
    dragPosition.current = null;
    dragStartRatio.current = ratio;
    setDragging(true);
    const move = (e: globalThis.PointerEvent) => {
      const rect = splitRef.current?.getBoundingClientRect();
      if (!rect || rect.height === 0) return;
      const raw = (e.clientY - rect.top) / rect.height;
      dragPosition.current = raw;
      commitRatio(raw, 1);
    };
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      setDragging(false);
      const released = dragPosition.current;
      dragPosition.current = null;
      if (released !== null && released > MAX_RATIO) {
        // Dragged past the point where the pane is useful: hide it, and keep the size it had
        // before the drag so reopening brings it back at a sensible height.
        setLowerCollapsed(true);
        commitRatio(Math.min(dragStartRatio.current, MAX_RATIO));
      }
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  };

  const onDividerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp') commitRatio((r) => r - 0.05);
    else if (event.key === 'ArrowDown' && ratio >= MAX_RATIO - 0.001) setLowerCollapsed(true);
    else if (event.key === 'ArrowDown') commitRatio((r) => r + 0.05);
    else return;
    event.preventDefault();
  };

  const rescheduleOverdue = async () => {
    await Promise.all(
      overdue.map((t) => taskMut.update.mutateAsync({ id: t.id, input: { ...taskToInput(t), dueDate: today } })),
    );
  };

  const renderTask = (task: Task) => (
    <TaskItem
      key={task.id}
      task={task}
      project={projectById.get(task.projectId)}
      labels={labels}
      showProject
      childCount={tasks.filter((t) => t.parentId === task.id).length}
      onToggle={() => taskMut.complete.mutate(task.id)}
      onOpen={() => onOpenTask(task.id)}
      onDelete={() => onDeleteTask(task)}
    />
  );

  // ----- Lower pane contents -----
  const lower = ((): { title: string; tasks: Task[]; defaults: Partial<TaskInput>; empty: string } => {
    switch (secondary.kind) {
      case 'nodate':
        return {
          title: 'No date',
          tasks: tasks.filter((t) => !t.dueDate).sort((a, b) => a.priority - b.priority || a.order - b.order),
          defaults: { projectId: inbox?.id },
          empty: 'Everything has a date.',
        };
      case 'inbox':
        return {
          title: 'Inbox',
          tasks: inbox ? sortByOrder(tasks.filter((t) => t.projectId === inbox.id)) : [],
          defaults: { projectId: inbox?.id },
          empty: 'Inbox is empty.',
        };
      case 'upcoming': {
        const last = toDateStr(addDays(new Date(), 7));
        return {
          title: 'Upcoming',
          tasks: sortForAgenda(tasks.filter((t) => t.dueDate !== null && t.dueDate > today && t.dueDate <= last)),
          defaults: { projectId: inbox?.id, dueDate: tomorrowStr() },
          empty: 'Nothing due in the next 7 days.',
        };
      }
      case 'project': {
        const project = projectById.get(secondary.id);
        return {
          title: project?.name ?? 'Project',
          tasks: sortByOrder(tasks.filter((t) => t.projectId === secondary.id)),
          defaults: { projectId: secondary.id },
          empty: 'No tasks in this project.',
        };
      }
      case 'label': {
        const label = labels.find((l) => l.id === secondary.id);
        return {
          title: label ? `@${label.name}` : 'Label',
          tasks: sortForAgenda(tasks.filter((t) => t.labelIds.includes(secondary.id))),
          defaults: { projectId: inbox?.id, labelIds: [secondary.id] },
          empty: 'No tasks with this label.',
        };
      }
    }
  })();

  const lowerVisible = !lowerCollapsed;

  const addEditor = (defaults: Partial<TaskInput>, placeholder: string, onCancel: () => void) =>
    inbox ? (
      <TaskEditor
        mode="create"
        defaults={defaults}
        projects={projects}
        sections={sections}
        labels={labels}
        onCreateLabel={onCreateLabel}
        keepOpenAfterSubmit
        onSubmit={(input) => taskMut.create.mutateAsync(input)}
        onCancel={onCancel}
        placeholder={placeholder}
      />
    ) : null;

  const addButton = (onClick: () => void): ReactNode => (
    <button type="button" className="add-task-btn" onClick={onClick}>
      <Plus size={16} />
      <span>Add task</span>
    </button>
  );

  const lowerOptions: { value: Secondary; label: string; icon: ReactNode }[] = [
    { value: { kind: 'nodate' }, label: 'No date', icon: <CalendarDays size={14} /> },
    { value: { kind: 'inbox' }, label: 'Inbox', icon: <Inbox size={14} /> },
    { value: { kind: 'upcoming' }, label: 'Upcoming (7 days)', icon: <CalendarDays size={14} /> },
    ...projects
      .filter((p) => !p.isInbox)
      .map((p) => ({
        value: { kind: 'project', id: p.id } as Secondary,
        label: p.name,
        icon: <span className="dot" style={{ background: colorHex(p.color) }} />,
      })),
    ...labels.map((l) => ({
      value: { kind: 'label', id: l.id } as Secondary,
      label: l.name,
      icon: <Tag size={14} color={colorHex(l.color)} />,
    })),
  ];
  const currentKey = serialize(secondary);
  const currentOption = lowerOptions.find((o) => serialize(o.value) === currentKey);

  const panePicker = (
    <Popover
      align="right"
      trigger={({ onClick, open }) => (
        <button
          type="button"
          className={`chip ${open ? 'is-open' : ''}`}
          onClick={onClick}
          aria-label="Choose what the lower pane shows"
          title="Choose what this pane shows"
        >
          {currentOption?.icon}
          <span>{currentOption?.label ?? 'Choose'}</span>
          <ChevronDown size={13} />
        </button>
      )}
    >
      {(close) => (
        <div className="picker">
          {lowerOptions.map((o) => {
            const key = serialize(o.value);
            return (
              <button
                key={key}
                type="button"
                className={`picker-row ${key === currentKey ? 'is-selected' : ''}`}
                onClick={() => {
                  setSecondary(o.value);
                  close();
                }}
              >
                {o.icon}
                <span className="row-label">{o.label}</span>
                {key === currentKey && <Check size={14} className="row-check" />}
              </button>
            );
          })}
          <button
            type="button"
            className="picker-row picker-row-divider"
            onClick={() => {
              setLowerCollapsed(true);
              close();
            }}
          >
            <EyeOff size={14} />
            <span className="row-label">Hide this pane</span>
          </button>
        </div>
      )}
    </Popover>
  );

  return (
    <div className="compact">
      <header className="compact-header">
        <div className="compact-title">
          <h1>Today</h1>
          <span className="muted small">
            {format(new Date(), 'EEE d MMM')} · {remaining === 0 ? 'all done' : `${remaining} left`}
          </span>
        </div>
        {showExpand && (
          <div className="compact-actions">
            <button
              type="button"
              className="icon-btn"
              title="Back to full window"
              aria-label="Back to full window"
              onClick={onExpand}
            >
              <Maximize2 size={16} />
            </button>
          </div>
        )}
      </header>

      <div className={`compact-split ${dragging ? 'is-dragging' : ''}`} ref={splitRef}>
        <section className="compact-pane" style={{ flexGrow: lowerVisible ? ratio : 1 }} aria-label="Today">
          <div className="pane-body">
            {overdue.length > 0 && (
              <div className="task-group">
                <div className="group-header">
                  <h2 className="overdue-title">Overdue</h2>
                  <button type="button" className="link-btn" onClick={() => void rescheduleOverdue()}>
                    Reschedule to today
                  </button>
                </div>
                <ul className="task-list">{overdue.map(renderTask)}</ul>
              </div>
            )}
            <div className="task-group">
              {overdue.length > 0 && (
                <div className="group-header">
                  <h2>Today</h2>
                </div>
              )}
              <ul className="task-list">{dueToday.map(renderTask)}</ul>
              {dueToday.length === 0 && !addingTop && (
                <p className="empty">{overdue.length > 0 ? 'Nothing else due today.' : 'Nothing due today.'}</p>
              )}
            </div>
          </div>
          <div className="pane-footer">
            {addingTop
              ? addEditor({ projectId: inbox?.id, dueDate: today }, 'Add a task for today', () => setAddingTop(false))
              : addButton(() => setAddingTop(true))}
          </div>
        </section>

        {lowerVisible && (
          <div
            className={`compact-divider ${dragging && ratio > MAX_RATIO ? 'will-collapse' : ''}`}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize panes"
            aria-valuemin={Math.round(MIN_RATIO * 100)}
            aria-valuemax={Math.round(MAX_RATIO * 100)}
            aria-valuenow={Math.round(ratio * 100)}
            tabIndex={0}
            title="Drag to resize (or use the arrow keys)"
            onPointerDown={onDividerPointerDown}
            onKeyDown={onDividerKeyDown}
          >
            <span className="compact-divider-grip" />
          </div>
        )}

        {lowerVisible ? (
          <section
            className="compact-pane compact-pane-lower"
            style={{
              flexGrow: 1 - ratio,
              // Past the collapse point the pane fades out as it shrinks, so the hide feels continuous.
              opacity: ratio > MAX_RATIO ? Math.max(0, 1 - (ratio - MAX_RATIO) / (1 - MAX_RATIO)) : 1,
            }}
            aria-label={lower.title}
          >
            <div className="pane-header">
              <h2>{lower.title}</h2>
              <span className="muted small">{lower.tasks.length || ''}</span>
              <span className="spacer" />
              {panePicker}
            </div>
            <div className="pane-body">
              <ul className="task-list">{lower.tasks.map(renderTask)}</ul>
              {lower.tasks.length === 0 && !addingBottom && <p className="empty">{lower.empty}</p>}
            </div>
            <div className="pane-footer">
              {addingBottom
                ? addEditor(lower.defaults, `Add a task to ${lower.title}`, () => setAddingBottom(false))
                : addButton(() => setAddingBottom(true))}
            </div>
          </section>
        ) : (
          // Collapsed: a slim bar with one button that brings the pane back.
          <div className="pane-collapsed-bar">
            <span className="muted small pane-collapsed-label">{lower.title}</span>
            <span className="spacer" />
            <button
              type="button"
              className="icon-btn pane-expand"
              title={`Show ${lower.title}`}
              aria-label={`Show ${lower.title} pane`}
              onClick={() => setLowerCollapsed(false)}
            >
              <ChevronUp size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
