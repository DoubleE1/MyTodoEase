import {
  CalendarDays,
  CalendarRange,
  ChartColumn,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Hash,
  Inbox,
  Minimize2,
  Pencil,
  Plus,
  Search,
  Star,
  StickyNote,
  Tag,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CompletionItem, Label, Project, Task } from '../api/types';
import { colorHex } from '../lib/colors';
import { todayStr } from '../lib/dates';
import { inboxTasks, useInboxFilter } from '../lib/inboxFilter';
import { useShowInsightsCard } from '../lib/insightsCard';
import { formatHotkey, useHotkey, useHotkeys } from '../lib/hotkeys';
import type { ThemePreference } from '../lib/theme';
import { viewEquals, type View } from '../lib/views';
import { Dashboard } from './Dashboard';
import { ProfileMenu } from './AccountMenu';
import type { ConfirmOptions } from './Dialogs';
import { Wordmark } from './Logo';
import { SidebarUpdate } from './UpdateBanner';
import { t } from '../i18n';

interface SidebarProps {
  view: View;
  onSelectView: (view: View) => void;
  projects: Project[];
  labels: Label[];
  tasks: Task[];
  completions: CompletionItem[];
  search: string;
  /** Opens the search / command palette. */
  onOpenSearch: () => void;
  onAddTask: () => void;
  onAddProject: () => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onAddLabel: () => void;
  onEditLabel: (label: Label) => void;
  onDeleteLabel: (label: Label) => void;
  themePreference: ThemePreference;
  onSetTheme: (preference: ThemePreference) => void;
  onOpenSettings: () => void;
  /** For the profile menu's sign-out confirmation. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Mini mode: a small window with only today's tasks. */
  onCompact: () => void;
}

const COLLAPSE_KEY_PREFIX = 'mytodoease.sidebar.collapsed.';
const MODE_KEY = 'todoease.sidebar.mode';

/** The full sidebar, or a rail of icons. */
export type SidebarMode = 'full' | 'rail';

function readMode(): SidebarMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'rail' ? 'rail' : 'full';
  } catch {
    return 'full';
  }
}

/** Below this window width the sidebar starts as icons, whatever the saved choice. */
const NARROW_QUERY = '(max-width: 720px)';

function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

/**
 * The sidebar mode, remembered on this device; "m" switches between full and icons. On a narrow window the
 * sidebar shows icons; opening it there is temporary (not saved) and it folds again after picking a view.
 */
function useSidebarMode() {
  const [saved, setSaved] = useState<SidebarMode>(readMode);
  const narrow = useNarrow();
  const [openOnNarrow, setOpenOnNarrow] = useState(false);
  useEffect(() => {
    try {
      window.localStorage.setItem(MODE_KEY, saved);
    } catch {
      // Not persisted; fine.
    }
  }, [saved]);
  useEffect(() => setOpenOnNarrow(false), [narrow]);

  const mode: SidebarMode = narrow ? (openOnNarrow ? 'full' : 'rail') : saved;
  const setMode = (next: SidebarMode) => (narrow ? setOpenOnNarrow(next === 'full') : setSaved(next));
  const latest = useRef({ mode, setMode });
  latest.current = { mode, setMode };

  // Collapse/expand shortcut (M by default, rebindable in Settings > Shortcuts); not while a dialog is open.
  useHotkey('toggleSidebar', () => {
    if (document.querySelector('.modal-overlay')) return;
    latest.current.setMode(latest.current.mode === 'rail' ? 'full' : 'rail');
  });

  /** After picking a view on a narrow window, fold the sidebar back to icons. */
  const afterSelect = () => {
    if (narrow) setOpenOnNarrow(false);
  };

  return { mode, setMode, afterSelect };
}

/** Lists longer than this show their first items and a "More" row, as in Gmail. */
const LIST_LIMIT = 5;
const MORE_KEY_PREFIX = 'todoease.sidebar.more.';

/** Whether a list's "More" is open; remembered per list on this device. */
function useMore(id: string) {
  const [expanded, setExpanded] = useState(() => {
    try {
      return window.localStorage.getItem(MORE_KEY_PREFIX + id) === 'true';
    } catch {
      return false;
    }
  });
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    try {
      window.localStorage.setItem(MORE_KEY_PREFIX + id, String(next));
    } catch {
      // Not persisted; fine.
    }
  };
  return { expanded, toggle };
}

