import {
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Hash,
  Inbox,
  Monitor,
  Moon,
  Pencil,
  Plus,
  Search,
  Star,
  Sun,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { Label, Project, Task } from '../api/types';
import { colorHex } from '../lib/colors';
import { todayStr } from '../lib/dates';
import type { ThemePreference } from '../lib/theme';
import { viewEquals, type View } from '../lib/views';

interface SidebarProps {
  view: View;
  onSelectView: (view: View) => void;
  projects: Project[];
  labels: Label[];
  tasks: Task[];
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
}

const THEME_META: Record<ThemePreference, { label: string; icon: ReactNode }> = {
  light: { label: 'Light theme', icon: <Sun size={15} /> },
  dark: { label: 'Dark theme', icon: <Moon size={15} /> },
  system: { label: 'Follow system theme', icon: <Monitor size={15} /> },
};

function NavItem({
  icon,
  label,
  count,
  active,
  onClick,
  actions,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  actions?: ReactNode;
}) {
  return (
    <div
      className={`nav-item ${active ? 'is-active' : ''}`}
      role="button"
      tabIndex={0}
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
    />
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand">MyTodoEase</div>
        <button type="button" className="add-task-primary" onClick={onAddTask} title="Add task (q)">
          <Plus size={18} />
          <span>Add task</span>
        </button>
        <div className="search-box">
          <Search size={15} />
          <input
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

      <nav className="sidebar-nav">
        <NavItem
          icon={<Inbox size={18} />}
          label="Inbox"
          count={inboxCount}
          active={isActive({ kind: 'inbox' })}
          onClick={() => onSelectView({ kind: 'inbox' })}
        />
        <NavItem
          icon={<CalendarDays size={18} />}
          label="Today"
          count={todayCount}
          active={isActive({ kind: 'today' })}
          onClick={() => onSelectView({ kind: 'today' })}
        />
        <NavItem
          icon={<CalendarDays size={18} />}
          label="Upcoming"
          active={isActive({ kind: 'upcoming' })}
          onClick={() => onSelectView({ kind: 'upcoming' })}
        />
        <NavItem
          icon={<CalendarRange size={18} />}
          label="Calendar"
          active={isActive({ kind: 'calendar' })}
          onClick={() => onSelectView({ kind: 'calendar' })}
        />
        <NavItem
          icon={<CheckCircle2 size={18} />}
          label="Completed"
          active={isActive({ kind: 'completed' })}
          onClick={() => onSelectView({ kind: 'completed' })}
        />
      </nav>

      {favorites.length > 0 && (
        <section className="sidebar-section">
          <div className="sidebar-heading">
            <Star size={13} />
            <span>Favorites</span>
          </div>
          {favorites.map(projectItem)}
        </section>
      )}

      <section className="sidebar-section">
        <div className="sidebar-heading">
          <Hash size={13} />
          <span>My Projects</span>
          <span className="spacer" />
          <button type="button" className="icon-btn" title="Add project" aria-label="Add project" onClick={onAddProject}>
            <Plus size={15} />
          </button>
        </div>
        {userProjects.length === 0 && <p className="sidebar-empty">No projects yet.</p>}
        {userProjects.map(projectItem)}
      </section>

      <section className="sidebar-section">
        <div className="sidebar-heading">
          <Tag size={13} />
          <span>Labels</span>
          <span className="spacer" />
          <button type="button" className="icon-btn" title="Add label" aria-label="Add label" onClick={onAddLabel}>
            <Plus size={15} />
          </button>
        </div>
        {labels.length === 0 && <p className="sidebar-empty">No labels yet.</p>}
        {labels.map((label) => (
          <NavItem
            key={label.id}
            icon={<Tag size={15} color={colorHex(label.color)} />}
            label={label.name}
            count={countForLabel(label.id)}
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
      </section>

      <div className="sidebar-footer">
        <button
          type="button"
          className="theme-toggle"
          onClick={onCycleTheme}
          title="Switch theme (light, dark, system)"
          aria-label={`${THEME_META[themePreference].label}. Click to switch.`}
        >
          {THEME_META[themePreference].icon}
          <span>{THEME_META[themePreference].label}</span>
        </button>
      </div>
    </aside>
  );
}
