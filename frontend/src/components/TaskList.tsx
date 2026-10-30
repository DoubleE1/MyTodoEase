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
import { useQueryClient } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { useCalendarEvents } from '../api/hooks';
import { planDay } from '../lib/plan';
import { showToast } from '../lib/toast';
import type { ExternalEvent } from '../api/types';
import { Check, ChevronDown, GripVertical, MoreHorizontal, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { queryKeys, useSectionMutations, useTaskMutations } from '../api/hooks';
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
  const queryClient = useQueryClient();
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
  const currentProjectId = view.kind === 'project' ? view.projectId : view.kind === 'inbox' ? inbox?.id : undefined;
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

  const buildGroups = (): Group[] => {
    switch (view.kind) {
      case 'inbox':
      case 'project': {
        if (!currentProjectId) return [];
        const inProject = tasks.filter((t) => t.projectId === currentProjectId && !t.parentId);
        const projectSections = sections
          .filter((s) => s.projectId === currentProjectId)
          .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
        const sectionIds = new Set(projectSections.map((s) => s.id));
        const groups: Group[] = [
          {
            key: NO_SECTION_KEY,
            title: null,
            tasks: sortByOrder(inProject.filter((t) => !t.sectionId || !sectionIds.has(t.sectionId))),
            defaults: { projectId: currentProjectId },
            nested: true,
            emptyText: projectSections.length === 0 ? 'No tasks here yet.' : undefined,
          },
        ];
        for (const section of projectSections) {
          groups.push({
            key: section.id,
            title: section.name,
            tasks: sortByOrder(inProject.filter((t) => t.sectionId === section.id)),
            defaults: { projectId: currentProjectId, sectionId: section.id },
            section,
            nested: true,
          });
        }
        return groups;
      }
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

  const rescheduleOverdue = async () => {
    const overdue = tasks.filter((t) => isOverdue(t, today));
    await Promise.all(
      overdue.map((t) => taskMut.update.mutateAsync({ id: t.id, input: { ...taskToInput(t), dueDate: today } })),
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

    // Optimistic: the list stays where the user dropped it while the API catches up.
    queryClient.setQueryData<Task[]>(queryKeys.tasks, (old) =>
      old?.map((t) => (updates.has(t.id) ? { ...t, ...updates.get(t.id)! } : t)),
    );
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

  const groups = buildGroups();
  const subtitle = view.kind === 'today' ? format(new Date(), 'EEEE d MMMM') : null;
  const totalShown = groups.reduce((n, g) => n + g.tasks.length, 0);

  const renderGroupTasks = (group: Group) => {
    if (!isProjectView) {
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
    <div className="view">
      <header className="view-header">
        <div className="view-header-row">
          <h1>{title}</h1>
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
        </div>
        {subtitle && <p className="muted">{subtitle}</p>}
        {view.kind === 'search' && <p className="muted">{totalShown} result{totalShown === 1 ? '' : 's'}</p>}
      </header>

      {groups.map((group) => (
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

          {group.defaults &&
            (addingIn === group.key ? (
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
            ))}
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

  if (!isProjectView) return content;

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
