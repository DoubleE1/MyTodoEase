import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from './api/client';
import {
  useActiveTasks,
  useCompletedTasks,
  useLabelMutations,
  useLabels,
  useProjectMutations,
  useProjects,
  useSectionMutations,
  useSections,
  useTaskMutations,
} from './api/hooks';
import type { Label, Project, Task } from './api/types';
import { CalendarView } from './components/CalendarView';
import { CompactView } from './components/CompactView';
import { ConfirmDialog, LabelDialog, Modal, ProjectDialog, type ConfirmOptions } from './components/Dialogs';
import { Sidebar } from './components/Sidebar';
import { TaskDetail } from './components/TaskDetail';
import { TaskEditor } from './components/TaskEditor';
import { TaskList } from './components/TaskList';
import { TitleBar } from './components/TitleBar';
import { Toasts } from './components/Toasts';
import { todayStr } from './lib/dates';
import { useWindowMode } from './lib/desktop';
import { useTheme } from './lib/theme';
import type { View } from './lib/views';

type Dialog =
  | { kind: 'project'; project?: Project }
  | { kind: 'label'; label?: Label }
  | { kind: 'quick-add'; dueDate?: string }
  | null;

/** Promise-based confirm so callers can `await confirm(...)` and the UI stays a plain modal. */
function useConfirm() {
  const [pending, setPending] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);
  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ options, resolve })),
    [],
  );
  const element = pending ? (
    <ConfirmDialog
      options={pending.options}
      onResolve={(ok) => {
        pending.resolve(ok);
        setPending(null);
      }}
    />
  ) : null;
  return { confirm, element };
}

