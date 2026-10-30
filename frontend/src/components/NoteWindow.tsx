import { AppWindow, Archive, Ellipsis, Palette, Plus, Trash2, X } from 'lucide-react';
import { useEffect } from 'react';
import { useNoteMutations, useNotes } from '../api/hooks';
import { NOTE_COLORS } from '../api/types';
import { COLOR_LABELS, editedLabel, noteTitle, popOutNote, useNotesSync } from '../lib/notes';
import { useNoteDraft } from '../lib/useNoteDraft';
import { useTheme } from '../lib/theme';
import { Popover } from './Popover';
import { Toasts } from './Toasts';
import { TooltipLayer } from './TooltipLayer';

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
  const { text, setText, flush } = useNoteDraft(note);

  // Deleted or archived elsewhere: this window has nothing left to show.
  const gone = notes.isSuccess && (!note || note.isArchived);
  useEffect(() => {
    if (gone) window.close();
  }, [gone]);

  useEffect(() => {
    document.title = note ? noteTitle(note) : 'Sticky note';
  }, [note]);

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
          <button type="button" className="note-btn" data-tooltip="New note" aria-label="New note" onClick={() => void newNote()}>
            <Plus size={16} />
          </button>
          <span className="spacer" />
          <Popover
            align="right"
            trigger={({ onClick, open }) => (
              <button
                type="button"
                className={`note-btn ${open ? 'is-open' : ''}`}
                data-tooltip="More"
                aria-label="More note actions"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={onClick}
              >
                <Ellipsis size={16} />
              </button>
            )}
          >
            {(close) => (
              <div className="note-menu" role="menu" aria-label="Note actions">
                <div className="note-menu-label">
                  <Palette size={14} />
                  <span>Colour</span>
                </div>
                <div className="note-colors" role="radiogroup" aria-label="Note colour">
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
                  <span>Open TodoEase</span>
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
                  <span>Archive</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="note-menu-item is-danger"
                  onClick={() => {
                    close();
                    if (window.confirm('Delete this note? This cannot be undone.')) noteMut.remove.mutate(note.id);
                  }}
                >
                  <Trash2 size={14} />
                  <span>Delete</span>
                </button>
              </div>
            )}
          </Popover>
          <button type="button" className="note-btn" data-tooltip="Close" aria-label="Close note window" onClick={closeWindow}>
            <X size={16} />
          </button>
        </header>
        <textarea
          className="note-text"
          value={text}
          placeholder="Write anything… e.g. a list of things to do"
          aria-label="Note"
          autoFocus={!note.text}
          onChange={(e) => setText(e.target.value)}
          onBlur={flush}
        />
        <footer className="note-footer">
          <span className="note-meta">{note.updatedAt ? `Edited ${editedLabel(note.updatedAt)}` : ''}</span>
        </footer>
      </article>
      <Toasts updateBanner={false} />
      <TooltipLayer />
    </div>
  );
}