/** The "More" / "Less" row under a list. */
function MoreToggle({ expanded, hidden, onToggle }: { expanded: boolean; hidden?: number; onToggle: () => void }) {
  return (
    <button type="button" className="nav-item sidebar-more" aria-expanded={expanded} onClick={onToggle}>
      <span className="nav-icon">{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
      <span className="nav-label">{expanded ? t('Less') : t('More')}</span>
      {!expanded && hidden ? <span className="nav-count">{hidden}</span> : null}
    </button>
  );
}

function readCollapsed(id: string): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY_PREFIX + id) === 'true';
  } catch {
    return false;
  }
}

/** Sidebar group with a heading that toggles its list; the open/closed state is remembered per group. */
function CollapsibleSection({
  id,
  icon,
  title,
  action,
  forceOpen,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  /** Show the list whatever its remembered state (the icon rail has no headings). */
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(id));
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSE_KEY_PREFIX + id, String(next));
    } catch {
      // Not persisted; fine.
    }
  };
  const listId = `sidebar-section-${id}`;
  return (
    <section className={`sidebar-section ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="sidebar-heading">
        <button
          type="button"
          className="heading-toggle"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls={listId}
          data-tooltip={collapsed ? `Show ${title.toLowerCase()}` : `Hide ${title.toLowerCase()}`}
        >
          <ChevronRight size={13} className="heading-chevron" />
          {icon}
          <span>{title}</span>
        </button>
        {action}
      </div>
      {(forceOpen || !collapsed) && <div id={listId}>{children}</div>}
    </section>
  );
}

function NavItem({
  icon,
  label,
  count,
  active,
  onClick,
  actions,
  iconOnly,
  kbd,
  className,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  actions?: ReactNode;
  /** In the icon rail the label is hidden, so it becomes the tooltip and the accessible name. */
  iconOnly?: boolean;
  /** Keyboard shortcut, shown on hover (and in the rail's tooltip). */
  kbd?: string;
  className?: string;
}) {
  return (
    <div
      className={`nav-item ${active ? 'is-active' : ''} ${className ?? ''}`}
      role="button"
      tabIndex={0}
      data-tooltip={iconOnly ? (count ? `${label} (${count})` : label) : undefined}
      data-tooltip-kbd={iconOnly ? kbd : undefined}
      data-tooltip-side="right"
      aria-label={iconOnly ? label : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
      {actions && <span className="nav-actions">{actions}</span>}
      {kbd && !iconOnly && <kbd className="nav-kbd">{kbd}</kbd>}
      {/* The icon rail's badge has room for two digits; the tooltip keeps the exact number. */}
      {count !== undefined && count > 0 && (
        <span className="nav-count">{iconOnly && count > 99 ? '99+' : count}</span>
      )}
    </div>
  );
}

export function Sidebar({
  view,
  onSelectView: selectView,
  projects,
  labels,
  tasks,
  completions,
  search,
  onOpenSearch,
  onAddTask,
  onAddProject,
  onEditProject,
  onDeleteProject,
  onAddLabel,
  onEditLabel,
  onDeleteLabel,
  themePreference,
  onSetTheme,
  onOpenSettings,
  confirm,
  onCompact,
}: SidebarProps) {
  const today = todayStr();
  // The Inbox count follows the Inbox page's project filter (all projects by default).
  const inboxCount = inboxTasks(tasks, useInboxFilter(projects)).length;
  const showInsightsCard = useShowInsightsCard();
  const todayCount = tasks.filter((t) => t.dueDate !== null && t.dueDate <= today).length;
  const countFor = (projectId: string) => tasks.filter((t) => t.projectId === projectId).length;
  const countForLabel = (labelId: string) => tasks.filter((t) => t.labelIds.includes(labelId)).length;
  const userProjects = projects.filter((p) => !p.isInbox);
  const favorites = userProjects.filter((p) => p.isFavorite);
  const isActive = (candidate: View) => !search && viewEquals(view, candidate);
  const { mode, setMode, afterSelect } = useSidebarMode();
  const onSelectView = (next: View) => {
    selectView(next);
    afterSelect();
  };
  const rail = mode === 'rail';
  const hotkeys = useHotkeys();
  const navMore = useMore('nav');
  const projectsMore = useMore('projects');
  const labelsMore = useMore('labels');

  /** The items a list shows: all of them when open (or in the rail), else the first few plus the open one. */
  const shownOf = <T,>(items: T[], expanded: boolean, viewOf: (item: T) => View) =>
    rail || expanded ? items : items.filter((item, i) => i < LIST_LIMIT || isActive(viewOf(item)));

  const projectActions = (project: Project) => (
    <>
      <button
        type="button"
        className="icon-btn"
        data-tooltip={t('Edit project')}
        aria-label={`Edit project ${project.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onEditProject(project);
        }}
      >
        <Pencil size={13} />
      </button>
      <button
        type="button"
        className="icon-btn"
        data-tooltip={t('Delete project')}
        aria-label={`Delete project ${project.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onDeleteProject(project);
        }}
      >
        <Trash2 size={13} />
      </button>
    </>
  );

  const projectItem = (project: Project) => (
    <NavItem
      key={project.id}
      icon={<span className="dot" style={{ background: colorHex(project.color) }} />}
      label={project.name}
      count={countFor(project.id)}
      active={isActive({ kind: 'project', projectId: project.id })}
      onClick={() => onSelectView({ kind: 'project', projectId: project.id })}
      actions={projectActions(project)}
      iconOnly={rail}
    />
  );

  return (
    // The shell holds the sidebar plus its edge toggle, which sits on the border, half outside the
    // sidebar (the sidebar itself scrolls and would clip it).
    <div className={`sidebar-shell is-${mode}`}>
      <button
        type="button"
        className="sidebar-edge-toggle"
        data-tooltip={rail ? t('Expand sidebar') : t('Collapse to icons')}
        data-tooltip-kbd={formatHotkey(hotkeys.toggleSidebar) || undefined}
        data-tooltip-side="right"
        aria-label={rail ? t('Expand sidebar') : t('Collapse sidebar to icons')}
        aria-expanded={!rail}
        onClick={() => setMode(rail ? 'full' : 'rail')}
      >
        {rail ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
      <aside className={`sidebar is-${mode}`} aria-label={t('Sidebar')}>
        <div className="sidebar-top">
          {/* The logo opens Home, the page with a card for each feature. */}
          <button
            type="button"
            className={`brand brand-home ${isActive({ kind: 'home' }) ? 'is-active' : ''}`}
            onClick={() => onSelectView({ kind: 'home' })}
            aria-label={t('Home')}
            data-tooltip={rail ? t('Home') : undefined}
            data-tooltip-side="right"
          >
            <Wordmark size={26} />
          </button>
          {/* New task and search, as plain rows like the nav below (search opens the command palette). */}
          <nav className="sidebar-actions" aria-label={t('Add and search')}>
            <NavItem
              className="nav-add-task"
              icon={<Plus size={18} />}
              label={t('Add task')}
              kbd={formatHotkey(hotkeys.quickAdd)}
              active={false}
              onClick={onAddTask}
              iconOnly={rail}
            />
            <NavItem
              icon={<Search size={18} />}
              label={search ? t('Search: {query}', { query: search }) : t('Search')}
              kbd={formatHotkey(hotkeys.search)}
              active={!!search}
              onClick={onOpenSearch}
              iconOnly={rail}
            />
          </nav>
        </div>

        {/* Only the middle scrolls; the top and the footer stay in place. */}
        <div className="sidebar-scroll">
          {!rail && showInsightsCard && (
            <Dashboard
              tasks={tasks}
              completions={completions}
              active={isActive({ kind: 'insights' })}
              onSelectView={onSelectView}
            />
          )}

          <nav className="sidebar-nav">
            {/* Without the card (icon rail, or hidden in Settings) Insights is an ordinary nav item. */}
            {(rail || !showInsightsCard) && (
              <NavItem
                icon={<ChartColumn size={18} />}
                label={t('Insights')}
                active={isActive({ kind: 'insights' })}
                onClick={() => onSelectView({ kind: 'insights' })}
                iconOnly={rail}
              />
            )}
            <NavItem
              icon={<StickyNote size={18} />}
              label={t('Notes')}
              iconOnly={rail}
              active={isActive({ kind: 'notes' })}
              onClick={() => onSelectView({ kind: 'notes' })}
            />
            <NavItem
              icon={<Inbox size={18} />}
              label={t('Inbox')}
              iconOnly={rail}
              count={inboxCount}
              active={isActive({ kind: 'inbox' })}
              onClick={() => onSelectView({ kind: 'inbox' })}
            />
            <NavItem
              icon={<CalendarDays size={18} />}
              label={t('Today')}
              iconOnly={rail}
              count={todayCount}
              active={isActive({ kind: 'today' })}
              onClick={() => onSelectView({ kind: 'today' })}
            />
            <NavItem
              icon={<CalendarDays size={18} />}
              label={t('Upcoming')}
              iconOnly={rail}
              active={isActive({ kind: 'upcoming' })}
              onClick={() => onSelectView({ kind: 'upcoming' })}
            />
            <NavItem
              icon={<CalendarRange size={18} />}
              label={t('Calendar')}
              iconOnly={rail}
              active={isActive({ kind: 'calendar' })}
              onClick={() => onSelectView({ kind: 'calendar' })}
            />
            {/* Less-used views sit behind "More", as in Gmail (always shown when open, and in the icon rail). */}
            {(rail || navMore.expanded || isActive({ kind: 'completed' })) && (
              <NavItem
                icon={<CheckCircle2 size={18} />}
                label={t('Completed')}
                iconOnly={rail}
                active={isActive({ kind: 'completed' })}
                onClick={() => onSelectView({ kind: 'completed' })}
              />
            )}
            {!rail && <MoreToggle expanded={navMore.expanded} onToggle={navMore.toggle} />}
          </nav>

          {favorites.length > 0 && (
            <CollapsibleSection id="favorites" icon={<Star size={13} />} title={t('Favorites')} forceOpen={rail}>
              {favorites.map(projectItem)}
            </CollapsibleSection>
          )}

          <CollapsibleSection
            id="projects"
            icon={<Hash size={13} />}
            title={t('My Projects')}
            forceOpen={rail}
            action={
              <button type="button" className="icon-btn" data-tooltip={t('Add project')} aria-label={t('Add project')} onClick={onAddProject}>
                <Plus size={15} />
              </button>
            }
          >
            {userProjects.length === 0 && <p className="sidebar-empty">No projects yet.</p>}
            {shownOf(userProjects, projectsMore.expanded, (p) => ({ kind: 'project', projectId: p.id })).map(projectItem)}
            {!rail && userProjects.length > LIST_LIMIT && (
              <MoreToggle
                expanded={projectsMore.expanded}
                hidden={userProjects.length - shownOf(userProjects, false, (p) => ({ kind: 'project', projectId: p.id })).length}
                onToggle={projectsMore.toggle}
              />
            )}
          </CollapsibleSection>

          <CollapsibleSection
            id="labels"
            icon={<Tag size={13} />}
            title={t('Labels')}
            forceOpen={rail}
            action={
              <button type="button" className="icon-btn" data-tooltip={t('Add label')} aria-label={t('Add label')} onClick={onAddLabel}>
                <Plus size={15} />
              </button>
            }
          >
            {labels.length === 0 && <p className="sidebar-empty">No labels yet.</p>}
            {shownOf(labels, labelsMore.expanded, (l) => ({ kind: 'label', labelId: l.id })).map((label) => (
              <NavItem
                key={label.id}
                icon={<Tag size={15} color={colorHex(label.color)} />}
                label={label.name}
                count={countForLabel(label.id)}
                iconOnly={rail}
                active={isActive({ kind: 'label', labelId: label.id })}
                onClick={() => onSelectView({ kind: 'label', labelId: label.id })}
                actions={
                  <>
                    <button
                      type="button"
                      className="icon-btn"
                      data-tooltip={t('Edit label')}
                      aria-label={`Edit label ${label.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditLabel(label);
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      data-tooltip={t('Delete label')}
                      aria-label={`Delete label ${label.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteLabel(label);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                }
              />
            ))}
            {!rail && labels.length > LIST_LIMIT && (
              <MoreToggle
                expanded={labelsMore.expanded}
                hidden={labels.length - shownOf(labels, false, (l) => ({ kind: 'label', labelId: l.id })).length}
                onToggle={labelsMore.toggle}
              />
            )}
          </CollapsibleSection>
        </div>

        <SidebarUpdate rail={rail} />

        {/* One slim row: the profile (its menu holds Achievements, Shop, Settings and the theme) and Mini mode. */}
        <div className="sidebar-footer">
          <ProfileMenu
            confirm={confirm}
            rail={rail}
            onOpenSettings={onOpenSettings}
            onSelectView={onSelectView}
            themePreference={themePreference}
            onSetTheme={onSetTheme}
          />
          <button
            type="button"
            className="footer-btn footer-btn-icon"
            onClick={onCompact}
            data-tooltip={t('Mini mode: only today\'s tasks')}
            data-tooltip-side={rail ? 'right' : 'top'}
            aria-label={t('Switch to mini mode')}
          >
            <Minimize2 size={15} />
          </button>
        </div>
      </aside>
    </div>
  );
}
