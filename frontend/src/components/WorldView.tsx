import { format } from 'date-fns';
import { Flame } from 'lucide-react';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import * as city from '../assets/world/city/sprites';
import * as grove from '../assets/world/grove/sprites';
import type { Sprite } from '../assets/world/sprite';
import { parseDateStr, todayStr } from '../lib/dates';
import { celebratedStreakDays, completionLevel, type WorldLevel } from '../lib/world';
import { datePattern, t } from '../i18n';

/**
 * Insights "World": the year heatmap drawn as an isometric landscape. Every day is a small block in the
 * same weeks × weekdays grid as the heatmap; what has grown on it depends on how many tasks were
 * completed that day. The art comes from a pluggable theme (only the free Grove exists today).
 */

/** One day of the year grid, as InsightsView lays it out for the heatmap. */
export interface WorldCell {
  date: string;
  column: number;
  row: number;
  count: number;
  inYear: boolean;
}

export interface PlotFlags {
  isToday: boolean;
  inStreak: boolean;
  isFuture: boolean;
  /** Stable per day in [0, 1): lets a theme vary the look between days of the same tier. */
  seed: number;
}

/** What a theme puts on a plot. */
export interface PlotArt {
  /** Id of a <symbol> from the theme's defs; its origin sits at the centre of the block's top face, y grows upwards. */
  symbol: string;
  /** How far the art rises above the top face, in grid units; places the sparkles. */
  height: number;
  /** Gentle idle sway (vector trees); off for sprites that include their block. */
  sway: boolean;
  /** True when the symbol draws the ground block itself, so the view draws none. */
  ground: boolean;
}

export interface WorldTheme {
  id: string;
  name: string;
  /** <symbol> definitions, rendered once inside <defs>. Fills use the --world-* variables the theme's CSS sets. */
  defs: ReactNode;
  /** Art for a day's growth tier, or null for a bare block. */
  plotArt(level: WorldLevel, flags: PlotFlags): PlotArt | null;
}

// ---- Grid geometry (SVG user units; the drawing scales with the card width) ----

const CELL = 23; // column pitch
const ROW = 20; // row pitch
const TOP_W = 20; // top face of a block (2:1 isometric diamond)
const TOP_H = TOP_W / 2;
const DEPTH = 6; // visible side faces
const HEADROOM = 42; // room above the first row for tall art
const BOTTOM_PAD = 3;
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const diamond = (w: number, h: number) => `0,${-h / 2} ${w / 2},0 0,${h / 2} ${-w / 2},0`;
const TOP = diamond(TOP_W, TOP_H);
const GLOW = diamond(TOP_W * 1.9, TOP_H * 1.9);
const FACE_LEFT = `${-TOP_W / 2},0 0,${TOP_H / 2} 0,${TOP_H / 2 + DEPTH} ${-TOP_W / 2},${DEPTH}`;
const FACE_RIGHT = `0,${TOP_H / 2} ${TOP_W / 2},0 ${TOP_W / 2},${DEPTH} 0,${TOP_H / 2 + DEPTH}`;

// ---- Sprite themes: the owner's rendered blocks (design/world/<theme>, cut by frontend/scripts/world-sprites.py) ----

const marker: CSSProperties = { fill: 'var(--world-marker)' };

interface SpriteSet {
  BLOCK_WIDTH: number;
  SPRITES: Record<string, Sprite>;
}

/**
 * A theme whose symbols are rendered sprites that include their own block. `pick` names the sprite for a
 * growth tier, using the day's seed to vary the look (a species, a style) between days of the same tier.
 */
function spriteTheme(id: string, name: string, set: SpriteSet, pick: (level: WorldLevel, seed: number) => string): WorldTheme {
  const scale = TOP_W / set.BLOCK_WIDTH; // sprite px -> grid units, so every block is TOP_W wide
  const art = (sprite: string): PlotArt => ({
    symbol: `${id}-${sprite}`,
    height: set.SPRITES[sprite].anchorY * scale,
    sway: false,
    ground: true,
  });
  return {
    id,
    name,
    defs: (
      <>
        {Object.entries(set.SPRITES).map(([sprite, s]) => (
          <symbol key={sprite} id={`${id}-${sprite}`} overflow="visible">
            <image
              href={s.url}
              x={-s.anchorX * scale}
              y={-s.anchorY * scale}
              width={s.width * scale}
              height={s.height * scale}
            />
          </symbol>
        ))}
      </>
    ),
    plotArt: (level, flags) => art(level === 0 ? 'bare' : pick(level, flags.seed)),
  };
}

