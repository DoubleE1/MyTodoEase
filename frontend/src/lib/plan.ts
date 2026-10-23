import type { ExternalEvent, Task } from '../api/types';

/** Minutes since midnight for "HH:mm". */
export const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

export const toTime = (minutes: number): string => {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export const DEFAULT_DURATION = 30;
export const SNAP_MINUTES = 15;
export const WORK_START = 9 * 60;
export const WORK_END = 18 * 60;

export const taskDuration = (task: Pick<Task, 'durationMinutes'>): number => task.durationMinutes ?? DEFAULT_DURATION;

export interface Busy {
  start: number;
  end: number;
}

/** Busy minutes on a day from timed Google events and timed tasks. */
export function busyIntervals(date: string, tasks: Task[], events: ExternalEvent[]): Busy[] {
  const busy: Busy[] = [];
  for (const e of events) {
    if (e.allDay || !e.startTime) continue;
    const spansDay = e.date <= date && date <= e.endDate;
    if (!spansDay) continue;
    const start = e.date === date ? toMinutes(e.startTime) : 0;
    const end = e.endDate === date && e.endTime ? toMinutes(e.endTime) : 24 * 60;
    if (end > start) busy.push({ start, end });
  }
  for (const t of tasks) {
    if (t.isCompleted || t.dueDate !== date || !t.dueTime) continue;
    const start = toMinutes(t.dueTime);
    busy.push({ start, end: start + taskDuration(t) });
  }
  return busy.sort((a, b) => a.start - b.start);
}

export interface PlanResult {
  placed: { task: Task; dueTime: string }[];
  unplaced: Task[];
}

/**
 * "Plan my day": give today's undated-time tasks (and overdue ones) a time slot in the free gaps
 * between meetings and already-timed tasks, highest priority first, inside working hours.
 */
export function planDay(options: {
  date: string;
  tasks: Task[];
  events: ExternalEvent[];
  now?: Date;
  workStart?: number;
  workEnd?: number;
}): PlanResult {
  const { date, tasks, events } = options;
  const workStart = options.workStart ?? WORK_START;
  const workEnd = options.workEnd ?? WORK_END;
  const now = options.now ?? new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const candidates = tasks
    .filter((t) => !t.isCompleted && t.dueDate !== null && ((t.dueDate === date && !t.dueTime) || t.dueDate < date))
    .sort((a, b) => a.priority - b.priority || (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.order - b.order);

  const busy = busyIntervals(date, tasks, events);
  let cursor = workStart;
  if (date === todayStr) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    cursor = Math.max(cursor, Math.ceil(nowMinutes / SNAP_MINUTES) * SNAP_MINUTES);
  }

  const placed: PlanResult['placed'] = [];
  const unplaced: Task[] = [];
  for (const task of candidates) {
    const duration = taskDuration(task);
    let start = cursor;
    let found: number | null = null;
    while (start + duration <= workEnd) {
      const clash = busy.find((b) => b.start < start + duration && start < b.end);
      if (!clash) {
        found = start;
        break;
      }
      start = Math.ceil(clash.end / SNAP_MINUTES) * SNAP_MINUTES;
    }
    if (found === null) {
      unplaced.push(task);
      continue;
    }
    busy.push({ start: found, end: found + duration });
    busy.sort((a, b) => a.start - b.start);
    placed.push({ task, dueTime: toTime(found) });
    cursor = found + duration;
  }
  return { placed, unplaced };
}

/**
 * Lay overlapping blocks side by side: items in the same overlap cluster share the width.
 * Returns, per item, its lane and the lane count of its cluster.
 */
export function layoutLanes<T extends { start: number; end: number }>(items: T[]): { item: T; lane: number; lanes: number }[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const result: { item: T; lane: number; lanes: number }[] = [];
  let cluster: { item: T; lane: number }[] = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];

  const flush = () => {
    const lanes = laneEnds.length || 1;
    for (const entry of cluster) result.push({ ...entry, lanes });
    cluster = [];
    laneEnds.length = 0;
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.start >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[lane] = item.end;
    }
    cluster.push({ item, lane });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return result;
}
