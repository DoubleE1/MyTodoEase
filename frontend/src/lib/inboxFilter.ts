import { useSyncExternalStore } from 'react';
import type { Project, Task } from '../api/types';

/**
 * The Inbox page's project filter: 'all' shows open tasks from every project (grouped by project), or one
 * project's id narrows it to that project. Remembered on this device; the sidebar count and quick add follow it.
 */
export type InboxFilter = 'all' | string;

const STORAGE_KEY = 'todoease.inbox.filter';
const listeners = new Set<() => void>();

function read(): InboxFilter {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'all';
  } catch {
    return 'all';
  }
}

let current: InboxFilter = read();

export function setInboxFilter(filter: InboxFilter) {
  current = filter;
  try {
    localStorage.setItem(STORAGE_KEY, filter);
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
  listeners.forEach((l) => l());
}

/** The filter in effect; a remembered project that no longer exists falls back to 'all'. */
export function useInboxFilter(projects: Project[]): InboxFilter {
  const filter = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
  return filter === 'all' || projects.length === 0 || projects.some((p) => p.id === filter) ? filter : 'all';
}

/** Tasks the Inbox page shows for a filter (the caller's list is already open tasks only). */
export function inboxTasks(tasks: Task[], filter: InboxFilter): Task[] {
  return filter === 'all' ? tasks : tasks.filter((t) => t.projectId === filter);
}
