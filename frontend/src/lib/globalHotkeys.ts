import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useNoteMutations } from '../api/hooks';
import { popOutNote } from './notes';
import { showToast } from './toast';
import { t } from '../i18n';

/**
 * Desktop app only: shortcuts that work in every app (Settings > Desktop app), held by the Electron shell as
 * accelerators such as "Control+Alt+T". The recorder reads `KeyboardEvent.code`, so Shift never changes the key
 * (Ctrl+Shift+` stays "`", not "~") and the shortcut matches what the shell registers.
 */
export type GlobalHotkeyAction = 'newTask' | 'newNote';

export const GLOBAL_HOTKEY_DEFAULTS: Record<GlobalHotkeyAction, string> = {
  newTask: 'Control+Alt+T',
  newNote: 'Control+Alt+N',
};

const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return CODE_KEYS[code] ?? null;
}

/** Fallback when the event carries no `code` (some remote and virtual keyboards): read the typed key instead. */
function keyFromKey(key: string): string | null {
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key;
  if (key === ' ') return 'Space';
  if ('`-=[]\\;\',./'.includes(key) && key.length === 1) return key;
  return CODE_KEYS[key] ?? null;
}

/** Reads a global shortcut from a key press: an accelerator, an error to show, or null while only modifiers are down. */
export function acceleratorFromEvent(event: KeyboardEvent): string | { error: string } | null {
  if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS'].includes(event.key)) return null;
  const key = event.code ? keyFromCode(event.code) : keyFromKey(event.key);
  if (!key) return { error: t('That key cannot be used. Try a letter, number or F-key.') };
  // Without Ctrl or Alt the key would be taken from every app you type in.
  if (!event.ctrlKey && !event.altKey) return { error: t('Add Ctrl or Alt, so typing in other apps still works.') };
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** ['Ctrl', 'Alt', 'T'] for <kbd> chips. */
export function acceleratorParts(accelerator: string): string[] {
  return accelerator.split('+').map((part) => (part === 'Control' ? 'Ctrl' : part === 'Space' ? 'Space' : part));
}

/** The shell's background-mode settings, read once and updated through the shell (null outside the desktop app). */
export function useDesktopPrefs() {
  const desktop = window.mytodoease;
  const [prefs, setPrefs] = useState<DesktopPrefs | null>(null);
  useEffect(() => {
    void desktop?.getDesktopPrefs?.().then(setPrefs);
  }, [desktop]);
  const update = useCallback(
    async (patch: Parameters<NonNullable<NonNullable<Window['mytodoease']>['setDesktopPrefs']>>[0]) => {
      const next = await desktop?.setDesktopPrefs?.(patch);
      if (next) setPrefs(next);
    },
    [desktop],
  );
  return { prefs, update };
}

/**
 * Main window, desktop app: hands the tray its labels in the app's language, refetches when the quick-add
 * popup added a task, and makes the note asked for by the "New sticky note" shortcut.
 */
export function useBackgroundModeBridge() {
  const queryClient = useQueryClient();
  const noteMut = useNoteMutations();
  const createNote = noteMut.create.mutateAsync;

  useEffect(() => {
    const desktop = window.mytodoease;
    if (!desktop) return;
    void desktop.setTrayLabels?.({ open: t('Open TodoEase'), newTask: t('New task'), newNote: t('New sticky note'), quit: t('Quit TodoEase') });
    const offTasks = desktop.onTasksChanged?.(() => void queryClient.invalidateQueries());
    const offNote = desktop.onNewNoteRequest?.(() => {
      void createNote({ text: '', color: 'yellow' })
        .then((note) => popOutNote(note.id))
        .catch((error: unknown) => showToast(error instanceof Error ? error.message : t('Could not create the note.'), 'error'));
    });
    return () => {
      offTasks?.();
      offNote?.();
    };
  }, [queryClient, createNote]);
}
