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
import { Award, CalendarCheck, Flame, Sparkles, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useCompletions } from '../api/hooks';
import type { CompletionItem, Project } from '../api/types';
import { colorHex } from '../lib/colors';
import { parseDateStr, toDateStr, todayStr } from '../lib/dates';
import { completionsPerDay, currentStreak, longestStreak } from '../lib/stats';
import { ProjectIcon } from './Pickers';

interface InsightsViewProps {
  /** Compact layout for a narrow host such as the mini window's lower pane: no page title, stacked header. */
  embedded?: boolean;
  projects: Project[];
}

const WEEK_STARTS_ON = 1; // Monday
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Heat level 0–4 for a day's count, GitHub style. */
function level(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function InsightsView({ projects, embedded = false }: InsightsViewProps) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
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
  const isCurrentYear = year === currentYear;
  const streakNow = isCurrentYear ? currentStreak(stats.perDay) : 0;

  return (
    <div className={`view view-insights ${embedded ? 'is-embedded' : ''}`}>
      <header className="view-header insights-header">
        <div>
          {!embedded && <h1>Insights</h1>}
          <p className="muted">
            {stats.total === 0
              ? `No tasks completed in ${year} yet.`
              : `${plural(stats.total, 'task')} completed in ${year} across ${plural(stats.activeDays, 'day')}.`}
          </p>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Year">
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
      </header>

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
                      className={`heat-cell level-${level(cell.count)} ${cell.date === todayStr() ? 'is-today' : ''}`}
                      style={{ gridColumn: cell.column + 1, gridRow: cell.row + 1 }}
                      title={`${plural(cell.count, 'task')} on ${format(parseDateStr(cell.date)!, 'EEE d MMM yyyy')}`}
                      role="img"
                      aria-label={`${plural(cell.count, 'task')} on ${format(parseDateStr(cell.date)!, 'EEEE d MMMM yyyy')}`}
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
          <span className="muted small">Less</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className={`heat-cell level-${l}`} />
          ))}
          <span className="muted small">More</span>
        </div>
      </section>

      <section className="insight-tiles">
        <div className="insight-tile">
          <CalendarCheck size={18} />
          <div className="insight-value">{stats.total}</div>
          <div className="insight-label">completed in {year}</div>
        </div>
        <div className="insight-tile">
          <Flame size={18} />
          <div className="insight-value">{isCurrentYear ? streakNow : stats.longest.length}</div>
          <div className="insight-label">{isCurrentYear ? 'current streak (days)' : 'longest streak (days)'}</div>
        </div>
        <div className="insight-tile">
          <Award size={18} />
          <div className="insight-value">{stats.longest.length}</div>
          <div className="insight-label">
            longest streak
            {stats.longest.end && ` · ended ${format(parseDateStr(stats.longest.end)!, 'd MMM')}`}
          </div>
        </div>
        <div className="insight-tile">
          <Sparkles size={18} />
          <div className="insight-value">{stats.bestDay ? stats.bestDay.count : 0}</div>
          <div className="insight-label">
            best day{stats.bestDay && ` · ${format(parseDateStr(stats.bestDay.date)!, 'EEE d MMM')}`}
          </div>
        </div>
        <div className="insight-tile">
          <TrendingUp size={18} />
          <div className="insight-value">{stats.activeDays === 0 ? '0' : (stats.total / stats.activeDays).toFixed(1)}</div>
          <div className="insight-label">per active day</div>
        </div>
      </section>

      <div className="insight-columns">
        <section className="insight-panel" aria-label="By weekday">
          <h2>By weekday</h2>
          <div className="weekday-bars">
            {stats.byWeekday.map((count, i) => (
              <div key={WEEKDAY_LABELS[i]} className="weekday-slot" title={`${WEEKDAY_LABELS[i]}: ${plural(count, 'task')}`}>
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
              ? `${WEEKDAY_LABELS[stats.byWeekday.indexOf(stats.maxWeekday)]} is your most productive day.`
              : 'Complete a few tasks to see your weekly rhythm.'}
          </p>
        </section>

        <section className="insight-panel" aria-label="By project">
          <h2>By project</h2>
          {stats.byProject.length === 0 ? (
            <p className="muted small">Nothing yet.</p>
          ) : (
            <ul className="project-stats">
              {stats.byProject.map((p) => (
                <li key={p.id}>
                  <span className="project-stat-name">
                    <ProjectIcon project={p.project} />
                    <span>{p.project?.name ?? 'Deleted project'}</span>
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
