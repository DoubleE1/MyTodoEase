import { parseISO } from 'date-fns';
import type { CompletionItem } from '../api/types';

/** Rows Monday..Sunday, columns 0..23 (local hours). */
export type HourGrid = number[][];

/** Below this many completions the "best time" summary would be guesswork, so it is not shown. */
export const MIN_FOR_SUMMARY = 20;

/** Count completions by weekday (Monday first) and hour, in the user's local time zone. */
export function bucketByHour(items: Pick<CompletionItem, 'completedAt'>[]): HourGrid {
  const grid: HourGrid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const item of items) {
    const when = parseISO(item.completedAt);
    if (Number.isNaN(when.getTime())) continue;
    const row = (when.getDay() + 6) % 7; // getDay: Sunday = 0
    grid[row][when.getHours()] += 1;
  }
  return grid;
}

export function maxOf(grid: HourGrid): number {
  return Math.max(0, ...grid.flat());
}

/** 0 = none, 1..4 = quarters of the busiest slot (the same scale as the year heatmap's levels). */
export function hourLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4)));
}

const PARTS = [
  { name: 'early morning', from: 5, to: 9 },
  { name: 'morning', from: 9, to: 12 },
  { name: 'afternoon', from: 12, to: 17 },
  { name: 'evening', from: 17, to: 21 },
  { name: 'night', from: 21, to: 29 }, // 21:00–05:00 wraps past midnight
];

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * The weekday and part of the day with the most completions, e.g. { day: 'Tuesday', part: 'morning' }.
 * Null when there is too little history to say.
 */
export function bestSlot(grid: HourGrid): { day: string; part: string; count: number } | null {
  if (grid.flat().reduce((a, b) => a + b, 0) < MIN_FOR_SUMMARY) return null;
  let best: { day: string; part: string; count: number } | null = null;
  grid.forEach((hours, row) => {
    for (const part of PARTS) {
      let count = 0;
      for (let h = part.from; h < part.to; h++) count += hours[h % 24];
      if (!best || count > best.count) best = { day: DAY_NAMES[row], part: part.name, count };
    }
  });
  return best;
}

/** "9–10 am", "12–1 pm", "11 pm–12 am" for an hour cell's label. */
export function hourRange(hour: number): string {
  const label = (h: number) => {
    const twelve = h % 12 === 0 ? 12 : h % 12;
    return { n: twelve, ap: h % 24 < 12 ? 'am' : 'pm' };
  };
  const a = label(hour);
  const b = label(hour + 1);
  return a.ap === b.ap ? `${a.n}–${b.n} ${b.ap}` : `${a.n} ${a.ap}–${b.n} ${b.ap}`;
}
