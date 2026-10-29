import {
  CalendarDays,
  CalendarRange,
  ChartColumn,
  CheckCircle2,
  ChevronRight,
  Hash,
  Inbox,
  Minimize2,
  Settings,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftDashed,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Star,
  StickyNote,
  Sun,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CompletionItem, Label, Project, Task } from '../api/types';
import { colorHex } from '../lib/colors';
import { todayStr } from '../lib/dates';
import type { ThemePreference } from '../lib/theme';
import { viewEquals, type View } from '../lib/views';
import { Dashboard } from './Dashboard';
import { Wordmark } from './Logo';

interface SidebarProps {
  view: View;
  onSelectView: (view: View) => void;
  projects: Project[];
  labels: Label[];
  tasks: Task[];
  completions: CompletionItem[];
  search: string;
  onSearch: (query: string) => void;
  onAddTask: () => void;
  onAddProject: () => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onAddLabel: () => void;
  onEditLabel: (label: Label) => void;
  onDeleteLabel: (label: Label) => void;
  themePreference: ThemePreference;
  onCycleTheme: () => void;
  onOpenSettings: () => void;
  /** Signed-in account control for the footer (switch account, sign out); null in local mode. */
  accountMenu?: ReactNode;
  /** In the browser there is no title bar, so Mini mode lives here instead. */
  showCompactButton: boolean;
  onCompact: () => void;
}

const COLLAPSE_KEY_PREFIX = 'mytodoease.sidebar.collapsed.';
const MODE_KEY = 'todoease.sidebar.mode';

/** Full sidebar, a rail of icons, or hidden altogether (a button at the top left brings it back). */
export type SidebarMode = 'full' | 'rail' | 'hidden';

function readMode(): SidebarMode {
  try {
    const stored = window.localStorage.getItem(MODE_KEY);
    return stored === 'rail' || stored === 'hidden' ? stored : 'full';
  } catch {
    return 'full';
  }
}

