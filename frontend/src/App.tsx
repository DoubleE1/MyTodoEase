import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL } from './api/client';
import { subDays } from 'date-fns';
import {
  useActiveTasks,
  useCompletedTasks,
  useCompletions,
  useLabelMutations,
  useLabels,
  useNotes,
  useProjectMutations,
  useProjects,
  useSectionMutations,
  useSections,
  useTaskMutations,
} from './api/hooks';
import type { Label, Project, Task } from './api/types';
import { CommandPalette } from './components/CommandPalette';
import { CompactView } from './components/CompactView';
import { KeyboardShortcutsDialog } from './components/KeyboardShortcuts';
import { ConfirmDialog, LabelDialog, Modal, ProjectDialog, type ConfirmOptions } from './components/Dialogs';
import { Sidebar } from './components/Sidebar';
import { TaskDetail } from './components/TaskDetail';
import { TaskEditor } from './components/TaskEditor';
import { TaskList } from './components/TaskList';
import { TitleBar } from './components/TitleBar';
import { Toasts } from './components/Toasts';
import { TooltipLayer } from './components/TooltipLayer';

// Loaded on first use: the calendar grid, Insights (with the World view and its sprites) and Settings are a large
// share of the bundle and most sessions never open all three, so the first paint ships without them.
const CalendarView = lazy(() => import('./components/CalendarView').then((m) => ({ default: m.CalendarView })));
const AchievementsView = lazy(() => import('./components/AchievementsView').then((m) => ({ default: m.AchievementsView })));
const HomeView = lazy(() => import('./components/HomeView').then((m) => ({ default: m.HomeView })));
const ShopView = lazy(() => import('./components/AchievementsView').then((m) => ({ default: m.ShopView })));
const InsightsView = lazy(() => import('./components/InsightsView').then((m) => ({ default: m.InsightsView })));
const NotesView = lazy(() => import('./components/NotesView').then((m) => ({ default: m.NotesView })));
const SettingsDialog = lazy(() => import('./components/SettingsDialog').then((m) => ({ default: m.SettingsDialog })));
import { toDateStr, todayStr } from './lib/dates';
import { useWindowMode } from './lib/desktop';
import { useHotkey } from './lib/hotkeys';
import { useInboxFilter } from './lib/inboxFilter';
import { motionReduced } from './lib/motion';
import { undoLast } from './lib/undo';
import { recordEvent } from './lib/achievements';
import { useAchievementWatcher } from './lib/useAchievements';
import { useNotesSync } from './lib/notes';
import { useBackgroundModeBridge } from './lib/globalHotkeys';
import { useTheme } from './lib/theme';
import type { View } from './lib/views';
import { t } from './i18n';

