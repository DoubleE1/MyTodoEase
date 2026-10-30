import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { CompletionItem } from '../api/types';
import { bestSlot, bucketByHour, hourLevel, hourRange, maxOf, MIN_FOR_SUMMARY } from '../lib/hourHeatmap';
import { t } from '../i18n';

const DAYS = [t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat'), t('Sun')];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21];

const tickLabel = (h: number) => (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`);
const plural = (n: number) => (n === 1 ? t('1 task') : t('{n} tasks', { n }));

/**
 * "When I get things done": completions by weekday and hour (local time) for the selected year, with the
 * busiest slot in words. Arrow keys move between cells; the focused cell is read out below the grid.
 */
export function HourHeatmap({ items }: { items: CompletionItem[] }) {
  const grid = useMemo(() => bucketByHour(items), [items]);
  const max = maxOf(grid);
  const best = bestSlot(grid);
  const [focus, setFocus] = useState<{ row: number; col: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const cellLabel = (row: number, col: number) => `${t(DAY_NAMES[row])} ${hourRange(col)}: ${plural(grid[row][col])}`;

  const move = (event: KeyboardEvent, row: number, col: number) => {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      Home: [0, -col],
      End: [0, 23 - col],
    };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    const next = { row: Math.min(6, Math.max(0, row + delta[0])), col: Math.min(23, Math.max(0, col + delta[1])) };
    setFocus(next);
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${next.row}-${next.col}"]`)?.focus();
  };

  // One cell is in the Tab order (roving focus): the last focused one, else Monday at midnight.
  const tabCell = focus ?? { row: 0, col: 0 };

  return (
    <section className="insight-panel hour-heatmap" aria-label={t('When I get things done')}>
      <h2>{t('When I get things done')}</h2>
      <p className="muted small hour-summary">
        {best
          ? t('You get the most done on {day} {part}.', { day: t(best.day), part: t(best.part === 'night' ? 'nights' : `${best.part}s`) })
          : max === 0
            ? t('Complete a few tasks to see which hours suit you.')
            : t('Your best time shows after {n} completed tasks.', { n: MIN_FOR_SUMMARY })}
      </p>
      <div className="hour-grid-wrap">
        <div className="hour-ticks" aria-hidden="true">
          {HOUR_TICKS.map((h) => (
            <span key={h} style={{ gridColumn: h + 2 }}>
              {tickLabel(h)}
            </span>
          ))}
        </div>
        <div className="hour-grid" role="grid" aria-label={t('Completed tasks by weekday and hour')} ref={gridRef}>
          {grid.map((hours, row) => (
            <div key={DAYS[row]} role="row" className="hour-row">
              <span role="rowheader" className="hour-day">
                {DAYS[row]}
              </span>
              {hours.map((count, col) => (
                <span
                  key={col}
                  role="gridcell"
                  tabIndex={tabCell.row === row && tabCell.col === col ? 0 : -1}
                  data-cell={`${row}-${col}`}
                  className={`heat-cell hour-cell level-${hourLevel(count, max)}`}
                  aria-label={cellLabel(row, col)}
                  data-tooltip={cellLabel(row, col)}
                  onFocus={() => setFocus({ row, col })}
                  onKeyDown={(e) => move(e, row, col)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="muted small hour-focus" aria-live="polite">
        {focus ? cellLabel(focus.row, focus.col) : t('Hover or use the arrow keys to see each hour.')}
      </p>
    </section>
  );
}
