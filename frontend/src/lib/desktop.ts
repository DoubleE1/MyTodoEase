import { useCallback, useEffect, useState } from 'react';

const COMPACT_KEY = 'mytodoease.compact';

function readStoredCompact(): boolean {
  try {
    return window.localStorage.getItem(COMPACT_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Window mode shared between the React UI and the Electron shell.
 * In Electron the shell owns the truth (it resizes and pins the window); in a browser
 * "compact" is just a layout preference kept in localStorage and "pin" is unavailable.
 */
export function useWindowMode() {
  const desktop = window.mytodoease;
  const isDesktop = !!desktop;
  const [compact, setCompactState] = useState<boolean>(() => (isDesktop ? false : readStoredCompact()));
  const [alwaysOnTop, setAlwaysOnTopState] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    desktop
      .getWindowState()
      .then((state) => {
        setCompactState(state.compact);
        setAlwaysOnTopState(state.alwaysOnTop);
      })
      .catch(() => {
        // Older shell without the IPC handlers: stay in normal mode.
      });
  }, [desktop]);

  const setCompact = useCallback(
    async (flag: boolean) => {
      setCompactState(flag);
      if (desktop) {
        const applied = await desktop.setCompact(flag).catch(() => flag);
        setCompactState(applied);
      } else {
        try {
          window.localStorage.setItem(COMPACT_KEY, String(flag));
        } catch {
          // Not persisted; fine.
        }
      }
    },
    [desktop],
  );

  const setAlwaysOnTop = useCallback(
    async (flag: boolean) => {
      if (!desktop) return;
      const applied = await desktop.setAlwaysOnTop(flag).catch(() => alwaysOnTop);
      setAlwaysOnTopState(applied);
    },
    [desktop, alwaysOnTop],
  );

  return { isDesktop, compact, alwaysOnTop, setCompact, setAlwaysOnTop };
}
