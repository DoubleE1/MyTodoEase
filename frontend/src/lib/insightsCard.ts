import { useSyncExternalStore } from 'react';

/**
 * Whether the sidebar shows the Insights overview card (Settings > Appearance). When it is hidden the
 * sidebar lists Insights as a plain nav item instead, so the page stays one click away.
 */
const STORAGE_KEY = 'todoease.showInsightsCard';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

let current = read();

export function setShowInsightsCard(show: boolean) {
  current = show;
  try {
    localStorage.setItem(STORAGE_KEY, show ? 'on' : 'off');
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
  listeners.forEach((l) => l());
}

export function useShowInsightsCard(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