/** Spread days over variants by seed, with the given weights (they need not sum to 1). */
function weighted<T extends string>(seed: number, options: [T, number][]): T {
  const total = options.reduce((sum, [, w]) => sum + w, 0);
  let cursor = seed * total;
  for (const [value, weight] of options) {
    cursor -= weight;
    if (cursor < 0) return value;
  }
  return options[options.length - 1][0];
}

/** Grove: leafy, pine or blossom trees, so a busy month does not look like a plantation. */
const GROVE = spriteTheme('grove', 'Grove', grove, (level, seed) => {
  const species = weighted(seed, [['leafy', 45], ['pine', 30], ['blossom', 25]]);
  if (species === 'leafy' && level === 1) return (seed * 100) % 1 < 0.5 ? 'leafy-1a' : 'leafy-1b';
  return `${species}-${level}`;
});

/** City: a modern district, a castle town or a pagoda village grows on each day. */
const CITY = spriteTheme('city', 'City', city, (level, seed) => {
  const style = weighted(seed, [['modern', 1], ['castle', 1], ['pagoda', 1]]);
  return `${style}-${level}`;
});

export const WORLD_THEMES = { grove: GROVE, city: CITY } as const;
export type WorldThemeId = keyof typeof WORLD_THEMES;

const THEME_KEY = 'mytodoease.insights.theme';

function readStoredTheme(): WorldThemeId {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value && value in WORLD_THEMES ? (value as WorldThemeId) : 'grove';
  } catch {
    return 'grove';
  }
}

// ---- The view ----

interface WorldViewProps {
  year: number;
  weeks: number;
  monthLabels: { label: string; column: number }[];
  cells: WorldCell[];
  /** Completions per day for the shown year; drives the streak glow. */
  perDay: Map<string, number>;
  /** Total completed in the year, for the empty-state hint. */
  total: number;
}

function plural(n: number, word: 'task' | 'day'): string {
  if (word === 'day') return n === 1 ? t('1 day') : t('{n} days', { n });
  return n === 1 ? t('1 task') : t('{n} tasks', { n });
}

/** Small stable hash of a date string into [0, 1), for per-day variety. */
function dateSeed(date: string): number {
  let h = 2166136261;
  for (let i = 0; i < date.length; i += 1) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10007) / 10007;
}

const LEGEND_FLAGS: PlotFlags = { isToday: false, inStreak: false, isFuture: false, seed: 0.1 };

