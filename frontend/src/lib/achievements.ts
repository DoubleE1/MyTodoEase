import { addDays, differenceInCalendarDays, format, getISOWeek, getISOWeekYear, parseISO, startOfDay } from 'date-fns';
import { useSyncExternalStore } from 'react';
import type { CompletionItem, Label, Note, Project, Section, Task } from '../api/types';

/**
 * Achievements and points (docs/ACHIEVEMENTS.md). Every achievement pays its points once; all 50 are worth
 * 10,000, enough for one or two skins. Most are worked out from the account's own data (completion history,
 * tasks, notes), so they unlock the same on every device. A few count things done in the app on this device
 * (opening search, docking, changing a shortcut); those counters live in this browser's storage.
 */

export type Category = 'start' | 'milestones' | 'streaks' | 'habits' | 'planning' | 'notes' | 'insights' | 'hidden';

export const CATEGORY_TITLES: Record<Category, string> = {
  start: 'Getting started',
  milestones: 'Completion milestones',
  streaks: 'Streaks',
  habits: 'Habits',
  planning: 'Planning and organising',
  notes: 'Notes and capture',
  insights: 'Insights and World',
  hidden: 'Hidden',
};

/** Everything an achievement can look at. Built once per render from the queries. */
export interface AchievementData {
  now: Date;
  activeTasks: Task[];
  completedTasks: Task[];
  completions: CompletionItem[];
  projects: Project[];
  sections: Section[];
  labels: Label[];
  notes: Note[];
  calendarConnected: boolean;
  customized: { theme: boolean; shortcuts: boolean };
  events: Record<EventName, number>;
  /** Days (yyyy-MM-dd) this device saw nothing overdue. */
  clearDays: string[];
  /** Days Insights was opened on this device. */
  insightsDays: string[];
}

export interface AchievementDef {
  id: string;
  category: Category;
  name: string;
  /** How to unlock it, shown on the card. */
  description: string;
  points: number;
  hidden?: boolean;
  /** Progress towards the goal; done when current >= target. */
  progress: (d: Derived) => { current: number; target: number };
}

// ---------- Things counted on this device ----------

export type EventName = 'paletteOpened' | 'planDay' | 'undo' | 'docked' | 'notePopped' | 'quickAddWords';

const EVENTS_KEY = 'todoease.achievements.events';
const UNLOCKED_KEY = 'todoease.achievements.unlocked';
const CLEAR_DAYS_KEY = 'todoease.achievements.clearDays';
const INSIGHTS_DAYS_KEY = 'todoease.achievements.insightsDays';
const listeners = new Set<() => void>();

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: counted for this session only.
  }
}

interface LocalState {
  events: Record<EventName, number>;
  unlocked: Record<string, string>;
  clearDays: string[];
  insightsDays: string[];
}

let local: LocalState = {
  events: readJson(EVENTS_KEY, {} as Record<EventName, number>),
  unlocked: readJson(UNLOCKED_KEY, {} as Record<string, string>),
  clearDays: readJson(CLEAR_DAYS_KEY, [] as string[]),
  insightsDays: readJson(INSIGHTS_DAYS_KEY, [] as string[]),
};

function changed(next: LocalState) {
  local = next;
  listeners.forEach((l) => l());
}

/** Count something done in the app (search opened, Plan my day, …). */
export function recordEvent(name: EventName, by = 1) {
  const events = { ...local.events, [name]: (local.events[name] ?? 0) + by };
  writeJson(EVENTS_KEY, events);
  changed({ ...local, events });
}

function rememberDay(key: string, list: string[], day: string): string[] | null {
  if (list.includes(day)) return null;
  // Keep the last 400 days; older ones can no longer affect a 7-day run.
  const next = [...list, day].sort().slice(-400);
  writeJson(key, next);
  return next;
}

/** Today had nothing overdue (counted for "Clean slate"). */
export function recordClearDay(day: string) {
  const next = rememberDay(CLEAR_DAYS_KEY, local.clearDays, day);
  if (next) changed({ ...local, clearDays: next });
}

/** Insights was opened today (counted for "Self-aware"). */
export function recordInsightsVisit(day: string) {
  const next = rememberDay(INSIGHTS_DAYS_KEY, local.insightsDays, day);
  if (next) changed({ ...local, insightsDays: next });
}

/** Store newly unlocked achievements with the time they unlocked. */
export function markUnlocked(ids: string[], at: string) {
  if (ids.length === 0) return;
  const unlocked = { ...local.unlocked };
  for (const id of ids) unlocked[id] ??= at;
  writeJson(UNLOCKED_KEY, unlocked);
  changed({ ...local, unlocked });
}

