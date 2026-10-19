import { addDays, addMonths, addWeeks, format, isValid, nextDay, nextMonday, parse, startOfDay } from 'date-fns';
import type { Label, Priority, Project, Recurrence } from '../api/types';
import { DATE_FORMAT } from './dates';

export interface QuickAddResult {
  content: string;
  dueDate?: string;
  dueTime?: string;
  priority?: Priority;
  projectId?: string;
  labelIds: string[];
  /** Labels typed with @ that do not exist yet; the caller creates them. */
  newLabelNames: string[];
  recurrence?: Recurrence;
}

interface Context {
  projects: Project[];
  labels: Label[];
  now?: Date;
}

const WEEKDAYS: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';

/**
 * Todoist-style quick add. Recognised tokens are removed from the content:
 *   p1..p4, #project, @label, today / tomorrow / monday / next week / in 3 days / 2026-10-20 / 20 oct,
 *   at 3pm / 15:00, every day / weekday / week / month / year / every monday.
 */
export function parseQuickAdd(input: string, ctx: Context): QuickAddResult {
  const now = ctx.now ?? new Date();
  const today = startOfDay(now);
  let text = ` ${input} `;
  const result: QuickAddResult = { content: '', labelIds: [], newLabelNames: [] };

  const take = (pattern: RegExp, onMatch: (m: RegExpMatchArray) => boolean | void) => {
    const match = text.match(pattern);
    if (!match) return;
    const keep = onMatch(match);
    if (keep === false) return;
    text = text.replace(pattern, ' ');
  };

  // Priority: p1..p4
  take(/\s[pP]([1-4])(?=\s)/, (m) => {
    result.priority = Number(m[1]) as Priority;
  });

  // Project: #name (first match that exists; unknown names are left in the text)
  for (const m of text.matchAll(/\s#(\S+)(?=\s)/g)) {
    const project = ctx.projects.find((p) => p.name.toLowerCase() === m[1].toLowerCase());
    if (project) {
      result.projectId = project.id;
      text = text.replace(m[0], ' ');
      break;
    }
  }

  // Labels: @name (any number; unknown ones are created by the caller)
  for (const m of [...text.matchAll(/\s@(\S+)(?=\s)/g)]) {
    const name = m[1];
    const label = ctx.labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (label) {
      if (!result.labelIds.includes(label.id)) result.labelIds.push(label.id);
    } else if (!result.newLabelNames.some((n) => n.toLowerCase() === name.toLowerCase())) {
      result.newLabelNames.push(name);
    }
    text = text.replace(m[0], ' ');
  }

  // Recurrence (before dates, so "every monday" can set both)
  take(/\s(every day|daily)(?=\s)/i, () => { result.recurrence = 'daily'; });
  take(/\s(every weekday|weekdays)(?=\s)/i, () => {
    result.recurrence = 'weekdays';
    result.dueDate ??= format(nextWeekdayFrom(today), DATE_FORMAT);
  });
  take(/\s(every (?:2|two|other) weeks?|biweekly|fortnightly)(?=\s)/i, () => { result.recurrence = 'biweekly'; });
  take(/\s(every week|weekly)(?=\s)/i, () => { result.recurrence = 'weekly'; });
  take(/\s(every month|monthly)(?=\s)/i, () => { result.recurrence = 'monthly'; });
  take(/\s(every year|yearly)(?=\s)/i, () => { result.recurrence = 'yearly'; });
  take(/\severy ([a-z]+)(?=\s)/i, (m) => {
    const day = WEEKDAYS[m[1].toLowerCase()];
    if (day === undefined) return false;
    result.recurrence = 'weekly';
    result.dueDate = format(today.getDay() === day ? today : nextDay(today, day), DATE_FORMAT);
  });

  // Time: "at 3pm", "at 15:00", "3:30pm", "15:00"
  take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s)/i, (m) => {
    let hours = Number(m[1]);
    const minutes = Number(m[2] ?? 0);
    const meridiem = m[3].toLowerCase();
    if (hours > 12 || minutes > 59) return false;
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    result.dueTime = `${pad(hours)}:${pad(minutes)}`;
  });
  if (!result.dueTime) {
    take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/, (m) => {
      result.dueTime = `${pad(Number(m[1]))}:${m[2]}`;
    });
  }

  // Dates
  take(/\s(today|tod)(?=\s)/i, () => { result.dueDate = format(today, DATE_FORMAT); });
  take(/\s(tomorrow|tmr|tmrw)(?=\s)/i, () => { result.dueDate = format(addDays(today, 1), DATE_FORMAT); });
  take(/\snext week(?=\s)/i, () => { result.dueDate = format(nextMonday(today), DATE_FORMAT); });
  take(/\snext month(?=\s)/i, () => { result.dueDate = format(addMonths(today, 1), DATE_FORMAT); });
  take(/\sin (\d{1,3}) (day|days|week|weeks|month|months)(?=\s)/i, (m) => {
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    const date = unit.startsWith('day') ? addDays(today, n) : unit.startsWith('week') ? addWeeks(today, n) : addMonths(today, n);
    result.dueDate = format(date, DATE_FORMAT);
  });
  take(/\s(\d{4}-\d{2}-\d{2})(?=\s)/, (m) => {
    const date = parse(m[1], DATE_FORMAT, today);
    if (!isValid(date)) return false;
    result.dueDate = m[1];
  });
  take(new RegExp(`\\s(\\d{1,2})\\s*(${MONTHS})[a-z]*(?=\\s)`, 'i'), (m) => {
    const date = parseDayMonth(Number(m[1]), m[2], today);
    if (!date) return false;
    result.dueDate = format(date, DATE_FORMAT);
  });
  take(new RegExp(`\\s(${MONTHS})[a-z]*\\s+(\\d{1,2})(?=\\s)`, 'i'), (m) => {
    const date = parseDayMonth(Number(m[2]), m[1], today);
    if (!date) return false;
    result.dueDate = format(date, DATE_FORMAT);
  });
  take(/\s(?:on\s+)?(sun|sunday|mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)(?=\s)/i, (m) => {
    const day = WEEKDAYS[m[1].toLowerCase()];
    result.dueDate = format(today.getDay() === day ? today : nextDay(today, day), DATE_FORMAT);
  });

  // A time without a date means today.
  if (result.dueTime && !result.dueDate) result.dueDate = format(today, DATE_FORMAT);

  result.content = text.replace(/\s+/g, ' ').trim();
  return result;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function nextWeekdayFrom(date: Date): Date {
  let d = date;
  while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
  return d;
}

function parseDayMonth(day: number, monthToken: string, today: Date): Date | null {
  const monthIndex = MONTHS.split('|').indexOf(monthToken.toLowerCase().slice(0, 3));
  if (monthIndex < 0 || day < 1 || day > 31) return null;
  // "sept" maps to index 9 in the token list because of the extra alias; normalise to a real month index.
  const realMonth = monthIndex >= 9 ? monthIndex - 1 : monthIndex;
  let date = new Date(today.getFullYear(), realMonth, day);
  if (!isValid(date) || date.getDate() !== day) return null;
  if (date < today) date = new Date(today.getFullYear() + 1, realMonth, day);
  return date;
}
