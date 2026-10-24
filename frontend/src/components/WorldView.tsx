import { format } from 'date-fns';
import { Flame } from 'lucide-react';
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { BLOCK_WIDTH, GROVE_SPRITES, type GroveSpriteName } from '../assets/world/grove/sprites';
import { parseDateStr, todayStr } from '../lib/dates';
import { celebratedStreakDays, completionLevel, type WorldLevel } from '../lib/world';

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

// ---- Grove theme: the owner's rendered sprites (design/world/grove, cut by frontend/scripts/world-sprites.py) ----

const SPRITE_SCALE = TOP_W / BLOCK_WIDTH; // sprite px -> grid units, so every block is TOP_W wide

const marker: CSSProperties = { fill: 'var(--world-marker)' };

function spriteArt(name: GroveSpriteName): PlotArt {
  const sprite = GROVE_SPRITES[name];
  return { symbol: `grove-${name}`, height: sprite.anchorY * SPRITE_SCALE, sway: false, ground: true };
}

const GROVE: WorldTheme = {
  id: 'grove',
  name: 'Grove',
  defs: (
    <>
      {(Object.keys(GROVE_SPRITES) as GroveSpriteName[]).map((name) => {
        const sprite = GROVE_SPRITES[name];
        return (
          <symbol key={name} id={`grove-${name}`} overflow="visible">
            <image
              href={sprite.url}
              x={-sprite.anchorX * SPRITE_SCALE}
              y={-sprite.anchorY * SPRITE_SCALE}
              width={sprite.width * SPRITE_SCALE}
              height={sprite.height * SPRITE_SCALE}
            />
          </symbol>
        );
      })}
    </>
  ),
  plotArt(level, flags) {
    if (level === 0) return spriteArt('bare');
    // Two species so a busy month does not look like a plantation; the seed keeps a day's tree stable.
    const species = flags.seed < 0.62 ? 'leafy' : 'pine';
    if (species === 'leafy' && level === 1) return spriteArt((flags.seed * 100) % 1 < 0.5 ? 'leafy-1a' : 'leafy-1b');
    return spriteArt(`${species}-${level}` as GroveSpriteName);
  },
};

export const WORLD_THEMES = { grove: GROVE } as const;
export type WorldThemeId = keyof typeof WORLD_THEMES;

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
  themeId?: WorldThemeId;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
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

export function WorldView({ year, weeks, monthLabels, cells, perDay, total, themeId = 'grove' }: WorldViewProps) {
  const theme: WorldTheme = WORLD_THEMES[themeId];
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
    <section className={`world-card world-theme-${theme.id}`} aria-label={`Completions in ${year}, drawn as a world`}>
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
                    aria-label={`${plural(cell.count, 'task')} on ${format(date, 'EEEE d MMMM yyyy')}`}
                  >
                    <title>{`${plural(cell.count, 'task')} on ${format(date, 'EEE d MMM yyyy')}`}</title>
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
        <span className="muted small world-hint">
          {total === 0 ? (
            `Complete tasks to grow your ${theme.name.toLowerCase()}.`
          ) : streak.size > 0 ? (
            <>
              <Flame size={13} aria-hidden="true" /> {streak.size}-day streak
            </>
          ) : null}
        </span>
        <div className="world-legend">
          <span className="muted small">Less</span>
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
          <span className="muted small">More</span>
        </div>
      </div>
    </section>
  );
}
