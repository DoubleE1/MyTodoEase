import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { addDays, format } from 'date-fns';
import { useCalendarEvents } from '../api/hooks';
import { planDay } from '../lib/plan';
import { showToast } from '../lib/toast';
import type { ExternalEvent } from '../api/types';
import {
  CalendarDays,
  Check,
  Columns3,
  ChevronDown,
  Flag,
  GripVertical,
  Layers,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { inboxTasks, setInboxFilter, useInboxFilter, type InboxFilter } from '../lib/inboxFilter';
import {
  DEFAULT_VIEW_OPTIONS,
  isDefaultOptions,
  setViewOptions,
  sortTasks,
  useViewOptions,
  viewOptionsKey,
  type GroupBy,
  type SortBy,
  type ViewOptions,
} from '../lib/viewOptions';
import { colorHex, PRIORITY_META } from '../lib/colors';
import type { Priority } from '../api/types';
import { ProjectIcon } from './Pickers';
import { BoardView, type BoardColumn } from './BoardView';
import { recordEvent } from '../lib/achievements';
import { Popover } from './Popover';
import { useRef, useState, type ReactNode } from 'react';
import { useSectionMutations, useTaskMutations } from '../api/hooks';
import type { Label, Project, ReorderItem, Section, Task, TaskInput } from '../api/types';
import { describeDayHeading, formatTime, toDateStr, todayStr } from '../lib/dates';
import { isOverdue, matchesSearch, sortByOrder, sortForAgenda, viewTitle, type View } from '../lib/views';
import type { ConfirmOptions } from './Dialogs';
import { TaskEditor, taskToInput } from './TaskEditor';
import { TaskItem, type TaskItemProps } from './TaskItem';
import { AnimatedList } from './AnimatedList';
import { setDragging } from '../lib/motion';

interface TaskListProps {
  view: View;
  tasks: Task[];
  completedTasks: Task[];
  projects: Project[];
  sections: Section[];
  labels: Label[];
  onOpenTask: (id: string) => void;
  onDeleteTask: (task: Task) => void;
  onCreateLabel: (name: string) => Promise<Label>;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

interface Group {
  key: string;
  title: string | null;
  tasks: Task[];
  /** Defaults for the inline "Add task" editor; null hides the button. */
  defaults: Partial<TaskInput> | null;
  section?: Section;
  /** Render subtasks nested under their parent (project views) instead of flat. */
  nested: boolean;
  /** Tasks can be dragged to reorder (manual order in a project view). */
  sortable?: boolean;
  /** Shown before the title (a project's colour in the Inbox's "All projects" listing). */
  icon?: ReactNode;
  emptyText?: string;
  isOverdue?: boolean;
  /** Google Calendar events on this day (Today and Upcoming views). */
  events?: ExternalEvent[];
}

const NO_SECTION_KEY = 'no-section';
const COLLAPSED_GROUPS_KEY = 'mytodoease.collapsedGroups';
const DROP_PREFIX = 'drop:';

/** Top-level task row that can be dragged within and across section groups. */
function SortableTask({ task, ...rest }: Omit<TaskItemProps, 'handle' | 'innerRef' | 'style' | 'className'>) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    // Rows make way quickly and the dropped row settles with a slight spring.
    transition: { duration: 220, easing: 'cubic-bezier(0.3, 1.25, 0.5, 1)' },
  });
  return (
    <TaskItem
      {...rest}
      task={task}
      innerRef={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'is-dragging' : ''}
      handle={
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="drag-handle"
          data-tooltip="Drag to reorder"
          aria-label={`Drag to reorder ${task.content}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
      }
    />
  );
}

/** The Inbox's project filter: "All projects" (the default) or one project, each with its open task count. */
function InboxFilterPicker({ projects, tasks, filter }: { projects: Project[]; tasks: Task[]; filter: InboxFilter }) {
  const ordered = [...projects].sort((a, b) => Number(b.isInbox) - Number(a.isInbox) || a.order - b.order);
  const selected = filter === 'all' ? undefined : projects.find((p) => p.id === filter);
  const countFor = (f: InboxFilter) => inboxTasks(tasks, f).length;
  const row = (f: InboxFilter, icon: ReactNode, label: string, close: () => void) => (
    <button
      key={f}
      type="button"
      role="menuitemradio"
      aria-checked={filter === f}
      className={`picker-row ${filter === f ? 'is-selected' : ''}`}
      onClick={() => {
        setInboxFilter(f);
        close();
      }}
    >
      {icon}
      <span className="row-label">{label}</span>
      <span className="muted small">{countFor(f) || ''}</span>
    </button>
  );
  return (
    <Popover
      align="right"
      trigger={({ onClick, open }) => (
        <button
          type="button"
          className={`chip inbox-filter ${open ? 'is-open' : ''}`}
          onClick={onClick}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Show tasks from: ${selected?.name ?? 'All projects'}`}
        >
          {selected ? <ProjectIcon project={selected} /> : <Layers size={14} />}
          <span>{selected?.name ?? 'All projects'}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      )}
    >
      {(close) => (
        <div className="picker picker-scroll" role="menu" aria-label="Show tasks from">
          {row('all', <Layers size={14} />, 'All projects', close)}
          <div className="menu-sep" role="separator" />
          {ordered.map((p) => row(p.id, <ProjectIcon project={p} />, p.name, close))}
        </div>
      )}
    </Popover>
  );
}

