import { format, parseISO } from 'date-fns';
import { Lock, Trophy } from 'lucide-react';
import { CATEGORY_TITLES, SHOP_TIERS, TOTAL_POINTS, type AchievementState, type Category } from '../lib/achievements';
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
  return (
    <section className="shop" aria-label={t('Skin shop preview')}>
      <p className="settings-help">
        {t('Skins for your avatar, pet, borders, sticky notes, background and Insights are on the way. Points you earn now are kept for them. All 50 achievements buy one or two skins.')}
      </p>
      <ul className="shop-grid">
        {SHOP_TIERS.map((tier) => {
          const short = Math.max(0, tier.price - points);
          return (
            <li key={tier.id} className={`shop-tier tier-${tier.id}`}>
              <div className="shop-tier-head">
                <span className="shop-tier-name">{tier.name}</span>
                <span className="shop-tier-price">{t('{n} points', { n: tier.price.toLocaleString() })}</span>
              </div>
              <ul className="shop-examples">
                {tier.examples.map((example) => (
                  <li key={example}>{example}</li>
                ))}
              </ul>
              <span className="muted small">
                {short === 0 ? t('You have enough points for this tier.') : t('{n} more points to go.', { n: short.toLocaleString() })}
              </span>
              <button type="button" className="btn" disabled>
                {t('Coming soon')}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
