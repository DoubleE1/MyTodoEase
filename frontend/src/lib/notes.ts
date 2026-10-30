import { useQueryClient } from '@tanstack/react-query';
import { differenceInMinutes, format, parseISO } from 'date-fns';
import { useEffect } from 'react';
import { queryKeys } from '../api/hooks';
import type { Note, NoteColor } from '../api/types';
import { recordEvent } from './achievements';
import { datePattern, t } from '../i18n';

/** Short "edited" time that fits the note footer: just now, 5m ago, 3h ago, then the date. */
export function editedLabel(iso: string): string {
  const date = parseISO(iso);
  const minutes = differenceInMinutes(new Date(), date);
  if (minutes < 1) return t('just now');
  if (minutes < 60) return t('{n}m ago', { n: minutes });
  if (minutes < 24 * 60) return t('{n}h ago', { n: Math.floor(minutes / 60) });
  return format(date, datePattern('dayMonth'));
}

export const COLOR_LABELS: Record<NoteColor, string> = {
  yellow: t('Yellow'),
  green: t('Green'),
  blue: t('Blue'),
  pink: t('Pink'),
  purple: t('Purple'),
  orange: t('Orange'),
  grey: t('Grey'),
};

/** The note's first line, for titles and window names. */
export const noteTitle = (note: Pick<Note, 'text'>) => note.text.trim().split('\n')[0]?.slice(0, 60) || t('Empty note');

/** Desktop: pop a note out into its own window. Absent in the browser. */
export const canPopOutNotes = () => typeof window !== 'undefined' && !!window.mytodoease?.openNote;

export function popOutNote(id: string) {
  recordEvent('notePopped');
  void window.mytodoease?.openNote?.(id);
}

/** Tell the other windows (main app, mini list, popped-out notes) that notes changed so they refetch. */
export function announceNotesChanged() {
  window.mytodoease?.notesChanged?.();
}

/** Refetch notes when another window changed them (desktop only; a no-op in the browser). */
export function useNotesSync() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const off = window.mytodoease?.onNotesChanged?.(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.notes });
    });
    return () => off?.();
  }, [queryClient]);
}
