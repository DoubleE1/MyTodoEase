import {
  CalendarDays,
  CalendarRange,
  ChartColumn,
  CircleCheck,
  FolderPlus,
  Inbox,
  Keyboard,
  Minimize2,
  Plus,
  Search,
  Settings,
  StickyNote,
  Sun,
  Tag,
  Tags,
  Trophy,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useNotes } from '../api/hooks';
import type { Label, Note, Project, Task } from '../api/types';
import { colorHex } from '../lib/colors';
import { describeDue, todayStr } from '../lib/dates';
import { hotkeyParts, useHotkeys, type HotkeyAction } from '../lib/hotkeys';
import { motionReduced } from '../lib/motion';
import { recordEvent } from '../lib/achievements';
import { isOverdue, sortForAgenda, type View } from '../lib/views';
import { ProjectIcon } from './Pickers';
import { t } from '../i18n';

/**
 * Search and command palette (Ctrl+K by default): find tasks, projects, labels and notes, jump to a page, or run
 * an action. Empty, it shows what needs attention, recent picks, pages and actions. Type tabs narrow the results;
 * Tab / Shift+Tab switches tabs without leaving the input.
 */

type ItemType = 'task' | 'project' | 'label' | 'note' | 'page' | 'action';
type TabId = 'all' | 'task' | 'project' | 'label' | 'note';

const TABS: { id: TabId; label: string }[] = [
  { id: 'all', label: t('All') },
  { id: 'task', label: t('Tasks') },
  { id: 'project', label: t('Projects') },
  { id: 'label', label: t('Labels') },
  { id: 'note', label: t('Notes') },
];

interface Item {
  key: string;
  type: ItemType;
  icon: ReactNode;
  title: string;
  detail?: ReactNode;
  /** Shortcut chip on the right (actions with a hotkey). */
  hotkey?: HotkeyAction;
  run: () => void;
}

interface Section {
  title: string;
  items: Item[];
}

// ----- Recent picks, remembered on this device -----

const RECENTS_KEY = 'todoease.palette.recent';
const MAX_RECENTS = 5;

function readRecents(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function rememberRecent(key: string) {
  const next = [key, ...readRecents().filter((k) => k !== key)].slice(0, MAX_RECENTS);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Not persisted; fine.
  }
}

// ----- Matching -----

/** 0 = no match; higher is better (title prefix > word prefix > anywhere > description only). */
function score(query: string, title: string, extra = ''): number {
  const q = query.toLowerCase();
  const t = title.toLowerCase();
  if (t.startsWith(q)) return 4;
  if (t.includes(` ${q}`)) return 3;
  if (t.includes(q)) return 2;
  return extra.toLowerCase().includes(q) ? 1 : 0;
}