/**
 * "View options": how this page groups and sorts its tasks. "Default" names the page's own layout
 * (sections, projects, days; manual or due-date order) so it is clear what resetting goes back to.
 */
function ViewOptionsMenu({
  options,
  onChange,
  defaultGroupLabel,
  defaultSortLabel,
  showProjectGrouping,
}: {
  options: ViewOptions;
  onChange: (options: ViewOptions) => void;
  defaultGroupLabel: string;
  defaultSortLabel: string;
  showProjectGrouping: boolean;
}) {
  const groupChoices: [GroupBy, string][] = [
    ['default', defaultGroupLabel],
    ['none', 'None'],
    ...(showProjectGrouping ? ([['project', 'Project']] as [GroupBy, string][]) : []),
    ['date', 'Due date'],
    ['priority', 'Priority'],
    ['label', 'Label'],
  ];
  const sortChoices: [SortBy, string][] = [
    ['default', defaultSortLabel],
    ['date', 'Due date'],
    ['priority', 'Priority'],
    ['name', 'Name'],
    ['added', 'Date added'],
  ];
  // A choice that matches the page's default is the same thing; drop the duplicate row.
  const dedupe = <T extends string>(choices: [T, string][]) =>
    choices.filter(([value, label], i) => i === 0 || value === 'default' || label !== choices[0][1]);
  const customized = !isDefaultOptions(options);
  const layout = options.layout ?? 'list';
  const row = <T extends string>(
    selected: T,
    value: T,
    label: string,
    pick: (value: T) => void,
  ) => (
    <button
      key={value}
      type="button"
      role="menuitemradio"
      aria-checked={selected === value}
      className={`picker-row ${selected === value ? 'is-selected' : ''}`}
      onClick={() => pick(value)}
    >
      <span className="row-label">{label}</span>
      {selected === value && <Check size={14} className="row-check" />}
    </button>
  );
  return (
    <Popover
      align="right"
      trigger={({ onClick, open }) => (
        <button
          type="button"
          className={`icon-btn view-options-btn ${open ? 'is-open' : ''} ${customized ? 'is-customized' : ''}`}
          onClick={onClick}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={customized ? 'View options (customized)' : 'View options'}
          data-tooltip="Layout, group and sort"
        >
          <SlidersHorizontal size={16} />
        </button>
      )}
    >
      {(close) => (
        <div className="picker view-options" role="menu" aria-label="View options">
          <div className="picker-heading" role="presentation">Layout</div>
          <div className="segmented view-layout" role="radiogroup" aria-label="Layout">
            {(
              [
                ['list', 'List', <List key="l" size={14} />],
                ['board', 'Board', <Columns3 key="b" size={14} />],
              ] as const
            ).map(([value, label, icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={layout === value}
                className={`segmented-option ${layout === value ? 'is-selected' : ''}`}
                onClick={() => onChange({ ...options, layout: value })}
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="menu-sep" role="separator" />
          <div className="picker-heading" role="presentation">Group by</div>
          <div role="group" aria-label="Group by">
            {dedupe(groupChoices).map(([value, label]) =>
              row(options.groupBy, value, label, (groupBy) => onChange({ ...options, groupBy })),
            )}
          </div>
          <div className="menu-sep" role="separator" />
          <div className="picker-heading" role="presentation">Sort by</div>
          <div role="group" aria-label="Sort by">
            {dedupe(sortChoices).map(([value, label]) =>
              row(options.sortBy, value, label, (sortBy) => onChange({ ...options, sortBy })),
            )}
          </div>
          <div className="menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="picker-row"
            disabled={!customized}
            onClick={() => {
              onChange(DEFAULT_VIEW_OPTIONS);
              close();
            }}
          >
            <span className="row-label">Reset to defaults</span>
          </button>
        </div>
      )}
    </Popover>
  );
}

/** A section's task list doubles as a drop target so tasks can land in an empty section. */
function DroppableList({ groupKey, children }: { groupKey: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: DROP_PREFIX + groupKey });
  return (
    <AnimatedList innerRef={setNodeRef} className={`task-list is-droppable ${isOver ? 'is-over' : ''}`}>
      {children}
    </AnimatedList>
  );
}

export function TaskList({
  view,
  tasks,
  completedTasks,
  projects,
  sections,
  labels,
  onOpenTask,
  onDeleteTask,
  onCreateLabel,
  confirm,
}: TaskListProps) {
  const taskMut = useTaskMutations();
  const sectionMut = useSectionMutations();
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  // Collapsed groups (sections, day headings) are remembered per group key on this device.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(window.localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const toggleCollapsed = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        window.localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...next]));
      } catch {
        // Not persisted; fine.
      }
      return next;
    });

  // Drag state: group key -> ordered top-level task ids, only while a drag is in progress.
  const [dragItems, setDragItems] = useState<Record<string, string[]> | null>(null);
  const dragOrigin = useRef<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const today = todayStr();
  // The one task left for today (including overdue ones): completing it earns the small celebration.
  const dueNow = tasks.filter((t) => !t.isCompleted && t.dueDate !== null && t.dueDate <= today);
  const lastOpenToday = dueNow.length === 1 ? dueNow[0].id : null;
  const inbox = projects.find((p) => p.isInbox);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const childrenOf = (id: string) => sortByOrder(tasks.filter((t) => t.parentId === id));
  const title = viewTitle(view, projects, labels);
  const isProjectView = view.kind === 'project' || view.kind === 'inbox';
  // Inbox: every project's tasks grouped by project (sorted by due date), or one project picked in the filter.
  const inboxFilter = useInboxFilter(projects);
  const inboxAll = view.kind === 'inbox' && inboxFilter === 'all';
  const currentProjectId =
    view.kind === 'project' ? view.projectId : view.kind === 'inbox' ? (inboxAll ? inbox?.id : inboxFilter) : undefined;
  const showProject = !isProjectView;

  const editorProps = { projects, sections, labels, onCreateLabel };

  // Google Calendar events for the coming week, shown under each day heading in Today and Upcoming.
  const weekEnd = toDateStr(addDays(new Date(), 7));
  const externalEvents = useCalendarEvents(today, weekEnd, view.kind === 'today' || view.kind === 'upcoming');
  const eventsFor = (day: string): ExternalEvent[] =>
    (externalEvents.data ?? []).filter((e) => e.date <= day && day <= e.endDate);

  // "Plan my day": slot today's untimed and overdue tasks into the free gaps between meetings.
  const [planning, setPlanning] = useState(false);
  const planToday = async () => {
    setPlanning(true);
    try {
      const { placed, unplaced } = planDay({ date: today, tasks, events: eventsFor(today) });
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

  const sectionsOf = (projectId: string) =>
    sections
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));

  /**
   * One project's page: loose tasks, then its sections, in manual (draggable) order. The Inbox filtered to one
   * project sorts by due date instead, like its "All projects" listing.
   */
  const projectGroups = (byDue = false): Group[] => {
    const sortTasks = byDue ? sortForAgenda : sortByOrder;
    if (!currentProjectId) return [];
    const inProject = tasks.filter((t) => t.projectId === currentProjectId && !t.parentId);
    const projectSections = sectionsOf(currentProjectId);
    const sectionIds = new Set(projectSections.map((s) => s.id));
    const groups: Group[] = [
      {
        key: NO_SECTION_KEY,
        title: null,
        tasks: sortTasks(inProject.filter((t) => !t.sectionId || !sectionIds.has(t.sectionId))),
        defaults: { projectId: currentProjectId },
        nested: true,
        sortable: !byDue,
        emptyText: projectSections.length === 0 ? 'No tasks here yet.' : undefined,
      },
    ];
    for (const section of projectSections) {
      groups.push({
        key: section.id,
        title: section.name,
        tasks: sortTasks(inProject.filter((t) => t.sectionId === section.id)),
        defaults: { projectId: currentProjectId, sectionId: section.id },
        section,
        nested: true,
        sortable: !byDue,
      });
    }
    return groups;
  };

  /**
   * Inbox with "All projects": a fixed group per project (the Inbox first, then sidebar order; empty projects
   * are left out), each sorted soonest due first. The Inbox's own sections follow its group as usual.
   */
  const allProjectGroups = (): Group[] => {
    const topLevel = tasks.filter((t) => !t.parentId);
    const ordered = [...projects].sort((a, b) => Number(b.isInbox) - Number(a.isInbox) || a.order - b.order);
    const groups: Group[] = [];
    for (const project of ordered) {
      const own = topLevel.filter((t) => t.projectId === project.id);
      const projectGroup = (groupTasks: Task[]): Group => ({
        key: `project:${project.id}`,
        title: project.name,
        icon: <ProjectIcon project={project} />,
        tasks: sortForAgenda(groupTasks),
        defaults: { projectId: project.id },
        nested: true,
      });
      if (!project.isInbox) {
        if (own.length > 0) groups.push(projectGroup(own));
        continue;
      }
      const inboxSections = sectionsOf(project.id);
      const sectionIds = new Set(inboxSections.map((s) => s.id));
      groups.push({
        ...projectGroup(own.filter((t) => !t.sectionId || !sectionIds.has(t.sectionId))),
        emptyText: topLevel.length === 0 ? 'No tasks here yet.' : undefined,
      });
      for (const section of inboxSections) {
        groups.push({
          key: section.id,
          title: section.name,
          tasks: sortForAgenda(own.filter((t) => t.sectionId === section.id)),
          defaults: { projectId: project.id, sectionId: section.id },
          section,
          nested: true,
        });
      }
    }
    return groups;
  };

  const buildGroups = (): Group[] => {
    switch (view.kind) {
      case 'inbox':
        return inboxAll ? allProjectGroups() : projectGroups(true);
      case 'project':
        return projectGroups();
      case 'today': {
        const overdue = sortForAgenda(tasks.filter((t) => isOverdue(t, today)));
        const dueToday = sortForAgenda(tasks.filter((t) => t.dueDate === today));
        const groups: Group[] = [];
        if (overdue.length > 0) {
          groups.push({ key: 'overdue', title: 'Overdue', tasks: overdue, defaults: null, nested: false, isOverdue: true });
        }
        groups.push({
          key: 'today',
          title: overdue.length > 0 ? describeDayHeading(today) : null,
          tasks: dueToday,
          defaults: { projectId: inbox?.id, dueDate: today },
          nested: false,
          events: eventsFor(today),
          emptyText: 'Nothing due today. Add a task or enjoy the calm.',
        });
        return groups;
      }
      case 'upcoming': {
        const groups: Group[] = [];
        const overdue = sortForAgenda(tasks.filter((t) => isOverdue(t, today)));
        if (overdue.length > 0) {
          groups.push({ key: 'overdue', title: 'Overdue', tasks: overdue, defaults: null, nested: false, isOverdue: true });
        }
        for (let i = 0; i < 7; i++) {
          const day = toDateStr(addDays(new Date(), i));
          groups.push({
            key: day,
            title: describeDayHeading(day),
            tasks: sortForAgenda(tasks.filter((t) => t.dueDate === day)),
            defaults: { projectId: inbox?.id, dueDate: day },
            nested: false,
            events: eventsFor(day),
          });
        }
        const lastDay = toDateStr(addDays(new Date(), 6));
        const later = sortForAgenda(tasks.filter((t) => t.dueDate !== null && t.dueDate > lastDay));
        if (later.length > 0) {
          groups.push({ key: 'later', title: 'Later', tasks: later, defaults: null, nested: false });
        }
        return groups;
      }
      case 'label':
        return [
          {
            key: 'label',
            title: null,
            tasks: sortForAgenda(tasks.filter((t) => t.labelIds.includes(view.labelId))),
            defaults: { projectId: inbox?.id, labelIds: [view.labelId] },
            nested: false,
            emptyText: 'No tasks with this label.',
          },
        ];
      case 'search':
        return [
          {
            key: 'search',
            title: null,
            tasks: sortForAgenda(tasks.filter((t) => matchesSearch(t, view.query))),
            defaults: null,
            nested: false,
            emptyText: 'No tasks match your search.',
          },
        ];
      default:
        return [];
    }
  };

  // ----- View options (group by / sort by), remembered per page -----

  const optionsKey = viewOptionsKey(view);
  const viewOptions = useViewOptions(optionsKey);
  const defaultGroupLabel =
    view.kind === 'project' ? 'Sections'
    : view.kind === 'inbox' ? (inboxAll ? 'Projects' : 'Sections')
    : view.kind === 'today' || view.kind === 'upcoming' ? 'Days'
    : 'None';
  const defaultSortLabel = view.kind === 'project' ? 'Manual' : 'Due date';
  // Grouping by project is the Inbox's own default and meaningless on a single project's page.
  const showProjectGrouping = view.kind !== 'project' && view.kind !== 'inbox';

  /** Re-buckets the page's tasks by the chosen field; "Add task" in a bucket pre-fills that field. */
  const regroup = (base: Group[], groupBy: Exclude<GroupBy, 'default'>): Group[] => {
    const seen = new Set<string>();
    const all = base.flatMap((g) => g.tasks).filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
    const nested = base.some((g) => g.nested);
    const firstDefaults = base.find((g) => g.defaults)?.defaults ?? null;
    // A bucket is not a section, so new tasks land outside sections.
    const baseDefaults = firstDefaults ? { ...firstDefaults, sectionId: undefined } : null;
    const withDefaults = (extra: Partial<TaskInput>) => (baseDefaults ? { ...baseDefaults, ...extra } : null);
    const emptyText = base.find((g) => g.emptyText)?.emptyText ?? 'No tasks here yet.';
    const showsEvents = view.kind === 'today' || view.kind === 'upcoming';

    let groups: Group[] = [];
    switch (groupBy) {
      case 'none':
        groups = [{ key: 'all', title: null, tasks: sortForAgenda(all), defaults: baseDefaults, nested }];
        break;
      case 'project': {
        const ordered = [...projects].sort((a, b) => Number(b.isInbox) - Number(a.isInbox) || a.order - b.order);
        groups = ordered.map((project) => ({
          key: `by-project:${project.id}`,
          title: project.name,
          icon: <ProjectIcon project={project} />,
          tasks: sortForAgenda(all.filter((t) => t.projectId === project.id)),
          defaults: withDefaults({ projectId: project.id }),
          nested,
        }));
        break;
      }
      case 'date': {
        const overdue = all.filter((t) => isOverdue(t, today));
        if (overdue.length > 0) {
          groups.push({ key: 'overdue', title: 'Overdue', tasks: sortForAgenda(overdue), defaults: null, nested, isOverdue: true });
        }
        const days = [...new Set(all.map((t) => t.dueDate).filter((d): d is string => d !== null && d >= today))].sort();
        for (const day of days) {
          groups.push({
            key: `by-date:${day}`,
            title: describeDayHeading(day),
            icon: <CalendarDays size={14} className="group-icon" />,
            tasks: sortForAgenda(all.filter((t) => t.dueDate === day)),
            defaults: withDefaults({ dueDate: day }),
            nested,
            events: showsEvents ? eventsFor(day) : undefined,
          });
        }
        groups.push({
          key: 'by-date:none',
          title: 'No date',
          tasks: sortForAgenda(all.filter((t) => t.dueDate === null)),
          defaults: withDefaults({ dueDate: null }),
          nested,
        });
        break;
      }
      case 'priority':
        groups = ([1, 2, 3, 4] as Priority[]).map((p) => ({
          key: `by-priority:${p}`,
          title: PRIORITY_META[p].label,
          icon: <Flag size={14} color={PRIORITY_META[p].hex} fill={p < 4 ? PRIORITY_META[p].hex : 'none'} />,
          tasks: sortForAgenda(all.filter((t) => t.priority === p)),
          defaults: withDefaults({ priority: p }),
          nested,
        }));
        break;
      case 'label': {
        // A task with several labels shows under each of them.
        const ordered = [...labels].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
        groups = ordered.map((label) => ({
          key: `by-label:${label.id}`,
          title: label.name,
          icon: <Tag size={14} color={colorHex(label.color)} />,
          tasks: sortForAgenda(all.filter((t) => t.labelIds.includes(label.id))),
          defaults: withDefaults({ labelIds: [...new Set([...(baseDefaults?.labelIds ?? []), label.id])] }),
          nested,
        }));
        groups.push({
          key: 'by-label:none',
          title: 'No label',
          tasks: sortForAgenda(all.filter((t) => t.labelIds.length === 0)),
          defaults: baseDefaults,
          nested,
        });
        break;
      }
    }
    // On a board every priority and project keeps its column, even when empty, so cards can be moved into it.
    const keepEmpty = (viewOptions.layout ?? 'list') === 'board' && (groupBy === 'priority' || groupBy === 'project');
    const nonEmpty = groups.filter((g) => g.tasks.length > 0 || keepEmpty);
    return nonEmpty.length > 0
      ? nonEmpty
      : [{ key: 'all', title: null, tasks: [], defaults: baseDefaults, nested, emptyText }];
  };

  const arrangeGroups = (): Group[] => {
    let groups = buildGroups();
    if (viewOptions.groupBy !== 'default') groups = regroup(groups, viewOptions.groupBy);
    const sortBy = viewOptions.sortBy;
    // Any explicit sort replaces manual order, so dragging is off until it is reset.
    if (sortBy !== 'default') groups = groups.map((g) => ({ ...g, tasks: sortTasks(g.tasks, sortBy), sortable: false }));
    return groups;
  };

  const rescheduleOverdue = async () => {
    const overdue = tasks.filter((t) => isOverdue(t, today));
    await taskMut.updateMany(
      `rescheduled ${overdue.length} overdue task${overdue.length === 1 ? '' : 's'} to today`,
      overdue.map((t) => ({ task: t, input: { ...taskToInput(t), dueDate: today } })),
    );
  };

  const deleteSection = async (section: Section) => {
    const ok = await confirm({
      title: `Delete section “${section.name}”?`,
      message: 'Tasks in this section are kept and moved out of the section.',
    });
    if (ok) sectionMut.remove.mutate(section.id);
  };

  // ----- Drag and drop (project views only) -----

  const containerOf = (items: Record<string, string[]>, id: string) =>
    Object.keys(items).find((key) => items[key].includes(id));

  const resolveContainer = (items: Record<string, string[]>, overId: string) =>
    overId.startsWith(DROP_PREFIX) ? overId.slice(DROP_PREFIX.length) : containerOf(items, overId);

  const onDragStart = (event: DragStartEvent) => {
    setDragging(true);
    const snapshot = Object.fromEntries(groups.map((g) => [g.key, g.tasks.map((t) => t.id)]));
    dragOrigin.current = containerOf(snapshot, String(event.active.id)) ?? null;
    setDragItems(snapshot);
  };

  // Move the dragged id into whichever group it hovers so the preview shows where it will land.
  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!dragItems || !over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const from = containerOf(dragItems, activeId);
    const to = resolveContainer(dragItems, overId);
    if (!from || !to || from === to) return;

    const fromList = dragItems[from].filter((id) => id !== activeId);
    const toList = [...dragItems[to]];
    const overIndex = toList.indexOf(overId);
    toList.splice(overIndex >= 0 ? overIndex : toList.length, 0, activeId);
    setDragItems({ ...dragItems, [from]: fromList, [to]: toList });
  };

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(false);
    const { active, over } = event;
    const items = dragItems;
    const origin = dragOrigin.current;
    setDragItems(null);
    dragOrigin.current = null;
    if (!items || !over || !origin) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const current = containerOf(items, activeId);
    const target = resolveContainer(items, overId) ?? current;
    if (!current || !target) return;

    let targetList = [...items[target]];
    if (current === target) {
      const oldIndex = targetList.indexOf(activeId);
      const newIndex = overId === activeId || overId.startsWith(DROP_PREFIX) ? oldIndex : targetList.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) return;
      targetList = arrayMove(targetList, oldIndex, newIndex);
    } else {
      // Should not happen after onDragOver, but keep the drop sane if it does.
      targetList = targetList.filter((id) => id !== activeId);
      const overIndex = targetList.indexOf(overId);
      targetList.splice(overIndex >= 0 ? overIndex : targetList.length, 0, activeId);
    }

    const finalLists: Record<string, string[]> = { ...items, [target]: targetList };
    if (current !== target) finalLists[current] = items[current].filter((id) => id !== activeId);

    const touched = new Set([origin, current, target]);
    const unchanged = [...touched].every((key) => {
      const before = groups.find((g) => g.key === key)?.tasks.map((t) => t.id) ?? [];
      const after = finalLists[key] ?? [];
      return before.length === after.length && before.every((id, i) => id === after[i]);
    });
    if (unchanged) return;

    persistOrder(finalLists, [...touched]);
  };

  const persistOrder = (lists: Record<string, string[]>, keys: string[]) => {
    const sectionFor = (key: string) => (key === NO_SECTION_KEY ? null : key);
    const updates = new Map<string, { order: number; sectionId: string | null }>();
    for (const key of keys) {
      (lists[key] ?? []).forEach((id, index) => {
        updates.set(id, { order: index, sectionId: sectionFor(key) });
        // Subtasks keep their own order but follow the parent into its section.
        for (const child of childrenOf(id)) {
          if (child.sectionId !== sectionFor(key)) updates.set(child.id, { order: child.order, sectionId: sectionFor(key) });
        }
      });
    }
    const items: ReorderItem[] = [...updates].map(([id, u]) => ({ id, order: u.order, sectionId: u.sectionId ?? '' }));

    // The reorder hook moves the rows in the cache at once, so the list stays where the user dropped it.
    taskMut.reorder.mutate(items);
  };

  const renderTask = (task: Task, nested: boolean, sortable: boolean) => {
    const kids = childrenOf(task.id);
    const props = {
      task,
      project: projectById.get(task.projectId),
      labels,
      showProject,
      childCount: kids.length,
      onToggle: () => taskMut.complete.mutate(task.id),
      celebrate: task.id === lastOpenToday,
      onOpen: () => onOpenTask(task.id),
      onDelete: () => onDeleteTask(task),
    };
    const nestedList =
      nested && kids.length > 0 ? (
        <AnimatedList className="task-list task-list-nested">{kids.map((k) => renderTask(k, true, false))}</AnimatedList>
      ) : null;
    return sortable ? (
      <SortableTask key={task.id} {...props}>
        {nestedList}
      </SortableTask>
    ) : (
      <TaskItem key={task.id} {...props}>
        {nestedList}
      </TaskItem>
    );
  };

  if (view.kind === 'completed') {
    return (
      <div className="view">
        <header className="view-header">
          <h1>{title}</h1>
          <p className="muted">Most recent first. Tick a task to bring it back.</p>
        </header>
        {completedTasks.length === 0 ? (
          <p className="empty">Nothing completed yet.</p>
        ) : (
          <AnimatedList className="task-list">
            {completedTasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                project={projectById.get(task.projectId)}
                labels={labels}
                showProject
                completed
                onToggle={() => taskMut.reopen.mutate(task.id)}
                onOpen={() => onOpenTask(task.id)}
                onDelete={() => onDeleteTask(task)}
              />
            ))}
          </AnimatedList>
        )}
      </div>
    );
  }

  const groups = arrangeGroups();
  const subtitle = view.kind === 'today' ? format(new Date(), 'EEEE d MMMM') : null;
  const totalShown = groups.reduce((n, g) => n + g.tasks.length, 0);

  const renderAdd = (group: Group) =>
    group.defaults ? (
      addingIn === group.key ? (
        <TaskEditor
          mode="create"
          defaults={group.defaults}
          {...editorProps}
          keepOpenAfterSubmit
          onSubmit={(input) => taskMut.create.mutateAsync(input)}
          onCancel={() => setAddingIn(null)}
        />
      ) : (
        <button type="button" className="add-task-btn" onClick={() => setAddingIn(group.key)}>
          <Plus size={16} />
          <span>Add task</span>
        </button>
      )
    ) : null;

  // ----- Board layout: one column per group -----

  const isBoard = (viewOptions.layout ?? 'list') === 'board';

  /** What dropping a card in this column sets; null when the column cannot take cards (Overdue, Later, labels). */
  const dropChange = (group: Group): Partial<TaskInput> | null => {
    if (group.isOverdue) return null;
    if (group.section) return { projectId: group.section.projectId, sectionId: group.section.id };
    const key = group.key;
    if (key === NO_SECTION_KEY) return { sectionId: null };
    let m: RegExpExecArray | null;
    if ((m = /^(?:by-)?project:(.+)$/.exec(key))) return { projectId: m[1], sectionId: null };
    if ((m = /^by-priority:([1-4])$/.exec(key))) return { priority: Number(m[1]) as Priority };
    if (key === 'by-date:none') return { dueDate: null, startDate: '' };
    if ((m = /^by-date:(\d{4}-\d{2}-\d{2})$/.exec(key))) return { dueDate: m[1] };
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return { dueDate: key };
    if (key === 'today') return { dueDate: today };
    return null;
  };

  const columnTitle = (group: Group) =>
    group.title ?? (view.kind === 'today' ? 'Today' : view.kind === 'project' || view.kind === 'inbox' ? 'No section' : title);

  const boardColumns: BoardColumn[] = isBoard
    ? groups.map((group) => ({
        key: group.key,
        title: columnTitle(group),
        icon: group.icon,
        tasks: group.tasks,
        accepts: dropChange(group) !== null,
        emptyText: group.emptyText,
      }))
    : [];

  /** Drop or "Move to…": set the column's field; sub-tasks follow their parent to another project or section. */
  const moveToColumn = (task: Task, column: BoardColumn) => {
    const group = groups.find((g) => g.key === column.key);
    const change = group ? dropChange(group) : null;
    if (!change) return;
    const changes = [{ task, input: { ...taskToInput(task), ...change } }];
    if ('projectId' in change || 'sectionId' in change) {
      for (const child of childrenOf(task.id)) {
        changes.push({
          task: child,
          input: {
            ...taskToInput(child),
            projectId: change.projectId ?? child.projectId,
            sectionId: change.sectionId === undefined ? child.sectionId : change.sectionId,
          },
        });
      }
    }
    void taskMut.updateMany(`moved “${task.content}” to ${column.title}`, changes);
  };

  const renderGroupTasks = (group: Group) => {
    if (!isProjectView || !group.sortable) {
      return <AnimatedList className="task-list">{group.tasks.map((task) => renderTask(task, group.nested, false))}</AnimatedList>;
    }
    // While dragging, follow the in-flight order instead of the server order.
    const ids = dragItems?.[group.key] ?? group.tasks.map((t) => t.id);
    const ordered = ids.map((id) => taskById.get(id)).filter((t): t is Task => t !== undefined);
    return (
      <SortableContext id={group.key} items={ids} strategy={verticalListSortingStrategy}>
        <DroppableList groupKey={group.key}>{ordered.map((task) => renderTask(task, true, true))}</DroppableList>
      </SortableContext>
    );
  };

  const content = (
    <div className={`view ${isBoard ? 'is-board' : ''}`}>
      <header className="view-header">
        <div className="view-header-row">
          <h1>{title}</h1>
          {view.kind === 'inbox' && <InboxFilterPicker projects={projects} tasks={tasks} filter={inboxFilter} />}
          {view.kind === 'today' && (
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
          <ViewOptionsMenu
            options={viewOptions}
            onChange={(options) => setViewOptions(optionsKey, options)}
            defaultGroupLabel={defaultGroupLabel}
            defaultSortLabel={defaultSortLabel}
            showProjectGrouping={showProjectGrouping}
          />
        </div>
        {subtitle && <p className="muted">{subtitle}</p>}
        {view.kind === 'search' && <p className="muted">{totalShown} result{totalShown === 1 ? '' : 's'}</p>}
      </header>

      {isBoard ? (
        <BoardView
          columns={boardColumns}
          renderCard={(task) => renderTask(task, false, false)}
          renderAdd={(column) => {
            const group = groups.find((g) => g.key === column.key);
            return group ? renderAdd(group) : null;
          }}
          onMove={moveToColumn}
        />
      ) : groups.map((group) => (
        <section key={group.key} className="task-group">
          {group.isOverdue ? (
            <div className="group-header">
              <h2 className="overdue-title">Overdue</h2>
              <button type="button" className="link-btn" onClick={() => void rescheduleOverdue()}>
                Reschedule to today
              </button>
            </div>
          ) : group.section ? (
            <div className="group-header section-header">
              {renaming?.id === group.section.id ? (
                <form
                  className="inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const name = renaming.name.trim();
                    if (name && group.section) {
                      sectionMut.update.mutate({
                        id: group.section.id,
                        input: { projectId: group.section.projectId, name, order: group.section.order },
                      });
                    }
                    setRenaming(null);
                  }}
                >
                  <input
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: renaming.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    autoFocus
                    aria-label="Section name"
                  />
                  <button type="submit" className="icon-btn" aria-label="Save">
                    <Check size={16} />
                  </button>
                  <button type="button" className="icon-btn" aria-label="Cancel" onClick={() => setRenaming(null)}>
                    <X size={16} />
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="group-toggle"
                    onClick={() => toggleCollapsed(group.key)}
                    aria-expanded={!collapsed.has(group.key)}
                    aria-label={`${collapsed.has(group.key) ? 'Expand' : 'Collapse'} ${group.title}`}
                  >
                    <ChevronDown size={16} className={`group-chevron ${collapsed.has(group.key) ? 'is-collapsed' : ''}`} />
                    <h2>{group.title}</h2>
                  </button>
                  <span className="muted count">{group.tasks.length || ''}</span>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="icon-btn hover-only"
                    data-tooltip="Rename section"
                    aria-label="Rename section"
                    onClick={() => group.section && setRenaming({ id: group.section.id, name: group.section.name })}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn hover-only"
                    data-tooltip="Delete section"
                    aria-label="Delete section"
                    onClick={() => group.section && void deleteSection(group.section)}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          ) : group.title ? (
            <div className="group-header">
              <button
                type="button"
                className="group-toggle"
                onClick={() => toggleCollapsed(group.key)}
                aria-expanded={!collapsed.has(group.key)}
                aria-label={`${collapsed.has(group.key) ? 'Expand' : 'Collapse'} ${group.title}`}
              >
                <ChevronDown size={16} className={`group-chevron ${collapsed.has(group.key) ? 'is-collapsed' : ''}`} />
                {group.icon}
                <h2>{group.title}</h2>
              </button>
              <span className="muted count">{group.tasks.length || ''}</span>
            </div>
          ) : null}

          {collapsed.has(group.key) && group.title ? null : (
            <>

          {group.events && group.events.length > 0 && (
            <ul className="event-list" aria-label="Calendar events">
              {group.events.map((event) => (
                <li key={`${event.calendarId}-${event.id}`}>
                  <button
                    type="button"
                    className="event-row"
                    data-tooltip={`${event.title} · ${event.calendarName}${event.location ? ` · ${event.location}` : ''}`}
                    onClick={() => {
                      if (!event.htmlLink) return;
                      if (window.mytodoease?.openExternal) void window.mytodoease.openExternal(event.htmlLink);
                      else window.open(event.htmlLink, '_blank', 'noopener');
                    }}
                  >
                    <span className="dot" style={{ background: event.color ?? 'var(--text-muted)' }} />
                    <span className="event-row-time">
                      {event.allDay ? 'All day' : `${formatTime(event.startTime!)}${event.endTime ? ` – ${formatTime(event.endTime)}` : ''}`}
                    </span>
                    <span className="event-row-title">{event.title}</span>
                    <span className="event-row-cal muted">{event.calendarName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {renderGroupTasks(group)}

          {group.tasks.length === 0 && group.emptyText && addingIn !== group.key && !dragItems && (
            <p className="empty">{group.emptyText}</p>
          )}

          {renderAdd(group)}
            </>
          )}
        </section>
      ))}

      {isProjectView && currentProjectId && (
        <div className="add-section">
          {addingSection ? (
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                const name = newSectionName.trim();
                if (name) sectionMut.create.mutate({ projectId: currentProjectId, name });
                setNewSectionName('');
                setAddingSection(false);
              }}
            >
              <input
                placeholder="Section name"
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setAddingSection(false);
                }}
                autoFocus
                aria-label="Section name"
              />
              <button type="submit" className="btn btn-primary" disabled={!newSectionName.trim()}>
                Add section
              </button>
              <button type="button" className="btn" onClick={() => setAddingSection(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" className="add-section-btn" onClick={() => setAddingSection(true)}>
              <MoreHorizontal size={14} />
              <span>Add section</span>
            </button>
          )}
        </div>
      )}
    </div>
  );

  // The board runs its own drag and drop; the list's sortable context is for the list layout only.
  if (!isProjectView || isBoard) return content;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragging(false);
        setDragItems(null);
        dragOrigin.current = null;
      }}
    >
      {content}
    </DndContext>
  );
}
