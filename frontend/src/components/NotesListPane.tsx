import { format, parseISO } from 'date-fns';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { MarkdownText } from './MarkdownText';
import { NoteEditor } from './NoteEditor';
import { useNoteMutations, useNotes } from '../api/hooks';
import type { Note } from '../api/types';
import { canPopOutNotes, popOutNote } from '../lib/notes';
import { showToast } from '../lib/toast';
import { useNoteDraft } from '../lib/useNoteDraft';
import { t } from '../i18n';

/**
 * Sticky notes as a list, for the mini window's lower pane (like the list in Windows Sticky Notes): search,
 * newest first, each note as a card in its colour. On the desktop a click opens the note in its own window;
 * in the browser it opens for editing right in the list.
 */
export function NotesListPane() {
  const notes = useNotes();
  const noteMut = useNoteMutations();
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const popOut = canPopOutNotes();

  const q = query.trim().toLowerCase();
  const shown = (notes.data ?? [])
    .filter((n) => !n.isArchived && (!q || n.text.toLowerCase().includes(q)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const open = (note: Note) => {
    if (popOut) popOutNote(note.id);
    else setEditingId(note.id);
  };

  // Deleting is immediate; the toast's Undo brings the note back with the same text and colour.
  const remove = (note: Note) => {
    noteMut.remove.mutate(note.id);
    showToast(t('Note deleted'), 'success', {
      group: 'note-deleted',
      duration: 5000,
      action: {
        label: t('Undo'),
        run: () => void noteMut.create.mutate({ text: note.text, color: note.color, taskIds: note.taskIds }),
      },
    });
  };

  const create = async () => {
    const created = await noteMut.create.mutateAsync({ text: '' });
    setQuery('');
    open(created);
  };

  return (
    <div className="pane-body notes-list-pane">
      <div className="notes-list-tools">
        <label className="notes-list-search">
          <Search size={14} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search notes')} aria-label={t('Search notes')} />
        </label>
        <button type="button" className="icon-btn" data-tooltip={t('New note')} aria-label={t('New note')} onClick={() => void create()}>
          <Plus size={16} />
        </button>
      </div>
      {notes.isSuccess && shown.length === 0 && (
        <p className="empty">{q ? `No notes match “${query.trim()}”.` : 'No notes yet. Press + to write one.'}</p>
      )}
      <ul className="notes-list" aria-label={t('Sticky notes')}>
        {shown.map((note) =>
          editingId === note.id ? (
            <li key={note.id}>
              <EditableCard note={note} onDone={() => setEditingId(null)} />
            </li>
          ) : (
            <li key={note.id}>
              <div className="note-card note-list-card" data-color={note.color}>
                <button
                  type="button"
                  className="note-list-open"
                  aria-label={`${popOut ? 'Open' : 'Edit'} note: ${note.text.trim().slice(0, 60) || t('Empty note')}`}
                  onClick={() => open(note)}
                >
                  <span className="note-list-date">{format(parseISO(note.updatedAt), 'd MMM yyyy')}</span>
                  {note.text.trim() ? (
                    <MarkdownText text={note.text} className="md note-list-text" />
                  ) : (
                    <span className="note-list-text muted">{t('Empty note')}</span>
                  )}
                </button>
                <button
                  type="button"
                  className="note-btn note-list-delete"
                  data-tooltip={t('Delete note')}
                  aria-label={t('Delete note')}
                  onClick={() => remove(note)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

/** Browser only: a note opened for editing inside the list. */
function EditableCard({ note, onDone }: { note: Note; onDone: () => void }) {
  const { text, setText, flush, version } = useNoteDraft(note);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const finish = () => {
    flush();
    onDone();
  };
  return (
    <div
      className="note-card note-list-card is-editing"
      data-color={note.color}
      // Leaving the card (not moving between its text and toolbar) ends editing.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !(e.relatedTarget as Element | null)?.closest?.('.popover')) finish();
      }}
    >
      <NoteEditor value={text} version={version} onChange={setText} onDone={finish} onEscape={finish} toolbarHost={toolbarHost} autoFocus />
      <div ref={setToolbarHost} className="note-toolbar" />
    </div>
  );
}
