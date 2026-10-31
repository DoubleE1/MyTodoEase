import { format, parseISO } from 'date-fns';
import { Lock, Trophy } from 'lucide-react';
import type { ReactNode } from 'react';
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
export function ShopView() {
  const { points, ready } = useAchievements();
  return (
    <div className="view view-achievements">
      <header className="view-header">
        <div className="view-header-row">
          <h1>{t('Shop')}</h1>
        </div>
        <PointsSummary points={points}>{t('points to spend')}</PointsSummary>
        {!ready && <p className="muted small">{t('Counting your history…')}</p>}
      </header>
      <Shop points={points} />
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

function Shop({ points }: { points: number }) {
  // Jump to a section (the page scrolls inside the main pane).
  const jump = (id: string) =>
    document.getElementById(`shop-${id}`)?.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'start' });
  return (
    <section className="shop" aria-label={t('Skin shop preview')}>
      <p className="settings-help">
        {t('Skins for your avatar, pet, borders, sticky notes, background and Insights are on the way. Points you earn now are kept for them. All 50 achievements buy one or two skins.')}
      </p>
      <nav className="shop-cats" aria-label={t('Shop sections')}>
        {SHOP_CATEGORIES.map((category) => (
          <button key={category.id} type="button" className="chip" onClick={() => jump(category.id)}>
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
      {SHOP_CATEGORIES.map((category) => (
        <section key={category.id} id={`shop-${category.id}`} className="shop-section" aria-labelledby={`shop-${category.id}-title`}>
          <h2 id={`shop-${category.id}-title`} className="shop-section-title">
            {category.name}
          </h2>
          <p className="muted small shop-section-desc">{category.description}</p>
          <ul className="shop-grid">
            {SHOP_ITEMS.filter((item) => item.category === category.id).map((item) => (
              <ShopCard key={item.id} item={item} points={points} />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

function ShopCard({ item, points }: { item: ShopItem; points: number }) {
  const tier = item.tier ? SHOP_TIERS[item.tier] : null;
  const short = tier ? Math.max(0, tier.price - points) : 0;
  return (
    <li className={`shop-item ${item.tier ? `tier-${item.tier}` : 'is-included'}`}>
      <ShopPreview item={item} />
      <div className="shop-item-body">
        <div className="shop-item-head">
          <span className="shop-item-name">{item.name}</span>
          <span className="shop-item-tier">{tier ? tier.name : t('Included')}</span>
        </div>
        <span className="muted small shop-item-desc">{item.description}</span>
        {tier ? (
          <div className="shop-item-foot">
            <span className="shop-item-price">{t('{n} points', { n: tier.price.toLocaleString() })}</span>
            <span className="muted small">
              {short === 0 ? t('Enough points') : t('{n} to go', { n: short.toLocaleString() })}
            </span>
          </div>
        ) : (
          <div className="shop-item-foot">
            <span className="muted small">{t('Everyone has this one.')}</span>
          </div>
        )}
        {tier && (
          <button type="button" className="btn" disabled>
            {t('Coming soon')}
          </button>
        )}
      </div>
    </li>
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
