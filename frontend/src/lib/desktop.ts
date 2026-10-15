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
  const [docked, setDockedState] = useState(false);
  const [canDock, setCanDock] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    const apply = (state: DesktopWindowState) => {
      setCompactState(state.compact);
      setAlwaysOnTopState(state.alwaysOnTop);
      setDockedState(Boolean(state.docked));
      setCanDock(Boolean(state.canDock));
    };
    desktop
      .getWindowState()
      .then(apply)
      .catch(() => {
        // Older shell without the IPC handlers: stay in normal mode.
      });
    // The shell can change state on its own (dock on startup, leaving mini mode releases the dock).
    return desktop.onWindowState?.(apply);
  }, [desktop]);

  const setDocked = useCallback(
    async (flag: boolean) => {
      if (!desktop?.setDocked) return;
      const applied = await desktop.setDocked(flag).catch(() => docked);
      setDockedState(applied);
      if (applied) setCompactState(true); // docking implies mini mode
    },
    [desktop, docked],
  );

  const setCompact = useCallback(
    async (flag: boolean) => {
      setCompactState(flag);
      if (desktop) {
        const applied = await desktop.setCompact(flag).catch(() => flag);
        setCompactState(applied);
        if (!applied) setDockedState(false); // leaving mini mode releases the dock
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

  return { isDesktop, compact, alwaysOnTop, docked, canDock, setCompact, setAlwaysOnTop, setDocked };
}
