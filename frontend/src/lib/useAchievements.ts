import { useEffect, useMemo, useRef } from 'react';
import {
  useActiveTasks,
  useCalendarSync,
  useCompletedTasks,
  useCompletions,
  useLabels,
  useNotes,
  useProjects,
  useSections,
} from '../api/hooks';
import { ACCENT_KEY } from './accent';
import { evaluate, markUnlocked, pointsOf, recordClearDay, useAchievementStore, type AchievementState } from './achievements';
import { DEFAULT_HOTKEYS, sameHotkey, useHotkeys, type HotkeyAction } from './hotkeys';
import { todayStr } from './dates';
import { showToast } from './toast';
import { t } from '../i18n';

const THEME_KEY = 'mytodoease.theme';

function themeCustomized(): boolean {
  try {
    const theme = localStorage.getItem(THEME_KEY);
    return (theme !== null && theme !== 'system') || localStorage.getItem(ACCENT_KEY) !== null;
  } catch {
    return false;
  }
}

/** All 50 achievements with progress, plus the points total. `ready` once the data has loaded. */
export function useAchievements(): { states: AchievementState[]; points: number; ready: boolean } {
  const active = useActiveTasks();
  const completed = useCompletedTasks(true);
  const completions = useCompletions('2000-01-01', todayStr());
  const projects = useProjects();
  const sections = useSections();
  const labels = useLabels();
  const notes = useNotes();
  const calendar = useCalendarSync();
  const hotkeys = useHotkeys();
  const store = useAchievementStore();

  const ready = active.isSuccess && completed.isSuccess && completions.isSuccess && projects.isSuccess && notes.isSuccess;
  const shortcutsChanged = (Object.keys(DEFAULT_HOTKEYS) as HotkeyAction[]).some((a) => !sameHotkey(hotkeys[a], DEFAULT_HOTKEYS[a]));

  const states = useMemo(
    () =>
      evaluate(
        {
          now: new Date(),
          activeTasks: active.data ?? [],
          completedTasks: completed.data ?? [],
          completions: completions.data?.items ?? [],
          projects: projects.data ?? [],
          sections: sections.data ?? [],
          labels: labels.data ?? [],
          notes: notes.data ?? [],
          calendarConnected: calendar.data?.scopeGranted === true,
          customized: { theme: themeCustomized(), shortcuts: shortcutsChanged },
          events: store.events,
          clearDays: store.clearDays,
          insightsDays: store.insightsDays,
        },
        store.unlocked,
      ),
    [active.data, completed.data, completions.data, projects.data, sections.data, labels.data, notes.data, calendar.data, shortcutsChanged, store],
  );

  return { states, points: pointsOf(states), ready };
}

/**
 * Mounted once (App): keeps today's "nothing overdue" mark, stores new unlocks and announces them. Many at
 * once (the first run on an existing account) become one summary toast instead of a flood.
 */
export function useAchievementWatcher(onOpen: () => void) {
  const { states, ready } = useAchievements();
  const active = useActiveTasks();
  const opened = useRef(onOpen);
  opened.current = onOpen;

  useEffect(() => {
    if (!active.isSuccess) return;
    const today = todayStr();
    if (!(active.data ?? []).some((t) => t.dueDate !== null && t.dueDate < today)) recordClearDay(today);
  }, [active.isSuccess, active.data]);

  useEffect(() => {
    if (!ready) return;
    const fresh = states.filter((s) => s.unlocked && s.unlockedAt === null);
    if (fresh.length === 0) return;
    markUnlocked(
      fresh.map((s) => s.def.id),
      new Date().toISOString(),
    );
    const points = fresh.reduce((n, s) => n + s.def.points, 0);
    const message =
      fresh.length === 1
        ? t('Achievement unlocked: {name} (+{points} points)', { name: fresh[0].def.name, points })
        : t('{n} achievements unlocked (+{points} points)', { n: fresh.length, points: points.toLocaleString() });
    showToast(message, 'success', { group: 'achievement', duration: 6000, action: { label: t('View'), run: () => opened.current() } });
  }, [ready, states]);
}
