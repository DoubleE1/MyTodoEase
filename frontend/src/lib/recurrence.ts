import { addDays, addMonths, addYears, format, isSaturday, isSunday } from 'date-fns';
import type { Recurrence, Task } from '../api/types';
import { DATE_FORMAT, parseDateStr } from './dates';

/**
 * Client-side mirror of the API's RecurrenceService.Step, used to preview future occurrences.
 * A recurring task is still one task that rolls forward when completed; these previews are
 * only drawn on the calendar so the user can see where it will land next.
 */
export function stepDate(date: Date, recurrence: Recurrence): Date {
  switch (recurrence) {
    case 'daily':
      return addDays(date, 1);
    case 'weekdays': {
      let next = addDays(date, 1);
      while (isSaturday(next) || isSunday(next)) next = addDays(next, 1);
      return next;
    }
    case 'weekly':
      return addDays(date, 7);
    case 'biweekly':
      return addDays(date, 14);
    case 'monthly':
      return addMonths(date, 1);
    case 'yearly':
      return addYears(date, 1);
    default:
      return addDays(date, 1);
  }
}

const MAX_STEPS = 400;

/** Dates (yyyy-MM-dd) after the task's own due date, within [from, to], where it will recur. */
export function projectedOccurrences(task: Task, from: string, to: string): string[] {
  if (task.recurrence === 'none' || !task.dueDate || task.isCompleted) return [];
  const start = parseDateStr(task.dueDate);
  if (!start) return [];
  const out: string[] = [];
  let cursor = start;
  for (let i = 0; i < MAX_STEPS; i++) {
    cursor = stepDate(cursor, task.recurrence);
    const key = format(cursor, DATE_FORMAT);
    if (key > to) break;
    if (key >= from) out.push(key);
  }
  return out;
}