export function useAchievementStore(): LocalState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => local,
  );
}

// ---------- Derived facts ----------

/** Completions only count when the task existed for at least this long first (anti-farming). */
const MIN_AGE_MS = 5 * 60 * 1000;
/** At most this many completions a day count towards the completion milestones. */
const DAILY_CAP = 30;

interface Derived extends AchievementData {
  /** Completions that pass the age rule, with local day and hour. */
  counted: { day: string; hour: number; taskId: string; projectId: string }[];
  perDay: Map<string, number>;
  cappedTotal: number;
  longestStreak: number;
  hadComeback: boolean;
  allTasks: Task[];
}

const dayOf = (date: Date) => format(date, 'yyyy-MM-dd');

/** Longest run of consecutive days in a sorted list of yyyy-MM-dd strings. */
function longestRun(days: string[]): number {
  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const day of days) {
    const date = parseISO(day);
    run = prev && differenceInCalendarDays(date, prev) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = date;
  }
  return best;
}

export function derive(data: AchievementData): Derived {
  const allTasks = [...data.activeTasks, ...data.completedTasks];
  const createdAt = new Map(allTasks.map((t) => [t.id, parseISO(t.createdAt).getTime()]));
  const counted = data.completions
    .filter((c) => {
      const created = createdAt.get(c.taskId);
      // A task we no longer have (deleted) cannot be checked; it counts.
      return created === undefined || parseISO(c.completedAt).getTime() - created >= MIN_AGE_MS;
    })
    .map((c) => {
      const when = parseISO(c.completedAt);
      return { day: dayOf(when), hour: when.getHours(), taskId: c.taskId, projectId: c.projectId };
    });
  const perDay = new Map<string, number>();
  for (const c of counted) perDay.set(c.day, (perDay.get(c.day) ?? 0) + 1);
  const days = [...perDay.keys()].sort();

  let cappedTotal = 0;
  for (const count of perDay.values()) cappedTotal += Math.min(DAILY_CAP, count);

  // Comeback: a run of 7+ days ended, and a new one started after missing only one or two days.
  let hadComeback = false;
  let run = 0;
  let prev: Date | null = null;
  for (const day of days) {
    const date = parseISO(day);
    const gap = prev ? differenceInCalendarDays(date, prev) : 0;
    if (prev && gap > 1 && gap <= 3 && run >= 7) hadComeback = true;
    run = prev && gap === 1 ? run + 1 : 1;
    prev = date;
  }

  return { ...data, counted, perDay, cappedTotal, longestStreak: longestRun(days), hadComeback, allTasks };
}

// ---------- The 50 achievements ----------

const count = (current: number, target: number) => ({ current: Math.min(current, target), target });
const flag = (done: boolean) => ({ current: done ? 1 : 0, target: 1 });

function perfectWeeks(d: Derived): number {
  const byWeek = new Map<string, { onTime: number; late: number }>();
  for (const t of d.completedTasks) {
    if (!t.dueDate || !t.completedAt) continue;
    const due = parseISO(t.dueDate);
    const key = `${getISOWeekYear(due)}-${getISOWeek(due)}`;
    const week = byWeek.get(key) ?? { onTime: 0, late: 0 };
    if (dayOf(parseISO(t.completedAt)) <= t.dueDate) week.onTime += 1;
    else week.late += 1;
    byWeek.set(key, week);
  }
  // Still-open tasks due in a past week spoil that week.
  const today = dayOf(d.now);
  for (const t of d.activeTasks) {
    if (!t.dueDate || t.dueDate >= today) continue;
    const due = parseISO(t.dueDate);
    const key = `${getISOWeekYear(due)}-${getISOWeek(due)}`;
    const week = byWeek.get(key) ?? { onTime: 0, late: 0 };
    week.late += 1;
    byWeek.set(key, week);
  }
  return [...byWeek.values()].filter((w) => w.late === 0 && w.onTime >= 10).length;
}

function weekendsWithCompletions(d: Derived): number {
  const weekends = new Set<string>();
  for (const day of d.perDay.keys()) {
    const date = parseISO(day);
    const weekday = date.getDay();
    if (weekday === 0 || weekday === 6) {
      const saturday = weekday === 6 ? date : addDays(date, -1);
      weekends.add(dayOf(saturday));
    }
  }
  return weekends.size;
}

function bestYearActiveDays(d: Derived): number {
  const byYear = new Map<string, number>();
  for (const day of d.perDay.keys()) byYear.set(day.slice(0, 4), (byYear.get(day.slice(0, 4)) ?? 0) + 1);
  return Math.max(0, ...byYear.values());
}

