import { AppWindow, Archive, Ellipsis, Palette, Plus, Trash2, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNoteMutations, useNotes } from '../api/hooks';
import { NOTE_COLORS } from '../api/types';
import { COLOR_LABELS, editedLabel, noteTitle, popOutNote, useNotesSync } from '../lib/notes';
import { useNoteDraft } from '../lib/useNoteDraft';
import { useTheme } from '../lib/theme';
import { NoteEditor } from './NoteEditor';
import { Popover } from './Popover';
import { Toasts } from './Toasts';
import { TooltipLayer } from './TooltipLayer';
import { t } from '../i18n';

/**
 * One sticky note in its own desktop window (opened with "Open in its own window"), like Windows Sticky Notes:
 * the same note card filling a small frameless window that can sit anywhere on screen. The card's top bar is
 * the window's drag area.
 */
export function NoteWindow({ noteId }: { noteId: string }) {
  useTheme();
  useNotesSync();
  const notes = useNotes();
  const noteMut = useNoteMutations();
  const note = notes.data?.find((n) => n.id === noteId);
  const { text, setText, flush, version } = useNoteDraft(note);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);

  // Deleted or archived elsewhere: this window has nothing left to show.
  const gone = notes.isSuccess && !notes.isFetching && (!note || note.isArchived);
  useEffect(() => {
    if (gone) window.close();
  }, [gone]);

  useEffect(() => {
    document.title = note ? noteTitle(note) : t('Sticky note');
  }, [note]);

  // The shell keeps the window hidden until the note is drawn, so it never opens as a blank frame.
  const shown = !!note;
  useEffect(() => {
    if (shown) requestAnimationFrame(() => window.mytodoease?.noteReady?.());
  }, [shown]);

  if (!note) return <div className="note-window" />;

  const closeWindow = () => {
    flush();
    // Give the save a moment to leave before the window (and its page) goes away.
    window.setTimeout(() => window.close(), 150);
  };

  const newNote = async () => {
    const created = await noteMut.create.mutateAsync({ text: '', color: note.color });
    popOutNote(created.id);
  };

  return (
    <div className="note-window">
      <article className="note-card note-card-window" data-color={note.color}>
        <header className="note-head note-window-drag">
          <button type="button" className="note-btn" data-tooltip={t('New note')} aria-label={t('New note')} onClick={() => void newNote()}>
            <Plus size={16} />
          </button>
          <span className="spacer" />
          <Popover
            align="right"
            trigger={({ onClick, open }) => (
              <button
                type="button"
                className={`note-btn ${open ? 'is-open' : ''}`}
                data-tooltip={t('More')}
                aria-label={t('More note actions')}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={onClick}
              >
                <Ellipsis size={16} />
              </button>
            )}
          >
            {(close) => (
              <div className="note-menu" role="menu" aria-label={t('Note actions')}>
                <div className="note-menu-label">
                  <Palette size={14} />
                  <span>{t('Colour')}</span>
                </div>
                <div className="note-colors" role="radiogroup" aria-label={t('Note colour')}>
                  {NOTE_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      aria-checked={note.color === color}
                      aria-label={COLOR_LABELS[color]}
                      data-tooltip={COLOR_LABELS[color]}
                      className={`note-color-swatch ${note.color === color ? 'is-selected' : ''}`}
                      data-color={color}
                      onClick={() => {
                        noteMut.update.mutate({ id: note.id, input: { color } });
                        close();
                      }}
                    />
                  ))}
                </div>
                <div className="note-menu-sep" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  className="note-menu-item"
                  onClick={() => {
                    close();
                    void window.mytodoease?.showMainWindow?.();
                  }}
                >
                  <AppWindow size={14} />
                  <span>{t('Open TodoEase')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="note-menu-item"
                  onClick={() => {
                    close();
                    flush();
                    noteMut.update.mutate({ id: note.id, input: { isArchived: true } });
                  }}
                >
                  <Archive size={14} />
                  <span>{t('Archive')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="note-menu-item is-danger"
                  onClick={() => {
                    close();
                    if (window.confirm(t('Delete this note? This cannot be undone.'))) noteMut.remove.mutate(note.id);
                  }}
                >
                  <Trash2 size={14} />
                  <span>{t('Delete')}</span>
                </button>
              </div>
            )}
          </Popover>
          <button type="button" className="note-btn" data-tooltip={t('Close')} aria-label={t('Close note window')} onClick={closeWindow}>
            <X size={16} />
          </button>
        </header>
        <div className="note-body" onBlur={flush}>
          <NoteEditor
            value={text}
            version={version}
            onChange={setText}
            onDone={flush}
            onEscape={flush}
            toolbarHost={toolbarHost}
            autoFocus={!note.text}
          />
        </div>
        {/* Formatting toolbar along the bottom, as in Windows Sticky Notes; the edit time on the right. */}
        <footer className="note-footer note-window-footer">
          <div ref={setToolbarHost} className="note-toolbar" />
          <span className="note-meta note-window-meta">{note.updatedAt ? editedLabel(note.updatedAt) : ''}</span>
        </footer>
      </article>
      <Toasts updateBanner={false} />
      <TooltipLayer />
    </div>
  );
}

/**
 * A note window loaded ahead of time (#note-spare): the page, theme and notes are ready, so when the shell
 * hands it a note ('note:assign') it shows that note at once instead of loading from scratch.
 */
export function SpareNoteWindow() {
  useTheme();
  useNotes(); // warm the notes cache
  const queryClient = useQueryClient();
  const [noteId, setNoteId] = useState<string | null>(null);

  useEffect(() => {
    const off = window.mytodoease?.onNoteAssign?.((id) => {
      window.history.replaceState(null, '', `#note=${id}`);
      // The note was probably created a moment ago: fetch it before showing.
      void queryClient.invalidateQueries({ queryKey: ['notes'] }).then(() => setNoteId(id));
    });
    // Only now can the shell hand this window a note.
    window.mytodoease?.noteSpareReady?.();
    return off;
  }, [queryClient]);

  return noteId ? <NoteWindow noteId={noteId} /> : <div className="note-window" />;
}
