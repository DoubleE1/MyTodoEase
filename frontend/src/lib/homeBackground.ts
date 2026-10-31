import { useSyncExternalStore } from 'react';

/**
 * Home's background effects, the start of the shop's "background" category. For now one is picked with a
 * switcher that only appears on the local dev server (HomeView), to compare them; the choice is kept per device.
 */
export type HomeBackground = 'field' | 'field-todoease' | 'lines' | 'dots' | 'dots-full' | 'plain';

export const HOME_BACKGROUNDS: { id: HomeBackground; label: string }[] = [
  { id: 'field', label: 'Character field (shadcn style)' },
  { id: 'field-todoease', label: 'Character field (TodoEase)' },
  { id: 'lines', label: 'Line wave (word)' },
  { id: 'dots', label: 'Dot halo (Tasks header)' },
  { id: 'dots-full', label: 'Dot halo (full page)' },
  { id: 'plain', label: 'Plain' },
];

const STORAGE_KEY = 'todoease.homeBackground';
const DEFAULT: HomeBackground = 'field';
const listeners = new Set<() => void>();

function read(): HomeBackground {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return HOME_BACKGROUNDS.some((b) => b.id === stored) ? (stored as HomeBackground) : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

let current = read();

export function setHomeBackground(next: HomeBackground) {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
  listeners.forEach((listener) => listener());
}

export function useHomeBackground(): HomeBackground {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

// ---- The line wave's word (click it on Home to change it) ----

const WORD_KEY = 'todoease.lineWord';
export const DEFAULT_LINE_WORD = 'TodoEase';
/** Long words get too thin to read in the lines. */
export const LINE_WORD_MAX = 14;
const wordListeners = new Set<() => void>();

function readWord(): string {
  try {
    return localStorage.getItem(WORD_KEY)?.slice(0, LINE_WORD_MAX) || DEFAULT_LINE_WORD;
  } catch {
    return DEFAULT_LINE_WORD;
  }
}

let currentWord = readWord();

export function setLineWord(next: string) {
  currentWord = next.trim().slice(0, LINE_WORD_MAX) || DEFAULT_LINE_WORD;
  try {
    localStorage.setItem(WORD_KEY, currentWord);
  } catch {
    // Storage unavailable: the word lasts for this session only.
  }
  wordListeners.forEach((listener) => listener());
}

export function useLineWord(): string {
  return useSyncExternalStore(
    (listener) => {
      wordListeners.add(listener);
      return () => wordListeners.delete(listener);
    },
    () => currentWord,
  );
}