function finishedBigTasks(d: Derived): number {
  const open = new Set(d.activeTasks.map((t) => t.parentId).filter(Boolean));
  const doneChildren = new Map<string, number>();
  for (const t of d.completedTasks) if (t.parentId) doneChildren.set(t.parentId, (doneChildren.get(t.parentId) ?? 0) + 1);
  return d.completedTasks.filter((t) => (doneChildren.get(t.id) ?? 0) >= 5 && !open.has(t.id)).length;
}

function finishedProjects(d: Derived): number {
  return d.projects.filter((p) => {
    const done = d.completedTasks.filter((t) => t.projectId === p.id).length;
    const open = d.activeTasks.some((t) => t.projectId === p.id);
    return !p.isInbox && done >= 10 && !open;
  }).length;
}

function maxRepeats(d: Derived): number {
  const repeating = new Set(d.allTasks.filter((t) => t.recurrence !== 'none').map((t) => t.id));
  const byTask = new Map<string, number>();
  for (const c of d.counted) if (repeating.has(c.taskId)) byTask.set(c.taskId, (byTask.get(c.taskId) ?? 0) + 1);
  return Math.max(0, ...byTask.values());
}

function bestLabelUse(d: Derived): number {
  const uses = new Map<string, number>();
  for (const t of d.allTasks) for (const id of t.labelIds) uses.set(id, (uses.get(id) ?? 0) + 1);
  return Math.max(0, ...uses.values());
}

function inboxZeroToday(d: Derived): boolean {
  const inbox = d.projects.find((p) => p.isInbox);
  if (!inbox) return false;
  const today = dayOf(d.now);
  const doneToday = d.counted.filter((c) => c.day === today && c.projectId === inbox.id).length;
  return doneToday >= 5 && !d.activeTasks.some((t) => t.projectId === inbox.id);
}

