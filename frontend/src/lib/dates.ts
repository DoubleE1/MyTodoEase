import {
  addDays,
  differenceInCalendarDays,
  format,
  isSameYear,
  isValid,
  nextMonday,
  nextSaturday,
  parse,
  startOfDay,
} from 'date-fns';
import { datePattern, t } from '../i18n';

export const DATE_FORMAT = 'yyyy-MM-dd';

export const toDateStr = (date: Date): string => format(date, DATE_FORMAT);
export const todayStr = (): string => toDateStr(new Date());
export const tomorrowStr = (): string => toDateStr(addDays(new Date(), 1));
export const nextWeekStr = (): string => toDateStr(nextMonday(new Date()));
export const weekendStr = (): string => toDateStr(nextSaturday(new Date()));

export function parseDateStr(value: string): Date | null {
  const parsed = parse(value, DATE_FORMAT, new Date());
  return isValid(parsed) ? startOfDay(parsed) : null;
}

export type DueTone = 'overdue' | 'today' | 'tomorrow' | 'week' | 'future';

export interface DueInfo {
  text: string;
  tone: DueTone;
  isOverdue: boolean;
}

/** Human label for a due date, relative to today: "Today", "Tomorrow", "Friday", "24 Oct". */
export function describeDue(dueDate: string, dueTime: string | null): DueInfo | null {
  const date = parseDateStr(dueDate);
  if (!date) return null;
  const today = startOfDay(new Date());
  const diff = differenceInCalendarDays(date, today);

  let text: string;
  let tone: DueTone;
  if (diff < 0) {
    text = format(date, datePattern(isSameYear(date, today) ? 'dayMonth' : 'dayMonthYear'));
    tone = 'overdue';
  } else if (diff === 0) {
    text = t('Today');
    tone = 'today';
  } else if (diff === 1) {
    text = t('Tomorrow');
    tone = 'tomorrow';
  } else if (diff < 7) {
    text = format(date, 'EEEE');
    tone = 'week';
  } else {
    text = format(date, datePattern(isSameYear(date, today) ? 'dayMonth' : 'dayMonthYear'));
    tone = 'future';
  }
  if (dueTime) text += ` ${formatTime(dueTime)}`;
  return { text, tone, isOverdue: diff < 0 };
}

export function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const date = new Date();
  date.setHours(h, m, 0, 0);
  return format(date, datePattern('time'));
}

/** Heading for an Upcoming day group: "Today · Wed 15 Oct". */
export function describeDayHeading(dateStr: string): string {
  const date = parseDateStr(dateStr);
  if (!date) return dateStr;
  const diff = differenceInCalendarDays(date, startOfDay(new Date()));
  const base = format(date, datePattern('weekdayDayMonth'));
  if (diff === 0) return `${t('Today')} · ${base}`;
  if (diff === 1) return `${t('Tomorrow')} · ${base}`;
  return base;
}

/** Sort key so timed tasks come first in chronological order and untimed ones follow. */
export function compareDue(a: { dueDate: string | null; dueTime: string | null }, b: typeof a): number {
  const ad = a.dueDate ?? '9999-99-99';
  const bd = b.dueDate ?? '9999-99-99';
  if (ad !== bd) return ad < bd ? -1 : 1;
  const at = a.dueTime ?? '99:99';
  const bt = b.dueTime ?? '99:99';
  return at < bt ? -1 : at > bt ? 1 : 0;
}
