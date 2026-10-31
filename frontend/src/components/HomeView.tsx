import { ArrowRight, BookOpen, CalendarDays, CircleCheckBig, Clock3, Wallet } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import type { Note, Task } from '../api/types';
import { todayStr } from '../lib/dates';
import { HOME_BACKGROUNDS, LINE_WORD_MAX, setHomeBackground, setLineWord, useHomeBackground, useLineWord, type HomeBackground } from '../lib/homeBackground';
import type { ThemePreference } from '../lib/theme';
import type { View } from '../lib/views';
import { ProfileMenu } from './AccountMenu';
import { AsciiField } from './AsciiField';
import { BlackHole } from './BlackHole';
import { ChromaTrail } from './ChromaTrail';
import { DotTrail } from './DotTrail';
import { LineField, type WordBox } from './LineField';
import type { ConfirmOptions } from './Dialogs';
import { Wordmark } from './Logo';
import { t } from '../i18n';

/** Put the text cursor after the last character (after the browser has placed it where the click was). */
function caretToEnd(input: HTMLInputElement) {
  requestAnimationFrame(() => {
    const end = input.value.length;
    if (input.selectionStart !== end || input.selectionEnd !== end) input.setSelectionRange(end, end);
  });
}

/** The text the background effects keep clear of, so it stays readable. */
const HOME_CLEAR = '.home-bar > *, .home-head p';

interface Feature {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  /** Card colour, as a CSS colour. */
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
  const background = useHomeBackground();
  // The line wave's word: click it to change it; the lines follow while typing.
  const lineWord = useLineWord();
  const [wordBox, setWordBox] = useState<WordBox | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  /** Esc: leave without saving (the blur that follows must not save). */
  const cancelWord = useRef(false);
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
      icon: <CircleCheckBig size={24} />,
      tone: '#7160ff',
      stat: `${taskLine} · ${noteLine}`,
      open: () => onSelectView({ kind: 'today' }),
    },
    {
      id: 'notebook',
      title: t('Notebook'),
      description: t('Pages and folders for longer writing.'),
      icon: <BookOpen size={24} />,
      tone: '#3fb8a3',
    },
    {
      id: 'wallet',
      title: t('Wallet'),
      description: t('Track spending and stay on budget.'),
      icon: <Wallet size={24} />,
      tone: '#f0a23a',
    },
  ];

  return (
    <div className="view view-home" data-bg={background}>
      {/* The background effect (decoration only). The "dots" ones are the Tasks pages' header art, shown via CSS. */}
      <div className="home-decor" aria-hidden="true">
        {background === 'field' && <AsciiField word="TodoEase" clearOf={HOME_CLEAR} className="home-field" />}
        {background === 'field-todoease' && <AsciiField word="TodoEase" variant="todoease" clearOf={HOME_CLEAR} className="home-field" />}
        {background === 'dots-full' && <DotTrail className="home-field" />}
        {background === 'chroma' && <ChromaTrail word="TodoEase" below=".home-grid" className="home-field" />}
        {background === 'blackhole' && <BlackHole below=".home-grid" className="home-field" />}
        {background === 'lines' && (
          <LineField word={draft ?? lineWord} caret={draft !== null} below=".home-grid" className="home-field" onWordBox={setWordBox} />
        )}
      </div>
      {/* Edit the word right in the background: an invisible field over it takes the typing (and brings up a
          phone's keyboard); the lines show the word and a blinking bar. Enter or clicking away saves, Esc cancels. */}
      {background === 'lines' && wordBox && (
        <input
          className={`home-word-input ${draft !== null ? 'is-editing' : ''}`}
          style={{ left: wordBox.left, top: wordBox.top, width: wordBox.width, height: wordBox.height }}
          value={draft ?? lineWord}
          maxLength={LINE_WORD_MAX}
          spellCheck={false}
          autoComplete="off"
          aria-label={t('Background word')}
          data-tooltip={draft === null ? t('Click to change the word') : undefined}
          onFocus={(e) => {
            cancelWord.current = false;
            setDraft(lineWord);
            caretToEnd(e.currentTarget);
          }}
          // The bar in the lines is always after the last letter, so the real cursor stays there too.
          onSelect={(e) => caretToEnd(e.currentTarget)}
          onMouseUp={(e) => caretToEnd(e.currentTarget)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (!cancelWord.current && draft !== null) setLineWord(draft);
            setDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              e.stopPropagation();
              cancelWord.current = true;
              e.currentTarget.blur();
            }
          }}
        />
      )}
      {import.meta.env.DEV && <BackgroundSwitcher value={background} />}

      <div className="home-page">
      {/* No feature sidebar here: just the logo and the profile menu (Settings, theme, account). */}
      <div className="home-bar">
        <Wordmark size={28} />
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
        <h1 className="sr-only">{t('Home')}</h1>
        <p>{t('Organize your tasks, notes and finances, all in one place.')}</p>
      </header>

      <ul className="home-grid" aria-label={t('Features')}>
        {features.map((feature) => (
          <li key={feature.id} style={{ '--tone': feature.tone } as React.CSSProperties}>
            {feature.open ? (
              <button type="button" className="home-card is-live" onClick={feature.open}>
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
        <span className="home-card-arrow" aria-hidden="true">
          <ArrowRight size={16} />
        </span>
      </span>
      <span className="home-card-title">{feature.title}</span>
      <span className="home-card-desc">{feature.description}</span>
      <span className="home-card-pill">
        {feature.open ? <CalendarDays size={14} aria-hidden="true" /> : <Clock3 size={14} aria-hidden="true" />}
        <span>{feature.stat ?? t('Coming soon')}</span>
      </span>
    </>
  );
}

/**
 * Development only (never in a build): pick Home's background to compare the effects. To be replaced by the
 * shop's background category.
 */
function BackgroundSwitcher({ value }: { value: HomeBackground }) {
  return (
    <label className="home-bg-switcher">
      <span>Background (dev)</span>
      <select value={value} onChange={(e) => setHomeBackground(e.target.value as HomeBackground)}>
        {HOME_BACKGROUNDS.map((b) => (
          <option key={b.id} value={b.id}>
            {b.label}
          </option>
        ))}
      </select>
    </label>
  );
}