function rank<T>(items: T[], query: string, text: (item: T) => [string, string?]): T[] {
  return items
    .map((item) => ({ item, s: score(query, ...text(item)) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((r) => r.item);
}

const openCount = (n: number) => (n === 0 ? t('No open tasks') : n === 1 ? t('1 open task') : t('{n} open tasks', { n }));
const noteTitle = (note: Note) => note.text.trim().split('\n')[0]?.slice(0, 80) || t('Empty note');

/** Matches the modal-out animation in styles.css. */
const CLOSE_MS = 140;

export interface CommandPaletteProps {
  tasks: Task[];
  projects: Project[];
  labels: Label[];
  onClose: () => void;
  onSelectView: (view: View) => void;
  onOpenTask: (id: string) => void;
  onAddTask: (content?: string) => void;
  onAddProject: () => void;
  onAddLabel: () => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onToggleTheme: () => void;
  /** Full-text task search on the main page (the old sidebar search box). */
  onShowAllResults: (query: string) => void;
  /** Desktop only. */
  onCompact?: () => void;
}

export function CommandPalette({
  tasks,
  projects,
  labels,
  onClose,
  onSelectView,
  onOpenTask,
  onAddTask,
  onAddProject,
  onAddLabel,
  onOpenSettings,
  onOpenShortcuts,
  onToggleTheme,
  onShowAllResults,
  onCompact,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<TabId>('all');
  const [active, setActive] = useState(0);
  const [closing, setClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const notes = useNotes();
  const hotkeys = useHotkeys();
  const q = query.trim();

  // Focus goes back where it was (e.g. the sidebar row) when the palette closes.
  useEffect(() => {
    recordEvent('paletteOpened');
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  const close = (after?: () => void) => {
    if (closing) return;
    if (motionReduced()) {
      onClose();
      after?.();
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      onClose();
      after?.();
    }, CLOSE_MS);
  };

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const today = todayStr();

  const sections = useMemo((): Section[] => {
    const pick = (key: string, run: () => void) => () => {
      rememberRecent(key);
      close(run);
    };

    const taskItem = (task: Task): Item => {
      const due = task.dueDate ? describeDue(task.dueDate, task.dueTime) : null;
      const project = projectById.get(task.projectId);
      return {
        key: `task:${task.id}`,
        type: 'task',
        icon: <CircleCheck size={16} />,
        title: task.content,
        detail: (
          <>
            {project && <span>{project.name}</span>}
            {due && <span className={`tone-${due.tone}`}>{due.text}</span>}
          </>
        ),
        run: pick(`task:${task.id}`, () => onOpenTask(task.id)),
      };
    };
    const projectItem = (project: Project): Item => ({
      key: `project:${project.id}`,
      type: 'project',
      icon: <ProjectIcon project={project} />,
      title: project.name,
      detail: <span>{openCount(tasks.filter((t) => t.projectId === project.id).length)}</span>,
      run: pick(`project:${project.id}`, () =>
        onSelectView(project.isInbox ? { kind: 'inbox' } : { kind: 'project', projectId: project.id }),
      ),
    });
    const labelItem = (label: Label): Item => ({
      key: `label:${label.id}`,
      type: 'label',
      icon: <Tag size={16} color={colorHex(label.color)} />,
      title: label.name,
      detail: <span>{openCount(tasks.filter((t) => t.labelIds.includes(label.id)).length)}</span>,
      run: pick(`label:${label.id}`, () => onSelectView({ kind: 'label', labelId: label.id })),
    });
    const noteItem = (note: Note): Item => ({
      key: `note:${note.id}`,
      type: 'note',
      icon: <StickyNote size={16} />,
      title: noteTitle(note),
      detail: <span>{t('Note')}</span>,
      run: pick(`note:${note.id}`, () => onSelectView({ kind: 'notes' })),
    });

    const pages: Item[] = (
      [
        ['inbox', t('Inbox'), <Inbox size={16} />],
        ['today', t('Today'), <CalendarDays size={16} />],
        ['upcoming', t('Upcoming'), <CalendarRange size={16} />],
        ['calendar', t('Calendar'), <CalendarDays size={16} />],
        ['notes', t('Notes'), <StickyNote size={16} />],
        ['insights', t('Insights'), <ChartColumn size={16} />],
        ['completed', t('Completed'), <CircleCheck size={16} />],
        ['achievements', t('Achievements'), <Trophy size={16} />],
      ] as const
    ).map(([kind, title, icon]) => ({
      key: `page:${kind}`,
      type: 'page',
      icon,
      title,
      detail: <span>{t('Go to page')}</span>,
      run: pick(`page:${kind}`, () => onSelectView({ kind } as View)),
    }));

    const actions: Item[] = [
      { key: 'action:add-task', type: 'action', icon: <Plus size={16} />, title: t('Add task'), hotkey: 'quickAdd', run: () => close(() => onAddTask()) },
      { key: 'action:add-project', type: 'action', icon: <FolderPlus size={16} />, title: t('New project'), run: () => close(onAddProject) },
      { key: 'action:add-label', type: 'action', icon: <Tags size={16} />, title: t('New label'), run: () => close(onAddLabel) },
      { key: 'action:theme', type: 'action', icon: <Sun size={16} />, title: t('Switch light / dark theme'), run: () => close(onToggleTheme) },
      ...(onCompact
        ? [{ key: 'action:mini', type: 'action' as const, icon: <Minimize2 size={16} />, title: t('Switch to mini mode'), run: () => close(onCompact) }]
        : []),
      { key: 'action:shortcuts', type: 'action', icon: <Keyboard size={16} />, title: t('Keyboard shortcuts'), hotkey: 'shortcuts', run: () => close(onOpenShortcuts) },
      { key: 'action:settings', type: 'action', icon: <Settings size={16} />, title: t('Open Settings'), hotkey: 'settings', run: () => close(onOpenSettings) },
    ];

    const noteList = notes.data ?? [];
    const limit = tab === 'all' ? 5 : 50;

    if (!q) {
      if (tab === 'task') return [{ title: t('Tasks'), items: sortForAgenda(tasks).slice(0, limit).map(taskItem) }];
      if (tab === 'project') return [{ title: t('Projects'), items: projects.map(projectItem) }];
      if (tab === 'label') return [{ title: t('Labels'), items: labels.map(labelItem) }];
      if (tab === 'note') return [{ title: t('Notes'), items: noteList.slice(0, limit).map(noteItem) }];

      // Overdue first, then due today: the same things the Today page would nag about.
      const attention = sortForAgenda(tasks.filter((t) => isOverdue(t, today) || t.dueDate === today)).slice(0, 3);
      const everything = new Map<string, Item>(
        [...tasks.map(taskItem), ...projects.map(projectItem), ...labels.map(labelItem), ...noteList.map(noteItem), ...pages].map(
          (item) => [item.key, item],
        ),
      );
      const shown = new Set(attention.map((t) => `task:${t.id}`));
      const recents = readRecents()
        .filter((k) => !shown.has(k))
        .map((k) => everything.get(k))
        .filter((item): item is Item => item !== undefined);
      return [
        { title: t('Needs attention'), items: attention.map(taskItem) },
        { title: t('Recent'), items: recents },
        { title: t('Go to'), items: pages },
        { title: t('Actions'), items: actions },
      ];
    }

    const foundTasks = rank(tasks, q, (t) => [t.content, t.description]).slice(0, limit).map(taskItem);
    const foundProjects = rank(projects, q, (p) => [p.name]).slice(0, limit).map(projectItem);
    const foundLabels = rank(labels, q, (l) => [l.name]).slice(0, limit).map(labelItem);
    const foundNotes = rank(noteList, q, (n) => [noteTitle(n), n.text]).slice(0, limit).map(noteItem);
    const byType: Record<Exclude<TabId, 'all'>, Section> = {
      task: { title: t('Tasks'), items: foundTasks },
      project: { title: t('Projects'), items: foundProjects },
      label: { title: t('Labels'), items: foundLabels },
      note: { title: t('Notes'), items: foundNotes },
    };
    // Always offer to capture what was typed, and the full search page for tasks.
    const typedActions: Item[] = [
      {
        key: 'action:add-typed',
        type: 'action',
        icon: <Plus size={16} />,
        title: t('Add task “{text}”', { text: q }),
        run: () => close(() => onAddTask(q)),
      },
      {
        key: 'action:show-all',
        type: 'action',
        icon: <Search size={16} />,
        title: t('Show all tasks matching “{text}”', { text: q }),
        run: () => close(() => onShowAllResults(q)),
      },
    ];
    if (tab !== 'all') return [byType[tab], ...(tab === 'task' ? [{ title: t('Actions'), items: typedActions }] : [])];
    return [
      byType.task,
      byType.project,
      byType.label,
      byType.note,
      { title: t('Pages'), items: rank(pages, q, (p) => [p.title]) },
      { title: t('Actions'), items: [...rank(actions, q, (a) => [a.title]), ...typedActions] },
    ];
    // close/pick are recreated each render but only read stable props; recomputing on data changes is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, tab, tasks, projects, labels, notes.data, projectById, today]);

  const visible = sections.filter((s) => s.items.length > 0);
  const flat = visible.flatMap((s) => s.items);
  const activeIndex = Math.min(active, Math.max(flat.length - 1, 0));

  useEffect(() => setActive(0), [q, tab]);
  useEffect(() => {
    listRef.current?.querySelector(`#palette-opt-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const switchTab = (step: number) => {
    const i = TABS.findIndex((t) => t.id === tab);
    setTab(TABS[(i + step + TABS.length) % TABS.length].id);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (flat.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + flat.length) % flat.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      flat[activeIndex]?.run();
    } else if (event.key === 'Tab') {
      // Focus stays in the dialog; Tab moves between the type tabs instead.
      event.preventDefault();
      switchTab(event.shiftKey ? -1 : 1);
    }
  };

  let index = -1;
  const emptyText = q ? t('Nothing matches “{text}”.', { text: q }) : tab === 'note' ? t('No notes yet.') : t('Nothing here yet.');

  return (
    <div
      className={`modal-overlay palette-overlay ${closing ? 'is-closing' : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="modal palette" role="dialog" aria-modal="true" aria-label={t('Search')} onKeyDown={onKeyDown}>
        <div className="palette-search">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Search tasks, projects, labels and notes')}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={flat.length > 0 ? `palette-opt-${activeIndex}` : undefined}
            aria-autocomplete="list"
            spellCheck={false}
          />
          <button type="button" className="icon-btn" aria-label={t('Close search')} onClick={() => close()}>
            <X size={16} />
          </button>
        </div>

        <div className="palette-tabs" role="tablist" aria-label={t('Result type')}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              tabIndex={-1}
              className={`palette-tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => {
                setTab(t.id);
                inputRef.current?.focus();
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="palette-list" id="palette-list" role="listbox" aria-label={t('Results')} ref={listRef}>
          {visible.length === 0 && <p className="palette-empty muted">{emptyText}</p>}
          {visible.map((section) => (
            <div key={section.title} role="group" aria-label={section.title} className="palette-section">
              <div className="palette-heading" aria-hidden="true">
                {section.title}
              </div>
              {section.items.map((item) => {
                index += 1;
                const i = index;
                const hotkey = item.hotkey ? hotkeys[item.hotkey] : null;
                return (
                  <div
                    key={item.key}
                    id={`palette-opt-${i}`}
                    role="option"
                    aria-selected={i === activeIndex}
                    className={`palette-row ${i === activeIndex ? 'is-active' : ''}`}
                    onMouseMove={() => i !== activeIndex && setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={item.run}
                  >
                    <span className="palette-icon">{item.icon}</span>
                    <span className="palette-title">{item.title}</span>
                    {item.detail && <span className="palette-detail muted small">{item.detail}</span>}
                    {hotkey && (
                      <span className="palette-kbd">
                        {hotkeyParts(hotkey).map((part) => (
                          <kbd key={part}>{part}</kbd>
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="palette-footer muted small" aria-hidden="true">
          <span>
            {t('Open')} <kbd>↵</kbd>
          </span>
          <span>
            {t('Move')} <kbd>↑</kbd>
            <kbd>↓</kbd>
          </span>
          <span>
            {t('Change type')} <kbd>Tab</kbd>
          </span>
          <span className="palette-footer-end">
            {t('Close')} <kbd>Esc</kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
