import {
  addDays,
  differenceInCalendarWeeks,
  eachDayOfInterval,
  endOfWeek,
  format,
  getDay,
  parseISO,
  startOfWeek,
} from 'date-fns';
import { Award, CalendarCheck, Flame, LayoutGrid, Sparkles, TreePine, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { recordInsightsVisit } from '../lib/achievements';
import { useCompletions } from '../api/hooks';
import { HourHeatmap } from './HourHeatmap';
import type { CompletionItem, Project } from '../api/types';
import { colorHex } from '../lib/colors';
import { parseDateStr, toDateStr, todayStr } from '../lib/dates';
import { completionsPerDay, currentStreak, longestStreak } from '../lib/stats';
import { completionLevel } from '../lib/world';
import { ProjectIcon } from './Pickers';
import { WorldView } from './WorldView';
import { datePattern, t } from '../i18n';

interface InsightsViewProps {
  /** Compact layout for a narrow host such as the mini window's lower pane: no page title, stacked header. */
  embedded?: boolean;
  projects: Project[];
}

const WEEK_STARTS_ON = 1; // Monday
const WEEKDAY_LABELS = [t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat'), t('Sun')];

/** How the year is drawn: the classic heat grid or the isometric world. Remembered across sessions. */
type InsightsMode = 'grid' | 'world';
const MODE_KEY = 'mytodoease.insights.mode';

function readStoredMode(): InsightsMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'world' ? 'world' : 'grid';
  } catch {
    return 'grid';
  }
}

function storeMode(mode: InsightsMode) {
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Not persisted; fine.
  }
}

function plural(n: number, word: 'task' | 'day'): string {
  if (word === 'day') return n === 1 ? t('1 day') : t('{n} days', { n });
  return n === 1 ? t('1 task') : t('{n} tasks', { n });
}

