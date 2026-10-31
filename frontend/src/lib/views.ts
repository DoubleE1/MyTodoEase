import type { Label, Project, Task } from '../api/types';
import { compareDue, todayStr } from './dates';
import { t } from '../i18n';

export type View =
  | { kind: 'home' }
  | { kind: 'inbox' }
  | { kind: 'today' }
  | { kind: 'upcoming' }
  | { kind: 'calendar' }
  | { kind: 'notes' }
  | { kind: 'insights' }
  | { kind: 'completed' }
  | { kind: 'achievements' }
  | { kind: 'shop' }
  | { kind: 'project'; projectId: string }
  | { kind: 'label'; labelId: string }
  | { kind: 'search'; query: string };

export function viewEquals(a: View, b: View): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'project' && b.kind === 'project') return a.projectId === b.projectId;
  if (a.kind === 'label' && b.kind === 'label') return a.labelId === b.labelId;
  if (a.kind === 'search' && b.kind === 'search') return a.query === b.query;
  return true;
}

export function viewTitle(view: View, projects: Project[], labels: Label[]): string {
  switch (view.kind) {
    case 'home':
      return t('Home');
    case 'inbox':
      return t('Inbox');
    case 'today':
      return t('Today');
    case 'upcoming':
      return t('Upcoming');
    case 'calendar':
      return t('Calendar');
    case 'notes':
      return t('Notes');
    case 'insights':
      return t('Insights');
    case 'completed':
      return t('Completed');
    case 'achievements':
      return t('Achievements');
    case 'shop':
      return t('Shop');
    case 'project':
      return projects.find((p) => p.id === view.projectId)?.name ?? t('Project');
    case 'label':
      return labels.find((l) => l.id === view.labelId)?.name ?? t('Label');
    case 'search':
      return t('Search: {query}', { query: view.query });
  }
}

export const isOverdue = (task: Task, today = todayStr()): boolean => !!task.dueDate && task.dueDate < today;
export const isDueToday = (task: Task, today = todayStr()): boolean => task.dueDate === today;

/** Default sort for list views: timed/dated first, then priority, then manual order. */
export function sortForAgenda(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => compareDue(a, b) || a.priority - b.priority || a.order - b.order);
}

export function sortByOrder(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

export function matchesSearch(task: Task, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return task.content.toLowerCase().includes(q) || task.description.toLowerCase().includes(q);
}
