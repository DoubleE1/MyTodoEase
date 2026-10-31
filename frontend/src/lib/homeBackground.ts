import { useSyncExternalStore } from 'react';

/**
 * Home's background effects, the start of the shop's "background" category. For now one is picked with a
 * switcher that only appears on the local dev server (HomeView), to compare them; the choice is kept per device.
 */
export type HomeBackground = 'field' | 'field-todoease' | 'dots' | 'dots-full' | 'plain';

export const HOME_BACKGROUNDS: { id: HomeBackground; label: string }[] = [
  { id: 'field', label: 'Character field (shadcn style)' },
  { id: 'field-todoease', label: 'Character field (TodoEase)' },
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
