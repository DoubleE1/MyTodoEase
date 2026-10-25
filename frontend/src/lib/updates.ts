import { useCallback, useEffect, useState } from 'react';

/**
 * Automatic-update state of the desktop app (electron-updater in desktop/main.cjs).
 * In a browser there is no shell: `state` stays null and the actions do nothing.
 */
export function useUpdateState() {
  const desktop = window.mytodoease;
  const supported = !!desktop?.getUpdateState;
  const [state, setState] = useState<DesktopUpdateState | null>(null);

  useEffect(() => {
    if (!desktop?.getUpdateState) return;
    desktop
      .getUpdateState()
      .then(setState)
      .catch(() => {
        // Older shell without the updater: nothing to show.
      });
    return desktop.onUpdateState?.(setState);
  }, [desktop]);

  const check = useCallback(async () => {
    if (!desktop?.checkForUpdates) return;
    try {
      setState(await desktop.checkForUpdates());
    } catch {
      // The shell reports failures through the pushed state.
    }
  }, [desktop]);

  const install = useCallback(async () => {
    if (!desktop?.installUpdate) return false;
    try {
      return await desktop.installUpdate();
    } catch {
      return false;
    }
  }, [desktop]);

  return { supported, state, check, install };
}

/** One line describing the update state for Settings > About. */
export function describeUpdateState(state: DesktopUpdateState): string {
  const version = state.version ? `TodoEase ${state.version}` : 'The update';
  switch (state.status) {
    case 'checking':
      return 'Checking for updates…';
    case 'downloading':
      return `Downloading ${version}… ${state.progress}%`;
    case 'ready':
      return `${version} is downloaded. Restart to finish updating.`;
    case 'up-to-date':
      return "You're up to date.";
    case 'error':
      return state.error ?? 'Could not check for updates.';
    case 'unavailable':
      return 'This is a development build; updates are delivered through the installed app.';
    default:
      return 'TodoEase checks for updates when it starts and downloads them in the background.';
  }
}
