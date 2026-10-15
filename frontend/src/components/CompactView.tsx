import { addDays, format } from 'date-fns';
import { Maximize2, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useTaskMutations } from '../api/hooks';
import type { Label, Project, Section, Task, TaskInput } from '../api/types';
import { toDateStr, todayStr, tomorrowStr } from '../lib/dates';
import { isOverdue, sortByOrder, sortForAgenda } from '../lib/views';
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
  | { kind: 'none' }
  | { kind: 'nodate' }
  | { kind: 'inbox' }
  | { kind: 'upcoming' }
  | { kind: 'project'; id: string }
  | { kind: 'label'; id: string };

const SECONDARY_KEY = 'mytodoease.compact.secondary';
const SPLIT_KEY = 'mytodoease.compact.split';
const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;

const serialize = (s: Secondary): string => ('id' in s ? `${s.kind}:${s.id}` : s.kind);

function deserialize(value: string | null): Secondary {
  if (!value) return { kind: 'nodate' };
  const [kind, id] = value.split(':');
  if (kind === 'project' && id) return { kind, id };
  if (kind === 'label' && id) return { kind, id };
  if (kind === 'none' || kind === 'nodate' || kind === 'inbox' || kind === 'upcoming') return { kind };
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
      return Number.isFinite(n) && n >= MIN_RATIO && n <= MAX_RATIO ? n : 0.55;
    }),
  );
  const splitRef = useRef<HTMLDivElement>(null);

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
  };

  // Functional update so rapid key repeats or pointer moves never work from a stale value.
  const commitRatio = useCallback((update: number | ((previous: number) => number)) => {
    setRatio((previous) => {
      const next = typeof update === 'function' ? update(previous) : update;
      return Math.min(MAX_RATIO, Math.max(MIN_RATIO, next));
    });
  }, []);

  useEffect(() => {
    store(SPLIT_KEY, ratio.toFixed(3));
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
    const move = (e: globalThis.PointerEvent) => {
      const rect = splitRef.current?.getBoundingClientRect();
      if (!rect || rect.height === 0) return;
      commitRatio((e.clientY - rect.top) / rect.height);
    };
    const up = () => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  };

  const onDividerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp') commitRatio((r) => r - 0.05);
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
  const lower = ((): { title: string; tasks: Task[]; defaults: Partial<TaskInput>; empty: string } | null => {
    switch (secondary.kind) {
      case 'none':
        return null;
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

  const lowerOptions: { value: string; label: string }[] = [
    { value: 'nodate', label: 'No date' },
    { value: 'inbox', label: 'Inbox' },
    { value: 'upcoming', label: 'Upcoming (7 days)' },
    ...projects.filter((p) => !p.isInbox).map((p) => ({ value: `project:${p.id}`, label: `# ${p.name}` })),
    ...labels.map((l) => ({ value: `label:${l.id}`, label: `@ ${l.name}` })),
    { value: 'none', label: 'Hide this pane' },
  ];

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

      <div className="compact-split" ref={splitRef}>
        <section className="compact-pane" style={{ flexGrow: lower ? ratio : 1 }} aria-label="Today">
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

        {lower && (
          <div
            className="compact-divider"
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

        <section
          className={`compact-pane compact-pane-lower ${lower ? '' : 'is-hidden'}`}
          style={{ flexGrow: lower ? 1 - ratio : 0 }}
          aria-label={lower?.title ?? 'Lower pane'}
        >
          <div className="pane-header">
            {lower && <h2>{lower.title}</h2>}
            {lower && <span className="muted small">{lower.tasks.length || ''}</span>}
            <span className="spacer" />
            <select
              className="pane-select"
              aria-label="Choose what the lower pane shows"
              value={serialize(secondary)}
              onChange={(e) => setSecondary(deserialize(e.target.value))}
            >
              {lowerOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {lower && (
            <>
              <div className="pane-body">
                <ul className="task-list">{lower.tasks.map(renderTask)}</ul>
                {lower.tasks.length === 0 && !addingBottom && <p className="empty">{lower.empty}</p>}
              </div>
              <div className="pane-footer">
                {addingBottom
                  ? addEditor(lower.defaults, `Add a task to ${lower.title}`, () => setAddingBottom(false))
                  : addButton(() => setAddingBottom(true))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