type Dialog =
  | { kind: 'project'; project?: Project }
  | { kind: 'label'; label?: Label }
  | { kind: 'quick-add'; dueDate?: string; dueTime?: string; content?: string }
  | { kind: 'settings' }
  | { kind: 'palette' }
  | { kind: 'shortcuts' }
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
  // Desktop: notes edited in a popped-out window show up here too.
  useNotesSync();
  // Desktop: the tray, the quick-add popup and the "New sticky note" shortcut talk to this window.
  useBackgroundModeBridge();
  const theme = useTheme();
  const windowMode = useWindowMode();

  // Home shows a count of notes; fetched only while it is open.
  const notes = useNotes(view.kind === 'home');
  const completed = useCompletedTasks(view.kind === 'completed' || view.kind === 'calendar' || openTaskId !== null);
  // Sidebar dashboard: recent completion history (long enough for any realistic streak).
  const recentCompletions = useCompletions(toDateStr(subDays(new Date(), 400)), todayStr());
  const taskMut = useTaskMutations();
  const projectMut = useProjectMutations();
  const labelMut = useLabelMutations();
  // Sections are mutated inside TaskList; the hook is referenced here only to keep the cache keys warm.
  useSectionMutations();

  const effectiveView: View = useMemo(
    () => (search.trim() ? { kind: 'search', query: search.trim() } : view),
    [search, view],
  );

  // Shortcuts (rebindable in Settings > Shortcuts). Settings opens from anywhere; quick add and search
  // wait until no other dialog or task is open. Search (the palette) is the full window only.
  useHotkey('settings', () => setDialog({ kind: 'settings' }));
  useHotkey('quickAdd', () => setDialog({ kind: 'quick-add' }), !dialog && !openTaskId);
  useHotkey('search', () => setDialog({ kind: 'palette' }), !dialog && !openTaskId && !windowMode.compact);
  useHotkey('shortcuts', () => setDialog({ kind: 'shortcuts' }), dialog?.kind !== 'shortcuts');
  useHotkey('undo', () => void undoLast());
  // Achievements: store new unlocks and say so; the toast's "View" opens the page.
  useAchievementWatcher(() => {
    setSearch('');
    setView({ kind: 'achievements' });
  });

  const createLabel = useCallback((name: string) => labelMut.create.mutateAsync({ name }), [labelMut.create]);

  const deleteTask = useCallback(
    async (task: Task) => {
      const ok = await confirm({
        title: t('Delete task?'),
        message: t('“{name}” and its sub-tasks will be permanently deleted.', { name: task.content }),
      });
      if (!ok) return;
      if (openTaskId === task.id) setOpenTaskId(null);
      taskMut.remove.mutate(task.id);
    },
    [confirm, openTaskId, taskMut.remove],
  );

  const deleteProject = async (project: Project) => {
    const ok = await confirm({
      title: t('Delete project “{name}”?', { name: project.name }),
      message: t('All tasks and sections in this project will be permanently deleted.'),
    });
    if (!ok) return;
    if (view.kind === 'project' && view.projectId === project.id) setView({ kind: 'inbox' });
    projectMut.remove.mutate(project.id);
  };

  const deleteLabel = async (label: Label) => {
    const ok = await confirm({
      title: t('Delete label “{name}”?', { name: label.name }),
      message: t('The label is removed from all tasks. Tasks themselves are kept.'),
    });
    if (!ok) return;
    if (view.kind === 'label' && view.labelId === label.id) setView({ kind: 'today' });
    labelMut.remove.mutate(label.id);
  };

  const closeDetail = useCallback(() => setOpenTaskId(null), []);
  const closeDialog = useCallback(() => setDialog(null), []);

  // Header backdrop: a halo that follows the pointer while it is over the dotted area.
  // Written straight to the element's CSS variables so mouse moves never re-render React.
  const mainRef = useRef<HTMLElement>(null);
  const pointerHaloRef = useRef<HTMLSpanElement>(null);
  const rippleRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const main = mainRef.current;
    const halo = pointerHaloRef.current;
    const ripple = rippleRef.current;
    const art = halo?.parentElement;
    if (!main || !halo || !ripple || !art) return;

    const locate = (event: MouseEvent) => {
      const rect = art.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const inside = x >= 0 && x <= rect.width && y >= 0 && y <= rect.height;
      return { inside, hx: `${(x / rect.width) * 100}%`, hy: `${(y / rect.height) * 100}%` };
    };
    const hide = () => halo.classList.remove('is-active');
    const onMove = (event: MouseEvent) => {
      const at = locate(event);
      if (!at.inside) {
        hide();
        return;
      }
      halo.style.setProperty('--hx', at.hx);
      halo.style.setProperty('--hy', at.hy);
      halo.classList.add('is-active');
    };

    // Click: two rings of lit dots spread from the point like water ripples, both at the same
    // speed, each starting a little later with its own thickness and a slight random drift.
    // Driven by requestAnimationFrame: CSS animations on freshly inserted mask layers stayed
    // pending in Chromium and never started. Meanwhile the pointer halo dips out and eases back in.
    let undimTimer: number | undefined;
    let frameHandle: number | undefined;
    const rand = (min: number, max: number) => min + Math.random() * (max - min);
    const RIPPLE_MS = 1800;
    const live: { el: HTMLSpanElement; start: number }[] = [];
    const glowOpacity = () => parseFloat(getComputedStyle(art).getPropertyValue('--glow-opacity')) || 0.8;

    const tick = (now: number) => {
      const glow = glowOpacity();
      for (let i = live.length - 1; i >= 0; i--) {
        const { el, start } = live[i];
        const t = (now - start) / RIPPLE_MS;
        if (t >= 1) {
          el.remove();
          live.splice(i, 1);
          continue;
        }
        if (t < 0) continue; // not started yet (staggered wave)
        const p = 1 - Math.pow(1 - t, 2.4); // fast start, long gentle tail
        el.style.setProperty('--p', p.toFixed(4));
        el.style.opacity = (glow * Math.pow(1 - p, 1.3)).toFixed(3);
      }
      frameHandle = live.length ? requestAnimationFrame(tick) : undefined;
    };

    const onDown = (event: MouseEvent) => {
      const at = locate(event);
      // Reduce motion (OS or Settings) turns the click ripple off; checked per click so the switch applies at once.
      if (!at.inside || event.button !== 0 || motionReduced()) return;
      const now = performance.now();
      const waves = 2;
      for (let i = 0; i < waves; i++) {
        const el = document.createElement('span');
        el.className = 'halo ripple-ring';
        el.style.setProperty('--hx', at.hx);
        el.style.setProperty('--hy', at.hy);
        el.style.setProperty('--dx', `${rand(-70, 70).toFixed(0)}px`);
        el.style.setProperty('--dy', `${rand(-45, 45).toFixed(0)}px`);
        el.style.setProperty('--thick', `${rand(16, 36).toFixed(0)}px`);
        el.style.setProperty('--p', '0');
        el.style.opacity = '0';
        ripple.appendChild(el);
        live.push({ el, start: now + (i === 0 ? 0 : rand(160, 520)) });
      }
      if (frameHandle === undefined) frameHandle = requestAnimationFrame(tick);
      halo.classList.add('is-dimmed');
      window.clearTimeout(undimTimer);
      undimTimer = window.setTimeout(() => halo.classList.remove('is-dimmed'), 600);
    };

    main.addEventListener('mousemove', onMove);
    main.addEventListener('mouseleave', hide);
    main.addEventListener('mousedown', onDown);
    return () => {
      main.removeEventListener('mousemove', onMove);
      main.removeEventListener('mouseleave', hide);
      main.removeEventListener('mousedown', onDown);
      window.clearTimeout(undimTimer);
      if (frameHandle !== undefined) cancelAnimationFrame(frameHandle);
      live.length = 0;
      ripple.replaceChildren();
    };
    // The art element is always rendered inside <main>, so the only remount is the compact/full switch.
  }, [windowMode.compact]);

  const loading = projects.isLoading || sections.isLoading || labels.isLoading || tasks.isLoading;
  const loadError = projects.error ?? sections.error ?? labels.error ?? tasks.error;
  const inbox = projects.data?.find((p) => p.isInbox);
  const inboxFilter = useInboxFilter(projects.data ?? []);

  const quickAddDefaults = {
    projectId:
      view.kind === 'project'
        ? view.projectId
        : view.kind === 'inbox' && inboxFilter !== 'all'
          ? inboxFilter
          : inbox?.id,
    dueDate:
      dialog?.kind === 'quick-add' && dialog.dueDate ? dialog.dueDate : view.kind === 'today' ? todayStr() : undefined,
    dueTime: dialog?.kind === 'quick-add' ? dialog.dueTime : undefined,
    content: dialog?.kind === 'quick-add' ? dialog.content : undefined,
    labelIds: view.kind === 'label' ? [view.labelId] : undefined,
  };

  const titleBar = windowMode.isDesktop ? (
    <TitleBar
      compact={windowMode.compact}
      alwaysOnTop={windowMode.alwaysOnTop}
      docked={windowMode.docked}
      canDock={windowMode.canDock}
      onTogglePin={() => void windowMode.setAlwaysOnTop(!windowMode.alwaysOnTop)}
      onToggleCompact={() => void windowMode.setCompact(!windowMode.compact)}
      onToggleDock={() => {
        if (!windowMode.docked) recordEvent('docked');
        void windowMode.setDocked(!windowMode.docked);
      }}
    />
  ) : null;
  const shellClass = windowMode.isDesktop ? 'has-titlebar' : '';

  const overlays = (
    <>
      {dialog?.kind === 'quick-add' && inbox && (
        <Modal title={t('Add task')} onClose={closeDialog}>
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

      {dialog?.kind === 'palette' && (
        <CommandPalette
          tasks={tasks.data ?? []}
          projects={projects.data ?? []}
          labels={labels.data ?? []}
          onClose={closeDialog}
          onSelectView={(next) => {
            setSearch('');
            setView(next);
          }}
          onOpenTask={setOpenTaskId}
          onAddTask={(content) => setDialog({ kind: 'quick-add', content })}
          onAddProject={() => setDialog({ kind: 'project' })}
          onAddLabel={() => setDialog({ kind: 'label' })}
          onOpenSettings={() => setDialog({ kind: 'settings' })}
          onOpenShortcuts={() => setDialog({ kind: 'shortcuts' })}
          onToggleTheme={() =>
            theme.setPreference(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
          }
          onShowAllResults={setSearch}
          onCompact={windowMode.isDesktop ? () => void windowMode.setCompact(true) : undefined}
        />
      )}

      {dialog?.kind === 'shortcuts' && <KeyboardShortcutsDialog onClose={closeDialog} />}

      {dialog?.kind === 'settings' && (
        <Suspense fallback={null}>
          <SettingsDialog
            onClose={closeDialog}
            themePreference={theme.preference}
            onSetTheme={theme.setPreference}
            accent={theme.accent}
            onSetAccent={theme.setAccent}
            confirm={confirm}
          />
        </Suspense>
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
      <Toasts updateBanner={windowMode.compact} />
      <TooltipLayer />
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
            completions={recentCompletions.data?.items ?? []}
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
    <div className={`app ${shellClass} ${effectiveView.kind === 'home' ? 'is-home' : ''}`}>
      {titleBar}
      {/* Home sits above the features, so the Tasks sidebar is not shown there. */}
      {effectiveView.kind !== 'home' && (
      <Sidebar
        view={effectiveView}
        onSelectView={(next) => {
          setSearch('');
          setView(next);
        }}
        projects={projects.data ?? []}
        labels={labels.data ?? []}
        tasks={tasks.data ?? []}
        completions={recentCompletions.data?.items ?? []}
        search={search}
        onOpenSearch={() => setDialog({ kind: 'palette' })}
        onAddTask={() => setDialog({ kind: 'quick-add' })}
        onAddProject={() => setDialog({ kind: 'project' })}
        onEditProject={(project) => setDialog({ kind: 'project', project })}
        onDeleteProject={(project) => void deleteProject(project)}
        onAddLabel={() => setDialog({ kind: 'label' })}
        onEditLabel={(label) => setDialog({ kind: 'label', label })}
        onDeleteLabel={(label) => void deleteLabel(label)}
        themePreference={theme.preference}
        onSetTheme={theme.setPreference}
        onOpenSettings={() => setDialog({ kind: 'settings' })}
        confirm={confirm}
        onCompact={() => void windowMode.setCompact(true)}
      />
      )}

      <main className="main" ref={mainRef}>
        <div className="main-art" aria-hidden="true">
          <span className="halo halo-a" />
          <span className="halo halo-b" />
          <span className="halo halo-pointer" ref={pointerHaloRef} />
          <span className="ripple-layer" ref={rippleRef} />
        </div>
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
        ) : effectiveView.kind === 'notes' ? (
          <Suspense fallback={<div className="loading">Loading…</div>}>
            <NotesView
              projects={projects.data ?? []}
              sections={sections.data ?? []}
              labels={labels.data ?? []}
              onCreateLabel={createLabel}
              onOpenTask={setOpenTaskId}
              confirm={confirm}
            />
          </Suspense>
        ) : effectiveView.kind === 'achievements' ? (
          <Suspense fallback={<div className="loading">Loading…</div>}>
            <AchievementsView />
          </Suspense>
        ) : effectiveView.kind === 'home' ? (
          <Suspense fallback={<div className="loading">Loading…</div>}>
            <HomeView
              tasks={tasks.data ?? []}
              notes={notes.data ?? []}
              onSelectView={(next) => {
                setSearch('');
                setView(next);
              }}
              confirm={confirm}
              onOpenSettings={() => setDialog({ kind: 'settings' })}
              themePreference={theme.preference}
              onSetTheme={theme.setPreference}
            />
          </Suspense>
        ) : effectiveView.kind === 'shop' ? (
          <Suspense fallback={<div className="loading">Loading…</div>}>
            <ShopView />
          </Suspense>
        ) : effectiveView.kind === 'insights' ? (
          <Suspense fallback={<div className="loading">Loading…</div>}>
            <InsightsView projects={projects.data ?? []} />
          </Suspense>
        ) : effectiveView.kind === 'calendar' ? (
          <Suspense fallback={<div className="loading">Loading…</div>}>
            <CalendarView
              tasks={tasks.data ?? []}
              completedTasks={completed.data ?? []}
              projects={projects.data ?? []}
              onOpenTask={setOpenTaskId}
              onAddTask={(dueDate, dueTime) => setDialog({ kind: 'quick-add', dueDate, dueTime })}
            />
          </Suspense>
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
