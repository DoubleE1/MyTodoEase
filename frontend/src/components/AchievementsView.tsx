import { format, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, Lock, Trophy } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CATEGORY_TITLES,
  SHOP_CATEGORIES,
  SHOP_ITEMS,
  SHOP_TIERS,
  TOTAL_POINTS,
  type AchievementState,
  type Category,
  type ShopCategoryId,
  type ShopItem,
  type ShopTierId,
} from '../lib/achievements';
import { motionReduced } from '../lib/motion';
import { AsciiField } from './AsciiField';
import { BlackHole } from './BlackHole';
import { ChromaTrail } from './ChromaTrail';
import { Modal } from './Dialogs';
import { DotTrail } from './DotTrail';
import { LineField } from './LineField';
import { useAchievements } from '../lib/useAchievements';
import { datePattern, t } from '../i18n';

const CATEGORY_ORDER: Category[] = ['start', 'milestones', 'streaks', 'habits', 'planning', 'notes', 'insights', 'hidden'];

/**
 * Achievements and points (docs/ACHIEVEMENTS.md). The skin shop is its own page (ShopView); both open from the
 * profile menu.
 */
export function AchievementsView() {
  const { states, points, ready } = useAchievements();
  const unlockedCount = states.filter((s) => s.unlocked).length;

  return (
    <div className="view view-achievements">
      <header className="view-header">
        <div className="view-header-row">
          <h1>{t('Achievements')}</h1>
        </div>
        <PointsSummary points={points}>
          {t('points · {unlocked} of {all} unlocked · {total} in total', { unlocked: unlockedCount, all: states.length, total: TOTAL_POINTS.toLocaleString() })}
        </PointsSummary>
        {!ready && <p className="muted small">{t('Counting your history…')}</p>}
      </header>

      {CATEGORY_ORDER.map((category) => {
        const items = states.filter((s) => s.def.category === category);
        const earned = items.filter((s) => s.unlocked).reduce((n, s) => n + s.def.points, 0);
        const total = items.reduce((n, s) => n + s.def.points, 0);
        return (
          <section key={category} className="achievement-group" aria-label={CATEGORY_TITLES[category]}>
            <div className="achievement-group-head">
              <h2>{CATEGORY_TITLES[category]}</h2>
              <span className="muted small">
                {t('{earned} / {total} points', { earned: earned.toLocaleString(), total: total.toLocaleString() })}
              </span>
            </div>
            <ul className="achievement-grid">
              {items.map((s) => (
                <AchievementCard key={s.def.id} state={s} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * A preview of the skin shop. Skins are not on sale yet (the "Skin change" task); it shows the tiers and what
 * the points will buy.
 */
export function ShopView({ section, onOpenSection }: { section?: ShopCategoryId; onOpenSection: (section: ShopCategoryId | null) => void }) {
  const { points, ready } = useAchievements();
  const rootRef = useRef<HTMLDivElement>(null);
  const lastSection = useRef<ShopCategoryId | undefined>(undefined);
  const category = SHOP_CATEGORIES.find((c) => c.id === section);

  // A section page starts at its top; going back to the whole shop returns to the section you came from.
  useEffect(() => {
    if (section) rootRef.current?.scrollIntoView({ block: 'start' });
    else if (lastSection.current) document.getElementById(`shop-${lastSection.current}`)?.scrollIntoView({ block: 'start' });
    lastSection.current = section;
  }, [section]);

  return (
    <div className="view view-achievements" ref={rootRef}>
      <header className="view-header">
        {category && (
          <button type="button" className="shop-back" onClick={() => onOpenSection(null)}>
            <ChevronLeft size={15} aria-hidden="true" />
            {t('Shop')}
          </button>
        )}
        <div className="view-header-row">
          <h1>{category ? category.name : t('Shop')}</h1>
        </div>
        <PointsSummary points={points}>{t('points to spend')}</PointsSummary>
        {!ready && <p className="muted small">{t('Counting your history…')}</p>}
      </header>
      <Shop points={points} section={category?.id} onOpenSection={onOpenSection} />
    </div>
  );
}

function PointsSummary({ points, children }: { points: number; children: React.ReactNode }) {
  return (
    <div className="points-summary" aria-live="polite">
      <span className="points-value">{points.toLocaleString()}</span>
      <span className="muted">{children}</span>
      <span className="points-bar" aria-hidden="true">
        <span style={{ width: `${(points / TOTAL_POINTS) * 100}%` }} />
      </span>
    </div>
  );
}

function AchievementCard({ state }: { state: AchievementState }) {
  const { def, current, target, unlocked, unlockedAt } = state;
  const secret = def.hidden && !unlocked;
  const pct = Math.round((current / target) * 100);
  return (
    <li className={`achievement-card ${unlocked ? 'is-unlocked' : ''}`}>
      <span className="achievement-badge" aria-hidden="true">
        {unlocked ? <Trophy size={18} /> : <Lock size={16} />}
      </span>
      <div className="achievement-text">
        <span className="achievement-name">{secret ? '???' : def.name}</span>
        <span className="achievement-desc">{secret ? t('A hidden achievement. Keep exploring.') : def.description}</span>
        {unlocked ? (
          <span className="achievement-when">{unlockedAt ? t('Unlocked {date}', { date: format(parseISO(unlockedAt), datePattern('dayMonthYear')) }) : t('Unlocked')}</span>
        ) : (
          !secret &&
          target > 1 && (
            <span
              className="achievement-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={target}
              aria-valuenow={current}
              aria-label={`${current} of ${target}`}
            >
              <span className="achievement-progress-bar">
                <span style={{ width: `${pct}%` }} />
              </span>
              <span className="muted small">
                {current.toLocaleString()} / {target.toLocaleString()}
              </span>
            </span>
          )
        )}
      </div>
      <span className="achievement-points">+{def.points.toLocaleString()}</span>
    </li>
  );
}

/** Cards a section shows on the whole-shop page; a section with more ends in a Show more card that opens its own page. */
const SECTION_PREVIEW = 5;

function Shop({ points, section, onOpenSection }: { points: number; section?: ShopCategoryId; onOpenSection: (section: ShopCategoryId | null) => void }) {
  // Jump to a section (the page scrolls inside the main pane). On a section page the buttons open the other sections.
  const jump = (id: ShopCategoryId) => {
    if (section) onOpenSection(id);
    else document.getElementById(`shop-${id}`)?.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'start' });
  };
  const shown = section ? SHOP_CATEGORIES.filter((c) => c.id === section) : SHOP_CATEGORIES;
  // The skin in the preview dialog (clicking a card); its arrows step through the skin's section.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewItem = SHOP_ITEMS.find((item) => item.id === previewId);
  return (
    <section className="shop" aria-label={t('Skin shop preview')}>
      {previewItem && (
        <SkinPreviewDialog item={previewItem} points={points} onStep={setPreviewId} onClose={() => setPreviewId(null)} />
      )}
      {!section && (
        <p className="settings-help">
          {t('Skins for your avatar, pet, borders, sticky notes, background and Insights are on the way. Points you earn now are kept for them. All 50 achievements buy one or two skins.')}
        </p>
      )}
      <nav className="shop-cats" aria-label={t('Shop sections')}>
        {SHOP_CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            className={`chip ${category.id === section ? 'is-active' : ''}`}
            aria-current={category.id === section ? 'page' : undefined}
            onClick={() => jump(category.id)}
          >
            {category.name}
          </button>
        ))}
      </nav>
      <ul className="shop-legend" aria-label={t('Prices')}>
        {(Object.keys(SHOP_TIERS) as ShopTierId[]).map((tier) => (
          <li key={tier} className={`tier-${tier}`}>
            <span className="shop-legend-dot" aria-hidden="true" />
            <span className="shop-legend-name">{SHOP_TIERS[tier].name}</span>
            <span className="muted">{SHOP_TIERS[tier].price.toLocaleString()}</span>
          </li>
        ))}
      </ul>
      {shown.map((category) => {
        const items = SHOP_ITEMS.filter((item) => item.category === category.id);
        const more = section ? 0 : Math.max(0, items.length - SECTION_PREVIEW);
        return (
          <section
            key={category.id}
            id={`shop-${category.id}`}
            className="shop-section"
            aria-label={section ? category.name : undefined}
            aria-labelledby={section ? undefined : `shop-${category.id}-title`}
          >
            {section ? (
              <p className="muted small shop-section-desc">{category.description}</p>
            ) : (
              <>
                <h2 id={`shop-${category.id}-title`} className="shop-section-title">
                  {category.name}
                </h2>
                <p className="muted small shop-section-desc">{category.description}</p>
              </>
            )}
            <ul className="shop-grid">
              {(more ? items.slice(0, SECTION_PREVIEW) : items).map((item) => (
                <ShopCard key={item.id} item={item} points={points} onOpen={() => setPreviewId(item.id)} />
              ))}
              {more > 0 && (
                <li className="shop-more">
                  <button type="button" onClick={() => onOpenSection(category.id)}>
                    <span className="shop-more-icon" aria-hidden="true">
                      <ChevronRight size={18} />
                    </span>
                    <span className="shop-more-label">{t('Show more')}</span>
                    <span className="muted small">{more === 1 ? t('1 more skin') : t('{n} more skins', { n: more })}</span>
                  </button>
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </section>
  );
}

function ShopCard({ item, points, onOpen }: { item: ShopItem; points: number; onOpen: () => void }) {
  const tier = item.tier ? SHOP_TIERS[item.tier] : null;
  return (
    <li className={`shop-item ${item.tier ? `tier-${item.tier}` : 'is-included'}`}>
      <ShopPreview item={item} />
      <div className="shop-item-body">
        <div className="shop-item-head">
          {/* The name's button covers the whole card (styles.css, .shop-item-open), so a click anywhere opens the preview. */}
          <button type="button" className="shop-item-name shop-item-open" onClick={onOpen} aria-haspopup="dialog">
            {item.name}
          </button>
          <span className="shop-item-tier">{tier ? tier.name : t('Included')}</span>
        </div>
        <span className="muted small shop-item-desc">{item.description}</span>
        <ShopPrice item={item} points={points} />
        {tier && (
          <button type="button" className="btn" disabled>
            {t('Coming soon')}
          </button>
        )}
      </div>
    </li>
  );
}

function ShopPrice({ item, points }: { item: ShopItem; points: number }) {
  const tier = item.tier ? SHOP_TIERS[item.tier] : null;
  const short = tier ? Math.max(0, tier.price - points) : 0;
  return tier ? (
    <div className="shop-item-foot">
      <span className="shop-item-price">{t('{n} points', { n: tier.price.toLocaleString() })}</span>
      <span className="muted small">{short === 0 ? t('Enough points') : t('{n} to go', { n: short.toLocaleString() })}</span>
    </div>
  ) : (
    <div className="shop-item-foot">
      <span className="muted small">{t('Everyone has this one.')}</span>
    </div>
  );
}

/**
 * A skin, large. Background effects run for real (the Home page's own effects, inside the stage); the other skins
 * are not made yet, so they show their sketch enlarged. The arrows (or ← →) step through the skin's section.
 */
function SkinPreviewDialog({ item, points, onStep, onClose }: { item: ShopItem; points: number; onStep: (id: string) => void; onClose: () => void }) {
  const siblings = SHOP_ITEMS.filter((other) => other.category === item.category);
  const index = siblings.findIndex((other) => other.id === item.id);
  const category = SHOP_CATEGORIES.find((c) => c.id === item.category);
  const tier = item.tier ? SHOP_TIERS[item.tier] : null;
  const step = (by: number) => onStep(siblings[(index + by + siblings.length) % siblings.length].id);
  const latestStep = useRef(step);
  latestStep.current = step;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if ((event.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
      latestStep.current(event.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const live: Partial<Record<string, ReactNode>> = {
    'bg-dots': <DotTrail className="home-field" />,
    'bg-field': <AsciiField word="TodoEase" className="home-field" />,
    'bg-lines': <LineField word="TodoEase" className="home-field" />,
    'bg-chroma': <ChromaTrail word="TodoEase" className="home-field" />,
    'bg-blackhole': <BlackHole className="home-field" />,
  };
  const hint =
    item.id === 'bg-plain'
      ? t('No effect: the Home page stays calm.')
      : item.id === 'bg-chroma'
        ? t('Click the preview and the light follows the pointer; click again and it signs the word.')
        : item.id === 'bg-blackhole'
          ? t('It follows the pointer. Hold the mouse button to pull harder; click and the disk flares out.')
          : item.category === 'background'
          ? t('Move the pointer over the preview.')
          : t('A sketch: this skin is still being made.');

  return (
    <Modal title={item.name} onClose={onClose} wide className="modal-skin-preview">
      <div className="skin-stage" data-preview={item.id}>
        {item.category === 'background' ? (
          <div className="skin-stage-live" key={item.id}>
            {live[item.id]}
          </div>
        ) : (
          <div className="skin-stage-sketch">
            <ShopPreview item={item} />
          </div>
        )}
        {siblings.length > 1 && (
          <>
            <button type="button" className="skin-stage-step is-prev" onClick={() => step(-1)} aria-label={t('Previous skin')}>
              <ChevronLeft size={20} />
            </button>
            <button type="button" className="skin-stage-step is-next" onClick={() => step(1)} aria-label={t('Next skin')}>
              <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>
      <p className="muted small skin-stage-hint">{hint}</p>
      <div className="skin-detail">
        <div className="skin-detail-head">
          <span className={`shop-item-tier ${item.tier ? `tier-${item.tier}` : 'is-included'}`}>{tier ? tier.name : t('Included')}</span>
          <span className="muted small">
            {category?.name} · {t('{n} of {total}', { n: index + 1, total: siblings.length })}
          </span>
        </div>
        <p className="skin-detail-desc">{item.description}</p>
        <ShopPrice item={item} points={points} />
        {tier && (
          <button type="button" className="btn" disabled>
            {t('Coming soon')}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** A small picture of the skin: a sketch of the part of the app it changes, drawn in CSS (styles.css, .shop-preview). */
function ShopPreview({ item }: { item: ShopItem }) {
  const sketch: Record<ShopCategoryId, ReactNode> = {
    background: null,
    tab: (
      <span className="shop-mock-tab">
        <span className="shop-mock-icon" />
        <span className="shop-mock-line" />
      </span>
    ),
    dashboard: (
      <span className="shop-mock-dash">
        <span className="shop-mock-ring" />
        <span className="shop-mock-bars">
          {[40, 70, 30, 90, 55].map((h, i) => (
            <span key={i} style={{ height: `${h}%` }} />
          ))}
        </span>
      </span>
    ),
    calendar: (
      <span className="shop-mock-cal">
        {Array.from({ length: 14 }, (_, i) => (
          <span key={i} className={i === 9 ? 'is-today' : ''} data-load={(i * 5) % 4} />
        ))}
      </span>
    ),
    notes: <span className="shop-mock-note" />,
    insights: (
      <span className="shop-mock-chart">
        {[30, 55, 45, 80, 65, 95].map((h, i) => (
          <span key={i} style={{ height: `${h}%` }} />
        ))}
      </span>
    ),
    profile: <span className="shop-mock-avatar" />,
    bundle: <span className="shop-mock-avatar" />,
  };
  return (
    <div className="shop-preview" data-preview={item.id} aria-hidden="true">
      {sketch[item.category]}
    </div>
  );
}