function daysSinceFirstUse(d: Derived): number {
  const firsts = [
    ...d.allTasks.map((t) => t.createdAt),
    ...d.completions.map((c) => c.completedAt),
  ].sort();
  return firsts.length ? differenceInCalendarDays(startOfDay(d.now), startOfDay(parseISO(firsts[0]))) : 0;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  // Getting started (180)
  { id: 'first-step', category: 'start', name: 'First step', description: 'Complete your first task', points: 20, progress: (d) => count(d.counted.length, 1) },
  { id: 'captured', category: 'start', name: 'Captured', description: 'Add 10 tasks', points: 20, progress: (d) => count(d.allTasks.length, 10) },
  { id: 'organiser', category: 'start', name: 'Organiser', description: 'Create your first project', points: 20, progress: (d) => count(d.projects.filter((p) => !p.isInbox).length, 1) },
  { id: 'tagged', category: 'start', name: 'Tagged', description: 'Use one label on 3 tasks', points: 30, progress: (d) => count(bestLabelUse(d), 3) },
  { id: 'sectioned', category: 'start', name: 'Sectioned', description: 'Add a section to a project', points: 20, progress: (d) => count(d.sections.length, 1) },
  { id: 'make-it-yours', category: 'start', name: 'Make it yours', description: 'Change the theme or accent colour', points: 20, progress: (d) => flag(d.customized.theme) },
  { id: 'shortcut-savvy', category: 'start', name: 'Shortcut savvy', description: 'Open search with Ctrl+K 10 times', points: 30, progress: (d) => count(d.events.paletteOpened ?? 0, 10) },
  { id: 'sticky-start', category: 'start', name: 'Sticky start', description: 'Write your first sticky note', points: 20, progress: (d) => count(d.notes.length, 1) },

  // Completion milestones (2,600)
  { id: 'done-10', category: 'milestones', name: 'Getting going', description: 'Complete 10 tasks', points: 50, progress: (d) => count(d.cappedTotal, 10) },
  { id: 'done-50', category: 'milestones', name: 'Half century', description: 'Complete 50 tasks', points: 100, progress: (d) => count(d.cappedTotal, 50) },
  { id: 'done-100', category: 'milestones', name: 'Centurion', description: 'Complete 100 tasks', points: 150, progress: (d) => count(d.cappedTotal, 100) },
  { id: 'done-250', category: 'milestones', name: 'Quarter thousand', description: 'Complete 250 tasks', points: 250, progress: (d) => count(d.cappedTotal, 250) },
  { id: 'done-500', category: 'milestones', name: 'Machine', description: 'Complete 500 tasks', points: 400, progress: (d) => count(d.cappedTotal, 500) },
  { id: 'done-1000', category: 'milestones', name: 'Thousandaire', description: 'Complete 1,000 tasks', points: 600, progress: (d) => count(d.cappedTotal, 1000) },
  { id: 'done-2500', category: 'milestones', name: 'Legend of done', description: 'Complete 2,500 tasks', points: 900, progress: (d) => count(d.cappedTotal, 2500) },
  { id: 'p1-slayer', category: 'milestones', name: 'P1 slayer', description: 'Complete 25 Priority 1 tasks', points: 150, progress: (d) => count(d.completedTasks.filter((t) => t.priority === 1).length, 25) },

  // Streaks (4,250)
  { id: 'streak-3', category: 'streaks', name: 'Warm-up', description: 'Reach a 3-day streak', points: 50, progress: (d) => count(d.longestStreak, 3) },
  { id: 'streak-7', category: 'streaks', name: 'One week', description: 'Reach a 7-day streak', points: 150, progress: (d) => count(d.longestStreak, 7) },
  { id: 'streak-14', category: 'streaks', name: 'Fortnight', description: 'Reach a 14-day streak', points: 250, progress: (d) => count(d.longestStreak, 14) },
  { id: 'streak-30', category: 'streaks', name: 'Month strong', description: 'Reach a 30-day streak', points: 500, progress: (d) => count(d.longestStreak, 30) },
  { id: 'streak-60', category: 'streaks', name: 'Two months', description: 'Reach a 60-day streak', points: 750, progress: (d) => count(d.longestStreak, 60) },
  { id: 'streak-100', category: 'streaks', name: 'Hundred days', description: 'Reach a 100-day streak', points: 1000, progress: (d) => count(d.longestStreak, 100) },
  { id: 'streak-365', category: 'streaks', name: 'Year of done', description: 'Reach a 365-day streak', points: 1500, progress: (d) => count(d.longestStreak, 365) },
  { id: 'comeback', category: 'streaks', name: 'Comeback', description: 'Start a new streak within 2 days of losing one of 7+ days', points: 50, progress: (d) => flag(d.hadComeback) },

  // Habits (900)
  { id: 'inbox-zero', category: 'habits', name: 'Inbox zero', description: 'Empty your Inbox after completing at least 5 of its tasks that day', points: 100, progress: (d) => flag(inboxZeroToday(d)) },
  { id: 'clean-slate', category: 'habits', name: 'Clean slate', description: 'End 7 days in a row with nothing overdue', points: 200, progress: (d) => count(longestRun(d.clearDays), 7) },
  { id: 'planner', category: 'habits', name: 'Planner', description: 'Use Plan my day 10 times', points: 100, progress: (d) => count(d.events.planDay ?? 0, 10) },
  { id: 'early-bird', category: 'habits', name: 'Early bird', description: 'Complete 20 tasks before 9 am', points: 100, progress: (d) => count(d.counted.filter((c) => c.hour < 9).length, 20) },
  { id: 'weekend-warrior', category: 'habits', name: 'Weekend warrior', description: 'Complete tasks on 10 different weekends', points: 100, progress: (d) => count(weekendsWithCompletions(d), 10) },
  { id: 'perfect-week', category: 'habits', name: 'Perfect week', description: 'Complete every task due in a week on time (at least 10)', points: 300, progress: (d) => count(perfectWeeks(d), 1) },

  // Planning and organising (830)
  { id: 'on-repeat', category: 'planning', name: 'On repeat', description: 'Create 5 repeating tasks', points: 50, progress: (d) => count(d.allTasks.filter((t) => t.recurrence !== 'none').length, 5) },
  { id: 'ritual', category: 'planning', name: 'Ritual', description: 'Complete one repeating task 30 times', points: 200, progress: (d) => count(maxRepeats(d), 30) },
  { id: 'time-blocker', category: 'planning', name: 'Time blocker', description: 'Give 20 tasks a time on the calendar', points: 100, progress: (d) => count(d.allTasks.filter((t) => t.dueTime).length, 20) },
  { id: 'long-haul', category: 'planning', name: 'Long haul', description: 'Create a multi-day task', points: 30, progress: (d) => flag(d.allTasks.some((t) => t.startDate)) },
  { id: 'synced', category: 'planning', name: 'Synced', description: 'Connect Google Calendar', points: 50, progress: (d) => flag(d.calendarConnected) },
  { id: 'broken-down', category: 'planning', name: 'Broken down', description: 'Finish a task whose 5+ sub-tasks are all done', points: 100, progress: (d) => count(finishedBigTasks(d), 1) },
  { id: 'project-finisher', category: 'planning', name: 'Project finisher', description: 'Complete every task in a project of 10+ tasks', points: 200, progress: (d) => count(finishedProjects(d), 1) },
  { id: 'ahead-of-time', category: 'planning', name: 'Ahead of time', description: 'Complete 25 tasks before their due date', points: 100, progress: (d) => count(d.completedTasks.filter((t) => t.dueDate && t.completedAt && dayOf(parseISO(t.completedAt)) < t.dueDate).length, 25) },

  // Notes and capture (330)
  { id: 'brain-dump', category: 'notes', name: 'Brain dump', description: 'Write 10 sticky notes', points: 50, progress: (d) => count(d.notes.length, 10) },
  { id: 'thought-to-action', category: 'notes', name: 'Thought to action', description: 'Turn one note into 3+ tasks', points: 50, progress: (d) => flag(d.notes.some((n) => n.taskIds.length >= 3)) },
  { id: 'note-keeper', category: 'notes', name: 'Note keeper', description: 'Create 25 tasks from notes in total', points: 100, progress: (d) => count(d.notes.reduce((n, note) => n + note.taskIds.length, 0), 25) },
  { id: 'on-the-desk', category: 'notes', name: 'On the desk', description: 'Pop a note out into its own window (desktop)', points: 30, progress: (d) => count(d.events.notePopped ?? 0, 1) },
  { id: 'quick-draw', category: 'notes', name: 'Quick draw', description: 'Add 50 tasks using quick-add words (#project, @label, dates, p1–p4)', points: 100, progress: (d) => count(d.events.quickAddWords ?? 0, 50) },

  // Insights and World (500)
  { id: 'self-aware', category: 'insights', name: 'Self-aware', description: 'Open Insights on 7 different days', points: 50, progress: (d) => count(d.insightsDays.length, 7) },
  { id: 'green-year', category: 'insights', name: 'Green year', description: 'Have 100 days with a completion in one calendar year', points: 300, progress: (d) => count(bestYearActiveDays(d), 100) },
  { id: 'world-builder', category: 'insights', name: 'World builder', description: 'Grow 30 things in your Insights World (30 active days)', points: 150, progress: (d) => count(d.perDay.size, 30) },

  // Hidden (410)
  { id: 'oops-fixed', category: 'hidden', name: 'Oops, fixed', description: 'Undo an action with Ctrl+Z', points: 20, hidden: true, progress: (d) => count(d.events.undo ?? 0, 1) },
  { id: 'docked', category: 'hidden', name: 'Docked', description: 'Dock the mini window to the screen edge', points: 30, hidden: true, progress: (d) => count(d.events.docked ?? 0, 1) },
  { id: 'my-keys', category: 'hidden', name: 'My keys', description: 'Change a keyboard shortcut', points: 30, hidden: true, progress: (d) => flag(d.customized.shortcuts) },
  { id: 'anniversary', category: 'hidden', name: 'Anniversary', description: 'Use TodoEase for a full year', points: 330, hidden: true, progress: (d) => count(daysSinceFirstUse(d), 365) },
];

