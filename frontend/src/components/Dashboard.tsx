import { addDays, format, startOfDay, subDays } from 'date-fns';
import { AlertCircle, ChevronRight, Flame } from 'lucide-react';
import { useMemo } from 'react';
import type { CompletionItem, Task } from '../api/types';
import { toDateStr, todayStr } from '../lib/dates';
import { completionsPerDay, currentStreak } from '../lib/stats';
import type { View } from '../lib/views';
import { datePattern, t } from '../i18n';

interface DashboardProps {
  tasks: Task[];
  completions: CompletionItem[];
  active: boolean;
  /** Navigation target for clicks. Omit to render a static, non-clickable card. */
  onSelectView?: (view: View) => void;
}

interface Stats {
  doneToday: number;
  dueToday: number;
  overdue: number;
  progress: number;
  week: { date: string; label: string; count: number }[];
  weekTotal: number;
  streak: number;
}

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 5) return t('Burning the midnight oil');
  if (hour < 12) return t('Good morning');
  if (hour < 17) return t('Good afternoon');
  if (hour < 21) return t('Good evening');
  return t('Winding down');
}

/** One playful line that reflects where the day stands. */
function statusLine(s: Stats): string {
  if (s.overdue > 0 && s.dueToday === 0 && s.doneToday === 0) return 'A few stragglers from earlier days. Clear them and start fresh.';
  if (s.dueToday === 0 && s.doneToday === 0) return t('Nothing on the plate today. Enjoy the calm, or plan ahead.');
  if (s.dueToday === 0) return s.doneToday === 1 ? t('Done and dusted. Nice one!') : t('All {n} done. Take a bow.', { n: s.doneToday });
  if (s.progress >= 0.75) return t('Almost there. One last push.');
  if (s.progress >= 0.5) return t('Over halfway. Keep the momentum.');
  if (s.doneToday > 0) return t('Good start. Keep chipping away.');
  return s.dueToday === 1 ? t('Just one thing today. Easy win.') : t('{n} to go. You have got this.', { n: s.dueToday });
}

function computeStats(tasks: Task[], completions: CompletionItem[], now: Date): Stats {
  const today = todayStr();
  const todayStart = startOfDay(now);
  const perDay = completionsPerDay(completions);

  const doneToday = perDay.get(today) ?? 0;
  const dueToday = tasks.filter((t) => t.dueDate === today).length;
  const overdue = tasks.filter((t) => t.dueDate !== null && t.dueDate < today).length;
  const total = doneToday + dueToday;
  const progress = total === 0 ? 0 : doneToday / total;

  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(subDays(todayStart, 6), i);
    const key = toDateStr(date);
    return { date: key, label: format(date, datePattern('weekdayDayMonth')), count: perDay.get(key) ?? 0 };
  });
  const weekTotal = week.reduce((n, d) => n + d.count, 0);

  return { doneToday, dueToday, overdue, progress, week, weekTotal, streak: currentStreak(perDay, now) };
}

export function Dashboard({ tasks, completions, active, onSelectView }: DashboardProps) {
  const now = new Date();
  const stats = useMemo(() => computeStats(tasks, completions, now), [tasks, completions, now.getDate()]);
  const percent = Math.round(stats.progress * 100);
  const total = stats.doneToday + stats.dueToday;

  // Ring geometry: r=20 → circumference ≈ 125.66
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * stats.progress;
  const maxBar = Math.max(1, ...stats.week.map((d) => d.count));
  const interactive = onSelectView !== undefined;
  const openInsights = () => onSelectView?.({ kind: 'insights' });

  return (
    <section
      className={`dashboard ${active ? 'is-active' : ''} ${interactive ? '' : 'is-static'}`}
      aria-label={interactive ? t('Overview. Open insights') : t('Overview')}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      data-tooltip={interactive ? t('Open insights') : undefined}
      onClick={interactive ? openInsights : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openInsights();
              }
            }
          : undefined
      }
    >
      <div className="dashboard-top">
        <div
          className={`ring ${total > 0 && stats.dueToday === 0 ? 'is-complete' : ''}`}
          role="img"
          aria-label={total === 0 ? t('Nothing due today') : t('{done} of {total} done today, {percent} percent', { done: stats.doneToday, total, percent })}
        >
          <svg viewBox="0 0 48 48" width="48" height="48">
            <defs>
              <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" style={{ stopColor: 'var(--brand-1)' }} />
                <stop offset="0.55" style={{ stopColor: 'var(--brand-2)' }} />
                <stop offset="1" style={{ stopColor: 'var(--brand-3)' }} />
              </linearGradient>
            </defs>
            <circle className="ring-track" cx="24" cy="24" r={radius} />
            <circle
              className="ring-value"
              cx="24"
              cy="24"
              r={radius}
              stroke="url(#ring-grad)"
              strokeDasharray={`${dash} ${circumference - dash}`}
            />
          </svg>
          <span className="ring-text">{total === 0 ? '–' : `${percent}%`}</span>
        </div>
        <div className="dashboard-text">
          <div className="dashboard-greeting">
            <span>{greeting(now)}</span>
            {interactive && <ChevronRight size={13} className="dashboard-arrow" />}
          </div>
          <div className="dashboard-status">{statusLine(stats)}</div>
          <div className="muted small">
            {total === 0 ? t('No tasks due today') : t('{done} of {total} done today', { done: stats.doneToday, total })}
          </div>
        </div>
      </div>

      <div className="dashboard-week" role="img" aria-label={`${stats.weekTotal} tasks completed in the last 7 days`}>
        <div className="week-bars">
          {stats.week.map((d) => (
            <div key={d.date} className="week-bar-slot" data-tooltip={`${d.label}: ${d.count} done`}>
              <div
                className={`week-bar ${d.date === todayStr() ? 'is-today' : ''} ${d.count === 0 ? 'is-empty' : ''}`}
                style={{ height: `${Math.max(12, (d.count / maxBar) * 100)}%` }}
              />
              <span className="week-bar-label">{d.label.charAt(0)}</span>
            </div>
          ))}
        </div>
        <div className="week-summary">
          <strong>{stats.weekTotal}</strong>
          <span className="muted small">{t('this week')}</span>
        </div>
      </div>

      <div className="dashboard-chips">
        <span className={`stat-chip ${stats.streak > 0 ? 'is-hot' : ''}`} data-tooltip={t('Days in a row with at least one task completed')}>
          <Flame size={13} />
          {stats.streak > 0 ? t('{n}-day streak', { n: stats.streak }) : t('No streak yet')}
        </span>
        {stats.overdue > 0 &&
          (interactive ? (
            <button
              type="button"
              className="stat-chip is-overdue"
              onClick={(e) => {
                e.stopPropagation();
                onSelectView({ kind: 'today' });
              }}
              data-tooltip={t('Show overdue tasks')}
            >
              <AlertCircle size={13} />
              {stats.overdue} overdue
            </button>
          ) : (
            <span className="stat-chip is-overdue">
              <AlertCircle size={13} />
              {stats.overdue} overdue
            </span>
          ))}
      </div>
    </section>
  );
}