/** The sidebar mode, remembered on this device; "m" hides or shows the sidebar, as in Todoist. */
function useSidebarMode() {
  const [mode, setMode] = useState<SidebarMode>(readMode);
  // Where "show" returns to: the last visible mode.
  const lastShown = useRef<Exclude<SidebarMode, 'hidden'>>(mode === 'rail' ? 'rail' : 'full');
  useEffect(() => {
    if (mode !== 'hidden') lastShown.current = mode;
    try {
      window.localStorage.setItem(MODE_KEY, mode);
    } catch {
      // Not persisted; fine.
    }
  }, [mode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing || event.ctrlKey || event.metaKey || event.altKey || event.key !== 'm') return;
      if (document.querySelector('.modal-overlay')) return;
      event.preventDefault();
      setMode((current) => (current === 'hidden' ? lastShown.current : 'hidden'));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { mode, setMode, show: () => setMode(lastShown.current) };
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
          title={collapsed ? `Show ${title.toLowerCase()}` : `Hide ${title.toLowerCase()}`}
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

const THEME_META: Record<ThemePreference, { label: string; icon: ReactNode }> = {
  light: { label: 'Light', icon: <Sun size={15} /> },
  dark: { label: 'Dark', icon: <Moon size={15} /> },
  system: { label: 'System', icon: <Monitor size={15} /> },
};

function NavItem({
  icon,
  label,
  count,
  active,
  onClick,
  actions,
  iconOnly,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  actions?: ReactNode;
  /** In the icon rail the label is hidden, so it becomes the tooltip and the accessible name. */
  iconOnly?: boolean;
}) {
  return (
    <div
      className={`nav-item ${active ? 'is-active' : ''}`}
      role="button"
      tabIndex={0}
      title={iconOnly ? (count ? `${label} (${count})` : label) : undefined}
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
      {count !== undefined && count > 0 && <span className="nav-count">{count}</span>}
    </div>
  );
}

export function Sidebar({
  view,
  onSelectView,
  projects,
  labels,
  tasks,
  completions,
  search,
  onSearch,
  onAddTask,
  onAddProject,
  onEditProject,
  onDeleteProject,
  onAddLabel,
  onEditLabel,
  onDeleteLabel,
  themePreference,
  onCycleTheme,
  onOpenSettings,
  accountMenu,
  showCompactButton,
  onCompact,
}: SidebarProps) {
  const today = todayStr();
  const inbox = projects.find((p) => p.isInbox);
  const inboxCount = inbox ? tasks.filter((t) => t.projectId === inbox.id).length : 0;
  const todayCount = tasks.filter((t) => t.dueDate !== null && t.dueDate <= today).length;
  const countFor = (projectId: string) => tasks.filter((t) => t.projectId === projectId).length;
  const countForLabel = (labelId: string) => tasks.filter((t) => t.labelIds.includes(labelId)).length;
  const userProjects = projects.filter((p) => !p.isInbox);
  const favorites = userProjects.filter((p) => p.isFavorite);
  const isActive = (candidate: View) => !search && viewEquals(view, candidate);
  const { mode, setMode, show } = useSidebarMode();
  const rail = mode === 'rail';
  const searchRef = useRef<HTMLInputElement>(null);

  const projectActions = (project: Project) => (
    <>
      <button
        type="button"
        className="icon-btn"
        title="Edit project"
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
        title="Delete project"
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

  const hideButton = (
    <button
      type="button"
      className="icon-btn sidebar-toggle"
      title="Hide sidebar (m)"
      aria-label="Hide sidebar"
      onClick={() => setMode('hidden')}
    >
      <PanelLeftDashed size={16} />
    </button>
  );

  return (
    <>
      {mode === 'hidden' && (
        <button
          type="button"
          className="icon-btn sidebar-reveal"
          title="Show sidebar (m)"
          aria-label="Show sidebar"
          onClick={show}
        >
          <PanelLeftOpen size={18} />
        </button>
      )}
      <aside className={`sidebar is-${mode}`} inert={mode === 'hidden'} aria-label="Sidebar">
        <div className="sidebar-top">
          <div className="brand">
            <Wordmark size={26} />
            <div className="sidebar-toggles">
              {rail ? (
                <button
                  type="button"
                  className="icon-btn sidebar-toggle"
                  title="Expand sidebar"
                  aria-label="Expand sidebar"
                  onClick={() => setMode('full')}
                >
                  <PanelLeftOpen size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  className="icon-btn sidebar-toggle"
                  title="Collapse to icons"
                  aria-label="Collapse sidebar to icons"
                  onClick={() => setMode('rail')}
                >
                  <PanelLeftClose size={16} />
                </button>
              )}
              {hideButton}
            </div>
          </div>
          <button
            type="button"
            className="add-task-primary"
            onClick={onAddTask}
            title="Add task (q)"
            aria-label={rail ? 'Add task' : undefined}
          >
            <Plus size={18} />
            <span>Add task</span>
          </button>
          {rail && (
            <button
              type="button"
              className="nav-item rail-search"
              title="Search tasks"
              aria-label="Search tasks"
              onClick={() => {
                setMode('full');
                window.setTimeout(() => searchRef.current?.focus(), 0);
              }}
            >
              <span className="nav-icon">
                <Search size={18} />
              </span>
            </button>
          )}
        <div className="search-box">
          <Search size={15} />
          <input
            ref={searchRef}
            placeholder="Search tasks"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            aria-label="Search tasks"
          />
          {search && (
            <button type="button" className="icon-btn" aria-label="Clear search" onClick={() => onSearch('')}>
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {!rail && (
        <Dashboard
          tasks={tasks}
          completions={completions}
          active={isActive({ kind: 'insights' })}
          onSelectView={onSelectView}
        />
      )}

      <nav className="sidebar-nav">
        {rail && (
          <NavItem
            icon={<ChartColumn size={18} />}
            label="Insights"
            active={isActive({ kind: 'insights' })}
            onClick={() => onSelectView({ kind: 'insights' })}
            iconOnly
          />
        )}
        <NavItem
          icon={<StickyNote size={18} />}
          label="Notes"
          iconOnly={rail}
          active={isActive({ kind: 'notes' })}
          onClick={() => onSelectView({ kind: 'notes' })}
        />
        <NavItem
          icon={<Inbox size={18} />}
          label="Inbox"
          iconOnly={rail}
          count={inboxCount}
          active={isActive({ kind: 'inbox' })}
          onClick={() => onSelectView({ kind: 'inbox' })}
        />
        <NavItem
          icon={<CalendarDays size={18} />}
          label="Today"
          iconOnly={rail}
          count={todayCount}
          active={isActive({ kind: 'today' })}
          onClick={() => onSelectView({ kind: 'today' })}
        />
        <NavItem
          icon={<CalendarDays size={18} />}
          label="Upcoming"
          iconOnly={rail}
          active={isActive({ kind: 'upcoming' })}
          onClick={() => onSelectView({ kind: 'upcoming' })}
        />
        <NavItem
          icon={<CalendarRange size={18} />}
          label="Calendar"
          iconOnly={rail}
          active={isActive({ kind: 'calendar' })}
          onClick={() => onSelectView({ kind: 'calendar' })}
        />
        <NavItem
          icon={<CheckCircle2 size={18} />}
          label="Completed"
          iconOnly={rail}
          active={isActive({ kind: 'completed' })}
          onClick={() => onSelectView({ kind: 'completed' })}
        />
      </nav>

      {favorites.length > 0 && (
        <CollapsibleSection id="favorites" icon={<Star size={13} />} title="Favorites" forceOpen={rail}>
          {favorites.map(projectItem)}
        </CollapsibleSection>
      )}

      <CollapsibleSection
        id="projects"
        icon={<Hash size={13} />}
        title="My Projects"
        forceOpen={rail}
        action={
          <button type="button" className="icon-btn" title="Add project" aria-label="Add project" onClick={onAddProject}>
            <Plus size={15} />
          </button>
        }
      >
        {userProjects.length === 0 && <p className="sidebar-empty">No projects yet.</p>}
        {userProjects.map(projectItem)}
      </CollapsibleSection>

      <CollapsibleSection
        id="labels"
        icon={<Tag size={13} />}
        title="Labels"
        forceOpen={rail}
        action={
          <button type="button" className="icon-btn" title="Add label" aria-label="Add label" onClick={onAddLabel}>
            <Plus size={15} />
          </button>
        }
      >
        {labels.length === 0 && <p className="sidebar-empty">No labels yet.</p>}
        {labels.map((label) => (
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
                  title="Edit label"
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
                  title="Delete label"
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
      </CollapsibleSection>

      <div className="sidebar-footer">
        {accountMenu}
        <button type="button" className="footer-btn" onClick={onOpenSettings} title="Settings" aria-label="Settings">
          <Settings size={15} />
          <span>Settings</span>
        </button>
        {showCompactButton && (
          <button
            type="button"
            className="footer-btn"
            onClick={onCompact}
            title="Mini mode: only today's tasks"
            aria-label="Switch to mini mode"
          >
            <Minimize2 size={15} />
            <span>Mini</span>
          </button>
        )}
        <button
          type="button"
          className="footer-btn footer-btn-icon"
          onClick={onCycleTheme}
          title={`Theme: ${THEME_META[themePreference].label}. Click to switch.`}
          aria-label={`Theme: ${THEME_META[themePreference].label}. Click to switch.`}
        >
          {THEME_META[themePreference].icon}
        </button>
      </div>
    </aside>
    </>
  );
}
