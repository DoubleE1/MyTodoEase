import { useCallback, useEffect, useState } from 'react';
import { applyAccent, readStoredAccent, storeAccent } from './accent';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'mytodoease.theme';
const ORDER: ThemePreference[] = ['light', 'dark', 'system'];

function readStored(): ThemePreference {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Theme preference with persistence. Applies `data-theme="light|dark"` on <html>
 * so CSS variables switch; "system" follows the OS and reacts to live changes.
 */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readStored);
  const [accent, setAccentState] = useState<string>(readStoredAccent);

  useEffect(() => {
    const apply = () => {
      const resolved = preference === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : preference;
      document.documentElement.dataset.theme = resolved;
      // The accent family depends on the resolved theme (lighter shades on dark).
      applyAccent(accent, resolved);
      // The Electron shell draws the native window buttons; keep their colors in step.
      window.mytodoease?.setTitleBarTheme?.(resolved).catch(() => {});
    };
    apply();
    try {
      window.localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Storage unavailable (private mode etc.); the choice just will not persist.
    }
    if (preference !== 'system' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preference, accent]);

  const cycle = useCallback(
    () => setPreference((current) => ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]),
    [],
  );

  const setAccent = useCallback((hex: string) => {
    const value = hex.toLowerCase();
    storeAccent(value);
    setAccentState(value);
  }, []);

  return { preference, setPreference, cycle, accent, setAccent };
}