export function WorldView({ year, weeks, monthLabels, cells, perDay, total }: WorldViewProps) {
  const [themeId, setThemeId] = useState<WorldThemeId>(readStoredTheme);
  const theme: WorldTheme = WORLD_THEMES[themeId];
  const selectTheme = (next: WorldThemeId) => {
    setThemeId(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Not persisted; fine.
    }
  };
  const today = todayStr();
  const streak = useMemo(() => celebratedStreakDays(perDay), [perDay]);

  // Painter's order: rows top to bottom so art on a lower row overlaps the blocks behind it, like a landscape.
  const ordered = useMemo(
    () => cells.filter((c) => c.inYear).sort((a, b) => a.row - b.row || a.column - b.column),
    [cells],
  );

  const width = weeks * CELL;
  const height = HEADROOM + 7 * ROW + BOTTOM_PAD;
  // The weekday labels are HTML (fixed size) beside the SVG: align their 7 slots with the block rows.
  const rowsTop = HEADROOM + TOP_H / 2 + DEPTH / 2 - ROW / 2;
  const weekdayStyle: CSSProperties = { top: `${(rowsTop / height) * 100}%`, height: `${((7 * ROW) / height) * 100}%` };

  return (
    <section className={`world-card world-theme-${theme.id}`} aria-label={t('Completions in {year}, drawn as a world', { year })}>
      <div className="world-scroll">
        <div className="world">
          <div className="world-months" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }}>
            {monthLabels.map((m) => (
              <span key={m.label + m.column} style={{ gridColumnStart: m.column + 1 }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="world-body">
            <div className="world-weekdays" style={weekdayStyle} aria-hidden="true">
              {WEEKDAY_LABELS.map((d, i) => (
                <span key={d} className={i % 2 === 0 ? '' : 'is-hidden'}>
                  {d}
                </span>
              ))}
            </div>
            <svg className="world-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
              <defs>
                {theme.defs}
                <symbol id="world-sparkle" overflow="visible">
                  <path d="M0 -4 L1.1 -1.1 L4 0 L1.1 1.1 L0 4 L-1.1 1.1 L-4 0 L-1.1 -1.1 Z" style={marker} />
                </symbol>
              </defs>
              {ordered.map((cell) => {
                const flags: PlotFlags = {
                  isToday: cell.date === today,
                  inStreak: streak.has(cell.date),
                  isFuture: cell.date > today,
                  seed: dateSeed(cell.date),
                };
                const level = completionLevel(cell.count);
                const art = theme.plotArt(level, flags);
                const date = parseDateStr(cell.date)!;
                const cx = cell.column * CELL + CELL / 2;
                const cy = HEADROOM + cell.row * ROW + TOP_H / 2;
                const className = [
                  'world-cell',
                  `level-${level}`,
                  level > 0 && 'is-grown',
                  flags.isToday && 'is-today',
                  flags.inStreak && 'is-streak',
                  flags.isFuture && 'is-future',
                ]
                  .filter(Boolean)
                  .join(' ');
                // Stagger the grow-in left to right and desynchronise the sway per block.
                const vars = { '--c': cell.column, '--r': cell.row } as CSSProperties;
                return (
                  <g
                    key={cell.date}
                    className={className}
                    transform={`translate(${cx} ${cy})`}
                    style={vars}
                    role="img"
                    aria-label={t('{count} on {date}', { count: plural(cell.count, 'task'), date: format(date, datePattern('dayMonthYear')) })}
                  >
                    <title>{t('{count} on {date}', { count: plural(cell.count, 'task'), date: format(date, datePattern('dayMonthYear')) })}</title>
                    {flags.inStreak && <polygon className="world-glow" points={GLOW} />}
                    {!art?.ground && (
                      <>
                        <polygon className="world-face-left" points={FACE_LEFT} />
                        <polygon className="world-face-right" points={FACE_RIGHT} />
                        <polygon className="world-top" points={TOP} />
                      </>
                    )}
                    {flags.isToday && <polygon className="world-pulse" points={TOP} />}
                    {art && (
                      <g className="world-obj">
                        <use
                          href={`#${art.symbol}`}
                          className={`world-art level-${level}${art.sway ? ' is-swaying' : ''}`}
                        />
                      </g>
                    )}
                    {flags.isToday && <polygon className="world-today-ring" points={TOP} />}
                    {flags.inStreak && art && (
                      <>
                        <use href="#world-sparkle" className="world-sparkle" transform={`translate(8 ${-art.height - 1})`} />
                        {level >= 3 && (
                          <use
                            href="#world-sparkle"
                            className="world-sparkle is-second"
                            transform={`translate(-9 ${-art.height * 0.6}) scale(0.75)`}
                          />
                        )}
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
      <div className="world-footer">
        <div className="world-footer-left">
          <label className="world-theme-pick muted small">
            {t('Theme')}
            <select value={themeId} onChange={(e) => selectTheme(e.target.value as WorldThemeId)}>
              {(Object.keys(WORLD_THEMES) as WorldThemeId[]).map((id) => (
                <option key={id} value={id}>
                  {t(WORLD_THEMES[id].name)}
                </option>
              ))}
            </select>
          </label>
          <span className="muted small world-hint">
            {total === 0 ? (
              t('Complete tasks to grow your {world}.', { world: t(theme.name).toLowerCase() })
            ) : streak.size > 0 ? (
              <>
                <Flame size={13} aria-hidden="true" /> {t('{n}-day streak', { n: streak.size })}
              </>
            ) : null}
          </span>
        </div>
        <div className="world-legend">
          <span className="muted small">{t('Less')}</span>
          {([0, 1, 2, 3, 4] as WorldLevel[]).map((level) => {
            const art = theme.plotArt(level, LEGEND_FLAGS);
            return (
              <svg key={level} className="world-legend-glyph" viewBox="-15 -32 30 44" aria-hidden="true">
                <g className={`world-cell level-${level}${level > 0 ? ' is-grown' : ''}`}>
                  {!art?.ground && (
                    <>
                      <polygon className="world-face-left" points={FACE_LEFT} />
                      <polygon className="world-face-right" points={FACE_RIGHT} />
                      <polygon className="world-top" points={TOP} />
                    </>
                  )}
                  {art && <use href={`#${art.symbol}`} className={`world-art level-${level}`} />}
                </g>
              </svg>
            );
          })}
          <span className="muted small">{t('More')}</span>
        </div>
      </div>
    </section>
  );
}
