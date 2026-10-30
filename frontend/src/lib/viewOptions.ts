import { useSyncExternalStore } from 'react';
import type { Task } from '../api/types';
import { compareDue } from './dates';
import { sortForAgenda, type View } from './views';

/**
 * Per-page display options for task lists ("View options" menu). 'default' keeps the page's own layout:
 * sections in a project, projects in the Inbox, days in Today/Upcoming, manual or due-date order.
 * Remembered per page on this device.
 */
export type GroupBy = 'default' | 'none' | 'project' | 'date' | 'priority' | 'label';
export type SortBy = 'default' | 'date' | 'priority' | 'name' | 'added';

export interface ViewOptions {
  groupBy: GroupBy;
  sortBy: SortBy;
}

export const DEFAULT_VIEW_OPTIONS: ViewOptions = { groupBy: 'default', sortBy: 'default' };

const STORAGE_KEY = 'todoease.viewOptions';
const listeners = new Set<() => void>();

function read(): Record<string, ViewOptions> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, ViewOptions>) : {};
  } catch {
    return {};
  }
}

let current = read();

/** Pages that share options: every search shares one entry; projects and labels each get their own. */
export function viewOptionsKey(view: View): string {
  if (view.kind === 'project') return `project:${view.projectId}`;
  if (view.kind === 'label') return `label:${view.labelId}`;
  return view.kind;
}

export function setViewOptions(key: string, options: ViewOptions) {
  const next = { ...current };
  if (options.groupBy === 'default' && options.sortBy === 'default') delete next[key];
  else next[key] = options;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
  listeners.forEach((l) => l());
}

export function useViewOptions(key: string): ViewOptions {
  const all = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
  return all[key] ?? DEFAULT_VIEW_OPTIONS;
}

const byName = (a: Task, b: Task) => a.content.localeCompare(b.content, undefined, { numeric: true, sensitivity: 'base' });

/** Applies a non-default sort; ties fall back to due date, then manual order. */
export function sortTasks(tasks: Task[], sortBy: Exclude<SortBy, 'default'>): Task[] {
  switch (sortBy) {
    case 'date':
      return sortForAgenda(tasks);
    case 'priority':
      return [...tasks].sort((a, b) => a.priority - b.priority || compareDue(a, b) || a.order - b.order);
    case 'name':
      return [...tasks].sort((a, b) => byName(a, b) || a.order - b.order);
    case 'added':
      // Newest first: the task you just captured is at the top.
      return [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
