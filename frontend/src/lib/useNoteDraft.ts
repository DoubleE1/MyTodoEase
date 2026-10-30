import { useCallback, useEffect, useRef, useState } from 'react';
import { useNoteMutations } from '../api/hooks';
import type { Note } from '../api/types';

const SAVE_DELAY_MS = 500;

/**
 * Editing a note's text outside the board (popped-out window, mini-mode list): saves shortly after typing
 * stops, and takes in changes made elsewhere only while nothing typed here is waiting to be saved.
 */
export function useNoteDraft(note: Note | undefined) {
  const noteMut = useNoteMutations();
  const [text, setTextState] = useState(note?.text ?? '');
  const pending = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const id = note?.id;

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!id || pending.current === null) return;
    const next = pending.current;
    pending.current = null;
    noteMut.update.mutate({ id, input: { text: next } });
  }, [id, noteMut.update]);

  const setText = (next: string) => {
    setTextState(next);
    pending.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  };

  // Another window (or the board) changed the text: show it, unless this one has unsaved typing.
  useEffect(() => {
    if (note && pending.current === null) setTextState(note.text);
  }, [note?.text]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save what is pending when this editor goes away.
  useEffect(() => () => flush(), [flush]);

  return { text, setText, flush };
}
