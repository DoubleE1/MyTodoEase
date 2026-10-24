/**
 * Data behind the Insights "World" view: growth tiers for the heatmap's days and the streak days that get
 * celebrated. Pure functions; the isometric drawing lives in components/WorldView.tsx.
 */
import { startOfDay, subDays } from 'date-fns';
import { toDateStr } from './dates';
import { currentStreak } from './stats';

/** Growth tier of a day: 0 bare, 1 sprout (1 task), 2 sapling (2–3), 3 tree (4–6), 4 landmark (7+). */
export type WorldLevel = 0 | 1 | 2 | 3 | 4;

/** Same thresholds as the heatmap's colour levels, so Grid and World agree on what a "busy day" is. */
export function completionLevel(count: number): WorldLevel {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

/** Streaks shorter than this are not celebrated in the world. */
export const STREAK_CELEBRATION_MIN = 7;

/** Days in the current streak, most recent first (today, or yesterday when today is still empty). */
export function currentStreakDays(perDay: Map<string, number>, today: Date = new Date()): string[] {
  const length = currentStreak(perDay, today);
  const todayStart = startOfDay(today);
  const anchor = (perDay.get(toDateStr(todayStart)) ?? 0) > 0 ? todayStart : subDays(todayStart, 1);
  const days: string[] = [];
  for (let i = 0; i < length; i += 1) days.push(toDateStr(subDays(anchor, i)));
  return days;
}

/** The streak days worth a glow: the whole current streak once it reaches the celebration length. */
export function celebratedStreakDays(perDay: Map<string, number>, today: Date = new Date()): Set<string> {
  const days = currentStreakDays(perDay, today);
  return new Set(days.length >= STREAK_CELEBRATION_MIN ? days : []);
}