export const TOTAL_POINTS = ACHIEVEMENTS.reduce((sum, a) => sum + a.points, 0);

export interface AchievementState {
  def: AchievementDef;
  current: number;
  target: number;
  unlocked: boolean;
  unlockedAt: string | null;
}

/** Every achievement with its progress; ones already unlocked stay unlocked (a lost streak keeps its badge). */
export function evaluate(data: AchievementData, unlockedAt: Record<string, string>): AchievementState[] {
  const d = derive(data);
  return ACHIEVEMENTS.map((def) => {
    const { current, target } = def.progress(d);
    const stored = unlockedAt[def.id] ?? null;
    return { def, current, target, unlocked: stored !== null || current >= target, unlockedAt: stored };
  });
}

export const pointsOf = (states: AchievementState[]) => states.filter((s) => s.unlocked).reduce((n, s) => n + s.def.points, 0);

// ---------- Shop (preview: skins come with the "Skin change" task) ----------

export interface ShopTier {
  id: 'common' | 'rare' | 'epic' | 'legendary';
  name: string;
  price: number;
  examples: string[];
}

export const SHOP_TIERS: ShopTier[] = [
  { id: 'common', name: 'Common', price: 2500, examples: ['Static profile border', 'Sticky-note paper skin', 'Accent colour pack'] },
  { id: 'rare', name: 'Rare', price: 5000, examples: ['Avatar frame', 'Pet skin', 'Subtle background effect', 'Insights colour theme'] },
  { id: 'epic', name: 'Epic', price: 7500, examples: ['Animated avatar frame', 'Animated background effect', 'Insights design (World pack)'] },
  { id: 'legendary', name: 'Legendary', price: 10000, examples: ['Matching bundle: frame, border, note skin, background and pet in one theme'] },
];