export function InsightsView({ projects, embedded = false }: InsightsViewProps) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  // The mini window always shows the grid: there is no room for the world and no toggle.
  const [mode, setMode] = useState<InsightsMode>(() => (embedded ? 'grid' : readStoredMode()));
  const selectMode = (next: InsightsMode) => {
    setMode(next);
    storeMode(next);
  };
  const query = useCompletions(`${year}-01-01`, `${year}-12-31`);
  const items = useMemo(
    () => (query.data?.items ?? []).filter((c) => parseISO(c.completedAt).getFullYear() === year),
    [query.data, year],
  );
  const years = useMemo(() => {
    const known = new Set(query.data?.years ?? []);
    known.add(currentYear);
    known.add(year);
    return [...known].sort((a, b) => b - a);
  }, [query.data, currentYear, year]);

  const stats = useMemo(() => buildYearStats(items, year, projects), [items, year, projects]);
  // "Self-aware" achievement: the days Insights was opened (the mini window's embedded copy does not count).
  useEffect(() => {
    if (!embedded) recordInsightsVisit(todayStr());
  }, [embedded]);
  const isCurrentYear = year === currentYear;
  const streakNow = isCurrentYear ? currentStreak(stats.perDay) : 0;

  return (
    <div className={`view view-insights ${embedded ? 'is-embedded' : ''}`}>
      <header className="view-header insights-header">
        <div>
          {!embedded && <h1>{t('Insights')}</h1>}
          <p className="muted">
            {stats.total === 0
              ? t('No tasks completed in {year} yet.', { year })
              : t('{tasks} completed in {year} across {days}.', { tasks: plural(stats.total, 'task'), year, days: plural(stats.activeDays, 'day') })}
          </p>
        </div>
        <div className="insights-controls">
          {!embedded && (
            <div className="segmented" role="radiogroup" aria-label={t('View')}>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'grid'}
                className={`segmented-option ${mode === 'grid' ? 'is-selected' : ''}`}
                onClick={() => selectMode('grid')}
              >
                <LayoutGrid size={14} aria-hidden="true" />
                {t('Grid')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'world'}
                className={`segmented-option ${mode === 'world' ? 'is-selected' : ''}`}
                onClick={() => selectMode('world')}
              >
                <TreePine size={14} aria-hidden="true" />
                {t('World')}
              </button>
            </div>
          )}
          <div className="segmented" role="radiogroup" aria-label={t('Year')}>
            {years.map((y) => (
              <button
                key={y}
                type="button"
                role="radio"
                aria-checked={y === year}
                className={`segmented-option ${y === year ? 'is-selected' : ''}`}
                onClick={() => setYear(y)}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
      </header>

      {mode === 'world' && !embedded ? (
        <WorldView
          year={year}
          weeks={stats.weeks}
          monthLabels={stats.monthLabels}
          cells={stats.cells}
          perDay={stats.perDay}
          total={stats.total}
        />
      ) : (
        <section className="heatmap-card" aria-label={`Completions in ${year}`}>
          <div className="heatmap-scroll">
            <div className="heatmap">
              <div className="heatmap-months" style={{ gridTemplateColumns: `repeat(${stats.weeks}, minmax(0, 1fr))` }}>
                {stats.monthLabels.map((m) => (
                  <span key={m.label + m.column} style={{ gridColumnStart: m.column + 1 }}>
                    {m.label}
                  </span>
                ))}
              </div>
              <div className="heatmap-body">
                <div className="heatmap-weekdays">
                  {WEEKDAY_LABELS.map((d, i) => (
                    <span key={d} className={i % 2 === 0 ? '' : 'is-hidden'}>
                      {d}
                    </span>
                  ))}
                </div>
                <div className="heatmap-grid" style={{ gridTemplateColumns: `repeat(${stats.weeks}, minmax(0, 1fr))` }}>
                  {stats.cells.map((cell) =>
                    cell.inYear ? (
                      <div
                        key={cell.date}
                        className={`heat-cell level-${completionLevel(cell.count)} ${cell.date === todayStr() ? 'is-today' : ''}`}
                        style={{ gridColumn: cell.column + 1, gridRow: cell.row + 1 }}
                        data-tooltip={t('{count} on {date}', { count: plural(cell.count, 'task'), date: format(parseDateStr(cell.date)!, datePattern('dayMonthYear')) })}
                        role="img"
                        aria-label={t('{count} on {date}', { count: plural(cell.count, 'task'), date: format(parseDateStr(cell.date)!, datePattern('dayMonthYear')) })}
                      />
                    ) : (
                      <div
                        key={cell.date}
                        className="heat-cell is-outside"
                        style={{ gridColumn: cell.column + 1, gridRow: cell.row + 1 }}
                        aria-hidden="true"
                      />
                    ),
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="heatmap-legend">
            <span className="muted small">{t('Less')}</span>
            {[0, 1, 2, 3, 4].map((l) => (
              <span key={l} className={`heat-cell level-${l}`} />
            ))}
            <span className="muted small">{t('More')}</span>
          </div>
        </section>
      )}

      <section className="insight-tiles">
        <div className="insight-tile">
          <CalendarCheck size={18} />
          <div className="insight-value">{stats.total}</div>
          <div className="insight-label">{t('completed in {year}', { year })}</div>
        </div>
        <div className="insight-tile">
          <Flame size={18} />
          <div className="insight-value">{isCurrentYear ? streakNow : stats.longest.length}</div>
          <div className="insight-label">{isCurrentYear ? t('current streak (days)') : t('longest streak (days)')}</div>
        </div>
        <div className="insight-tile">
          <Award size={18} />
          <div className="insight-value">{stats.longest.length}</div>
          <div className="insight-label">
            {t('longest streak')}
            {stats.longest.end && ` · ${t('ended {date}', { date: format(parseDateStr(stats.longest.end)!, datePattern('dayMonth')) })}`}
          </div>
        </div>
        <div className="insight-tile">
          <Sparkles size={18} />
          <div className="insight-value">{stats.bestDay ? stats.bestDay.count : 0}</div>
          <div className="insight-label">
            {t('best day')}
            {stats.bestDay && ` · ${format(parseDateStr(stats.bestDay.date)!, datePattern('weekdayDayMonth'))}`}
          </div>
        </div>
        <div className="insight-tile">
          <TrendingUp size={18} />
          <div className="insight-value">{stats.activeDays === 0 ? '0' : (stats.total / stats.activeDays).toFixed(1)}</div>
          <div className="insight-label">{t('per active day')}</div>
        </div>
      </section>

      <div className="insight-columns">
        <section className="insight-panel" aria-label={t('By weekday')}>
          <h2>{t('By weekday')}</h2>
          <div className="weekday-bars">
            {stats.byWeekday.map((count, i) => (
              <div key={WEEKDAY_LABELS[i]} className="weekday-slot" data-tooltip={`${WEEKDAY_LABELS[i]}: ${plural(count, 'task')}`}>
                <span className="weekday-count">{count || ''}</span>
                <div
                  className={`weekday-bar ${count === 0 ? 'is-empty' : ''} ${count === stats.maxWeekday && count > 0 ? 'is-best' : ''}`}
                  style={{ height: `${Math.max(6, (count / Math.max(1, stats.maxWeekday)) * 100)}%` }}
                />
                <span className="weekday-label">{WEEKDAY_LABELS[i]}</span>
              </div>
            ))}
          </div>
          <p className="muted small">
            {stats.maxWeekday > 0
              ? t('{day} is your most productive day.', { day: WEEKDAY_LABELS[stats.byWeekday.indexOf(stats.maxWeekday)] })
              : t('Complete a few tasks to see your weekly rhythm.')}
          </p>
        </section>

        <section className="insight-panel" aria-label={t('By project')}>
          <h2>{t('By project')}</h2>
          {stats.byProject.length === 0 ? (
            <p className="muted small">{t('Nothing yet.')}</p>
          ) : (
            <ul className="project-stats">
              {stats.byProject.map((p) => (
                <li key={p.id}>
                  <span className="project-stat-name">
                    <ProjectIcon project={p.project} />
                    <span>{p.project?.name ?? t('Deleted project')}</span>
                  </span>
                  <span className="project-stat-bar">
                    <span
                      style={{
                        width: `${(p.count / stats.byProject[0].count) * 100}%`,
                        background: p.project && !p.project.isInbox ? colorHex(p.project.color) : 'var(--text-muted)',
                      }}
                    />
                  </span>
                  <span className="project-stat-count">{p.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <HourHeatmap items={items} />
    </div>
  );
}

interface YearStats {
  perDay: Map<string, number>;
  total: number;
  activeDays: number;
  weeks: number;
  cells: { date: string; column: number; row: number; count: number; inYear: boolean }[];
  monthLabels: { label: string; column: number }[];
  longest: { length: number; end: string | null };
  bestDay: { date: string; count: number } | null;
  byWeekday: number[];
  maxWeekday: number;
  byProject: { id: string; project: Project | undefined; count: number }[];
}

function buildYearStats(items: CompletionItem[], year: number, projects: Project[]): YearStats {
  const perDay = completionsPerDay(items);
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const gridStart = startOfWeek(yearStart, { weekStartsOn: WEEK_STARTS_ON });
  const gridEnd = endOfWeek(yearEnd, { weekStartsOn: WEEK_STARTS_ON });
  const weeks = differenceInCalendarWeeks(gridEnd, gridStart, { weekStartsOn: WEEK_STARTS_ON }) + 1;

  const cells: YearStats['cells'] = [];
  const monthLabels: YearStats['monthLabels'] = [];
  let lastMonth = -1;
  for (const day of eachDayOfInterval({ start: gridStart, end: gridEnd })) {
    const column = differenceInCalendarWeeks(day, gridStart, { weekStartsOn: WEEK_STARTS_ON });
    const row = (getDay(day) + 6) % 7; // Monday = 0
    const inYear = day >= yearStart && day <= addDays(yearEnd, 0);
    const date = toDateStr(day);
    cells.push({ date, column, row, count: perDay.get(date) ?? 0, inYear });
    if (inYear && day.getMonth() !== lastMonth && row === 0 || (inYear && lastMonth === -1)) {
      // Label a month at the first week that starts inside it (or the very first in-year day).
      if (day.getMonth() !== lastMonth) {
        monthLabels.push({ label: format(day, 'MMM'), column });
        lastMonth = day.getMonth();
      }
    }
  }

  let total = 0;
  let bestDay: YearStats['bestDay'] = null;
  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  for (const [date, count] of perDay) {
    const d = parseDateStr(date);
    if (!d || d.getFullYear() !== year) continue;
    total += count;
    byWeekday[(getDay(d) + 6) % 7] += count;
    if (!bestDay || count > bestDay.count) bestDay = { date, count };
  }
  const activeDays = [...perDay.entries()].filter(([date, c]) => c > 0 && date.startsWith(`${year}-`)).length;

  const projectCounts = new Map<string, number>();
  for (const item of items) projectCounts.set(item.projectId, (projectCounts.get(item.projectId) ?? 0) + 1);
  const byProject = [...projectCounts.entries()]
    .map(([id, count]) => ({ id, project: projects.find((p) => p.id === id), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    perDay,
    total,
    activeDays,
    weeks,
    cells,
    monthLabels,
    longest: longestStreak(perDay),
    bestDay,
    byWeekday,
    maxWeekday: Math.max(...byWeekday),
    byProject,
  };
}
