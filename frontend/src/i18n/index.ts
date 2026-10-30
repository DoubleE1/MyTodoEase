import { setDefaultOptions, type Locale } from 'date-fns';
import { ja as jaDates } from 'date-fns/locale/ja';
import { ko as koDates } from 'date-fns/locale/ko';
import { zhCN as zhDates } from 'date-fns/locale/zh-CN';
import { ja } from './ja';
import { ko } from './ko';
import { zhCN } from './zh-CN';

/**
 * Interface languages. The English text is the key: `t('Add task')`. A string missing from a dictionary
 * shows in English, so untranslated text never breaks the page. `{name}` placeholders are filled from `vars`.
 *
 * The language is read once when the page loads; changing it in Settings saves it and reloads the window,
 * so no component needs to listen for changes.
 */
export type Language = 'en' | 'zh-CN' | 'ja' | 'ko';

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'zh-CN', label: '简体中文' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
];

const DICTIONARIES: Record<Exclude<Language, 'en'>, Record<string, string>> = { 'zh-CN': zhCN, ja, ko };
const DATE_LOCALES: Record<Exclude<Language, 'en'>, Locale> = { 'zh-CN': zhDates, ja: jaDates, ko: koDates };
const STORAGE_KEY = 'todoease.language';

/** The saved choice, else the system language when it is one we have, else English. */
function detect(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGUAGES.some((l) => l.id === saved)) return saved as Language;
  } catch {
    // Storage unavailable: fall through to the system language.
  }
  const system = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase();
  if (system.startsWith('zh')) return 'zh-CN';
  if (system.startsWith('ja')) return 'ja';
  if (system.startsWith('ko')) return 'ko';
  return 'en';
}

export const language: Language = detect();
const dictionary = language === 'en' ? null : DICTIONARIES[language];

/** Translate `text` (English) into the interface language, filling `{placeholders}`. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const translated = dictionary?.[text] ?? text;
  if (!vars) return translated;
  return translated.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

/** "1 task" / "3 tasks" in English; other languages have one form, taken from the plural key. */
export function tCount(n: number, one: string, many: string): string {
  return t(n === 1 ? one : many, { n });
}

export type DatePattern = 'dayMonth' | 'dayMonthYear' | 'weekdayDayMonth' | 'weekdayLong' | 'monthYear' | 'time';

/** date-fns patterns in each language's own order ("31 Oct" / "10月31日" / "10월 31일"), plus the time of day. */
const PATTERNS: Record<Language, Record<DatePattern, string>> = {
  en: { dayMonth: 'd MMM', dayMonthYear: 'd MMM yyyy', weekdayDayMonth: 'EEE d MMM', weekdayLong: 'EEEE d MMMM', monthYear: 'MMMM yyyy', time: 'h:mm a' },
  'zh-CN': { dayMonth: 'M月d日', dayMonthYear: 'yyyy年M月d日', weekdayDayMonth: 'M月d日 EEE', weekdayLong: 'M月d日 EEEE', monthYear: 'yyyy年M月', time: 'a h:mm' },
  ja: { dayMonth: 'M月d日', dayMonthYear: 'yyyy年M月d日', weekdayDayMonth: 'M月d日(EEE)', weekdayLong: 'M月d日 EEEE', monthYear: 'yyyy年M月', time: 'H:mm' },
  ko: { dayMonth: 'M월 d일', dayMonthYear: 'yyyy년 M월 d일', weekdayDayMonth: 'M월 d일 (EEE)', weekdayLong: 'M월 d일 EEEE', monthYear: 'yyyy년 M월', time: 'a h:mm' },
};

export const datePattern = (kind: DatePattern) => PATTERNS[language][kind];

/** Call once at start-up: page language for screen readers, and month/day names in every date-fns format(). */
export function applyLanguage() {
  document.documentElement.lang = language;
  if (language !== 'en') setDefaultOptions({ locale: DATE_LOCALES[language] });
}

export function setLanguage(next: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not saved; the reload below still shows it for this session's page.
  }
  window.location.reload();
}
