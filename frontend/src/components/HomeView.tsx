import { format } from 'date-fns';
import { ArrowRight, BookOpen, CircleCheckBig, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Note, Task } from '../api/types';
import { todayStr } from '../lib/dates';
import type { ThemePreference } from '../lib/theme';
import type { View } from '../lib/views';
import { ProfileMenu } from './AccountMenu';
import { greeting } from './Dashboard';
import type { ConfirmOptions } from './Dialogs';
import { Wordmark } from './Logo';
import { useCloudUser } from './SessionGate';
import { datePattern, t } from '../i18n';

interface Feature {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  /** Card tint, as a CSS colour. */
  tone: string;
  /** One live line (counts); absent while the feature is not built yet. */
  stat?: string;
  open?: () => void;
}

/**
 * Home (the TodoEase logo): one card per module (Todo, Notebook, Wallet), so the app can grow beyond the task list.
 * Live modules open on click and show live numbers; planned ones are listed as "Coming soon".
 */
export function HomeView({
  tasks,
  notes,
  onSelectView,
  confirm,
  onOpenSettings,
  themePreference,
  onSetTheme,
}: {
  tasks: Task[];
  notes: Note[];
  onSelectView: (view: View) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  onOpenSettings: () => void;
  themePreference: ThemePreference;
  onSetTheme: (preference: ThemePreference) => void;
}) {
  const user = useCloudUser();
  const now = new Date();
  const firstName = user?.displayName?.split(' ')[0];

  const today = todayStr();
  const dueToday = tasks.filter((task) => task.dueDate === today).length;
  const overdue = tasks.filter((task) => task.dueDate !== null && task.dueDate < today).length;
  const activeNotes = notes.filter((note) => !note.isArchived).length;

  const taskLine =
    dueToday + overdue === 0
      ? t('Nothing due today')
      : overdue > 0
        ? t('{due} due today · {late} overdue', { due: dueToday, late: overdue })
        : t('{due} due today', { due: dueToday });
  const noteLine = activeNotes === 1 ? t('1 note') : t('{n} notes', { n: activeNotes });

  // One card per module. Todo holds tasks, projects, the calendar and sticky notes; the others are their own modules.
  const features: Feature[] = [
    {
      id: 'todo',
      title: t('Todo'),
      description: t('Tasks, projects, calendar and sticky notes.'),
      icon: <CircleCheckBig size={22} />,
      tone: '#7b6cff',
      stat: `${taskLine} · ${noteLine}`,
      open: () => onSelectView({ kind: 'today' }),
    },
    {
      id: 'notebook',
      title: t('Notebook'),
      description: t('Pages and folders for longer writing.'),
      icon: <BookOpen size={22} />,
      tone: '#2fb8a6',
    },
    {
      id: 'wallet',
      title: t('Wallet'),
      description: t('Track spending and stay on budget.'),
      icon: <Wallet size={22} />,
      tone: '#4caf6e',
    },
  ];

  return (
    <div className="view view-home">
      {/* No feature sidebar here: just the logo and the profile menu (Settings, theme, account). */}
      <div className="home-bar">
        <Wordmark size={26} />
        <ProfileMenu
          confirm={confirm}
          rail={false}
          onOpenSettings={onOpenSettings}
          onSelectView={onSelectView}
          themePreference={themePreference}
          onSetTheme={onSetTheme}
        />
      </div>
      <header className="home-head">
        <h1>{firstName ? t('{greeting}, {name}', { greeting: greeting(now), name: firstName }) : greeting(now)}</h1>
        <p className="muted">{format(now, datePattern('weekdayLong'))}</p>
      </header>

      <ul className="home-grid" aria-label={t('Features')}>
        {features.map((feature) => (
          <li key={feature.id} style={{ '--tone': feature.tone } as React.CSSProperties}>
            {feature.open ? (
              <button type="button" className="home-card" onClick={feature.open}>
                <FeatureBody feature={feature} />
              </button>
            ) : (
              <div className="home-card is-soon" aria-disabled="true">
                <FeatureBody feature={feature} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeatureBody({ feature }: { feature: Feature }) {
  return (
    <>
      <span className="home-card-top">
        <span className="home-card-icon" aria-hidden="true">
          {feature.icon}
        </span>
        {feature.open ? (
          <ArrowRight size={18} className="home-card-arrow" aria-hidden="true" />
        ) : (
          <span className="home-card-badge">{t('Coming soon')}</span>
        )}
      </span>
      <span className="home-card-title">{feature.title}</span>
      <span className="home-card-desc">{feature.description}</span>
      {feature.stat && <span className="home-card-stat">{feature.stat}</span>}
    </>
  );
}