export default function App() {
  const queryClient = useQueryClient();
  const projects = useProjects();
  const sections = useSections();
  const labels = useLabels();
  const tasks = useActiveTasks();

  const [view, setView] = useState<View>({ kind: 'today' });
  const [search, setSearch] = useState('');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const { confirm, element: confirmElement } = useConfirm();
  const theme = useTheme();
  const windowMode = useWindowMode();

  const completed = useCompletedTasks(view.kind === 'completed' || openTaskId !== null);
  const taskMut = useTaskMutations();
  const projectMut = useProjectMutations();
  const labelMut = useLabelMutations();
  // Sections are mutated inside TaskList; the hook is referenced here only to keep the cache keys warm.
  useSectionMutations();

  const effectiveView: View = useMemo(
    () => (search.trim() ? { kind: 'search', query: search.trim() } : view),
    [search, view],
  );

  // "q" opens quick add from anywhere, as in Todoist, unless the user is typing or a dialog is open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing || dialog || openTaskId) return;
      if (event.key === 'q' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setDialog({ kind: 'quick-add' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialog, openTaskId]);

  const createLabel = useCallback((name: string) => labelMut.create.mutateAsync({ name }), [labelMut.create]);

  const deleteTask = useCallback(
    async (task: Task) => {
      const ok = await confirm({
        title: 'Delete task?',
        message: `“${task.content}” and its sub-tasks will be permanently deleted.`,
      });
      if (!ok) return;
      if (openTaskId === task.id) setOpenTaskId(null);
      taskMut.remove.mutate(task.id);
    },
    [confirm, openTaskId, taskMut.remove],
  );

  const deleteProject = async (project: Project) => {
    const ok = await confirm({
      title: `Delete project “${project.name}”?`,
      message: 'All tasks and sections in this project will be permanently deleted.',
    });
    if (!ok) return;
    if (view.kind === 'project' && view.projectId === project.id) setView({ kind: 'inbox' });
    projectMut.remove.mutate(project.id);
  };

  const deleteLabel = async (label: Label) => {
    const ok = await confirm({
      title: `Delete label “${label.name}”?`,
      message: 'The label is removed from all tasks. Tasks themselves are kept.',
    });
    if (!ok) return;
    if (view.kind === 'label' && view.labelId === label.id) setView({ kind: 'today' });
    labelMut.remove.mutate(label.id);
  };

  const closeDetail = useCallback(() => setOpenTaskId(null), []);
  const closeDialog = useCallback(() => setDialog(null), []);

  const loading = projects.isLoading || sections.isLoading || labels.isLoading || tasks.isLoading;
  const loadError = projects.error ?? sections.error ?? labels.error ?? tasks.error;
  const inbox = projects.data?.find((p) => p.isInbox);

  const quickAddDefaults = {
    projectId: view.kind === 'project' ? view.projectId : inbox?.id,
    dueDate:
      dialog?.kind === 'quick-add' && dialog.dueDate ? dialog.dueDate : view.kind === 'today' ? todayStr() : undefined,
    labelIds: view.kind === 'label' ? [view.labelId] : undefined,
  };

  const titleBar = windowMode.isDesktop ? (
    <TitleBar
      compact={windowMode.compact}
      alwaysOnTop={windowMode.alwaysOnTop}
      onTogglePin={() => void windowMode.setAlwaysOnTop(!windowMode.alwaysOnTop)}
      onToggleCompact={() => void windowMode.setCompact(!windowMode.compact)}
    />
  ) : null;
  const shellClass = windowMode.isDesktop ? 'has-titlebar' : '';

  const overlays = (
    <>
      {dialog?.kind === 'quick-add' && inbox && (
        <Modal title="Add task" onClose={closeDialog}>
          <TaskEditor
            mode="create"
            defaults={quickAddDefaults}
            projects={projects.data ?? []}
            sections={sections.data ?? []}
            labels={labels.data ?? []}
            onCreateLabel={createLabel}
            onSubmit={async (input) => {
              await taskMut.create.mutateAsync(input);
              closeDialog();
            }}
            onCancel={closeDialog}
          />
        </Modal>
      )}

      {dialog?.kind === 'project' && (
        <ProjectDialog
          project={dialog.project}
          onClose={closeDialog}
          onSave={(input) =>
            dialog.project
              ? projectMut.update.mutateAsync({ id: dialog.project.id, input })
              : projectMut.create.mutateAsync(input).then((created) => {
                  setView({ kind: 'project', projectId: created.id });
                })
          }
        />
      )}

      {dialog?.kind === 'label' && (
        <LabelDialog
          label={dialog.label}
          onClose={closeDialog}
          onSave={(input) =>
            dialog.label ? labelMut.update.mutateAsync({ id: dialog.label.id, input }) : labelMut.create.mutateAsync(input)
          }
        />
      )}

      {openTaskId && (
        <TaskDetail
          taskId={openTaskId}
          tasks={tasks.data ?? []}
          completedTasks={completed.data ?? []}
          projects={projects.data ?? []}
          sections={sections.data ?? []}
          labels={labels.data ?? []}
          onClose={closeDetail}
          onOpenTask={setOpenTaskId}
          onDeleteTask={(task) => void deleteTask(task)}
          onCreateLabel={createLabel}
        />
      )}

      {confirmElement}
      <Toasts />
    </>
  );

  if (windowMode.compact) {
    return (
      <div className={`app app-compact ${shellClass}`}>
        {titleBar}
        {loadError ? (
          <div className="banner banner-error">
            <div>
              <strong>Could not load your tasks.</strong>
              <div className="small">{loadError instanceof Error ? loadError.message : String(loadError)}</div>
            </div>
            <button type="button" className="btn" onClick={() => void queryClient.invalidateQueries()}>
              <RefreshCw size={14} />
              <span>Retry</span>
            </button>
          </div>
        ) : loading ? (
          <div className="loading">Loading…</div>
        ) : (
          <CompactView
            tasks={tasks.data ?? []}
            projects={projects.data ?? []}
            sections={sections.data ?? []}
            labels={labels.data ?? []}
            showExpand={!windowMode.isDesktop}
            onExpand={() => void windowMode.setCompact(false)}
            onOpenTask={setOpenTaskId}
            onDeleteTask={(task) => void deleteTask(task)}
            onCreateLabel={createLabel}
          />
        )}
        {overlays}
      </div>
    );
  }

  return (
    <div className={`app ${shellClass}`}>
      {titleBar}
      <Sidebar
        view={effectiveView}
        onSelectView={(next) => {
          setSearch('');
          setView(next);
        }}
        projects={projects.data ?? []}
        labels={labels.data ?? []}
        tasks={tasks.data ?? []}
        search={search}
        onSearch={setSearch}
        onAddTask={() => setDialog({ kind: 'quick-add' })}
        onAddProject={() => setDialog({ kind: 'project' })}
        onEditProject={(project) => setDialog({ kind: 'project', project })}
        onDeleteProject={(project) => void deleteProject(project)}
        onAddLabel={() => setDialog({ kind: 'label' })}
        onEditLabel={(label) => setDialog({ kind: 'label', label })}
        onDeleteLabel={(label) => void deleteLabel(label)}
        themePreference={theme.preference}
        onCycleTheme={theme.cycle}
        showCompactButton={!windowMode.isDesktop}
        onCompact={() => void windowMode.setCompact(true)}
      />

      <main className="main">
        {loadError ? (
          <div className="banner banner-error">
            <div>
              <strong>Could not load your tasks.</strong>
              <div className="small">
                {loadError instanceof Error ? loadError.message : String(loadError)} (API: {API_BASE_URL})
              </div>
            </div>
            <button type="button" className="btn" onClick={() => void queryClient.invalidateQueries()}>
              <RefreshCw size={14} />
              <span>Retry</span>
            </button>
          </div>
        ) : loading ? (
          <div className="loading">Loading…</div>
        ) : effectiveView.kind === 'calendar' ? (
          <CalendarView
            tasks={tasks.data ?? []}
            projects={projects.data ?? []}
            onOpenTask={setOpenTaskId}
            onAddTask={(dueDate) => setDialog({ kind: 'quick-add', dueDate })}
          />
        ) : (
          <TaskList
            view={effectiveView}
            tasks={tasks.data ?? []}
            completedTasks={completed.data ?? []}
            projects={projects.data ?? []}
            sections={sections.data ?? []}
            labels={labels.data ?? []}
            onOpenTask={setOpenTaskId}
            onDeleteTask={(task) => void deleteTask(task)}
            onCreateLabel={createLabel}
            confirm={confirm}
          />
        )}
      </main>

      {overlays}
    </div>
  );
}
