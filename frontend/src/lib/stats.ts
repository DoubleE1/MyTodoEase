import { differenceInCalendarDays, parseISO, startOfDay, subDays } from 'date-fns';
import type { CompletionItem } from '../api/types';
import { toDateStr } from './dates';

/** Completions bucketed by the user's local calendar day (yyyy-MM-dd → count). */
export function completionsPerDay(items: CompletionItem[]): Map<string, number> {
  const perDay = new Map<string, number>();
  for (const item of items) {
    const day = toDateStr(parseISO(item.completedAt));
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  return perDay;
}

/**
 * Consecutive days with at least one completion, counting back from today
 * (or from yesterday when today is still empty, so a streak is not "lost" before the day is over).
 */
export function currentStreak(perDay: Map<string, number>, now = new Date()): number {
  const todayStart = startOfDay(now);
  let streak = 0;
  let cursor = (perDay.get(toDateStr(todayStart)) ?? 0) > 0 ? todayStart : subDays(todayStart, 1);
  while ((perDay.get(toDateStr(cursor)) ?? 0) > 0) {
    streak += 1;
    cursor = subDays(cursor, 1);
    if (differenceInCalendarDays(todayStart, cursor) > 4000) break; // safety for runaway data
  }
  return streak;
}

/** Longest run of consecutive days with completions among the given days. */
export function longestStreak(perDay: Map<string, number>): { length: number; end: string | null } {
  const days = [...perDay.entries()]
    .filter(([, count]) => count > 0)
    .map(([day]) => day)
    .sort();
  let best = { length: 0, end: null as string | null };
  let run = 0;
  let previous: Date | null = null;
  for (const day of days) {
    const date = parseISO(day);
    run = previous && differenceInCalendarDays(date, previous) === 1 ? run + 1 : 1;
    if (run > best.length) best = { length: run, end: day };
    previous = date;
  }
  return best;
}
