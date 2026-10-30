import { format, parseISO } from 'date-fns';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNoteMutations, useNotes } from '../api/hooks';
import type { Note } from '../api/types';
import { canPopOutNotes, popOutNote } from '../lib/notes';
import { showToast } from '../lib/toast';
import { useNoteDraft } from '../lib/useNoteDraft';

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
    showToast('Note deleted', 'success', {
      group: 'note-deleted',
      duration: 5000,
      action: {
        label: 'Undo',
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
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes" aria-label="Search notes" />
        </label>
        <button type="button" className="icon-btn" data-tooltip="New note" aria-label="New note" onClick={() => void create()}>
          <Plus size={16} />
        </button>
      </div>
      {notes.isSuccess && shown.length === 0 && (
        <p className="empty">{q ? `No notes match “${query.trim()}”.` : 'No notes yet. Press + to write one.'}</p>
      )}
      <ul className="notes-list" aria-label="Sticky notes">
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
                  aria-label={`${popOut ? 'Open' : 'Edit'} note: ${note.text.trim().slice(0, 60) || 'Empty note'}`}
                  onClick={() => open(note)}
                >
                  <span className="note-list-date">{format(parseISO(note.updatedAt), 'd MMM yyyy')}</span>
                  <span className="note-list-text">{note.text.trim() || 'Empty note'}</span>
                </button>
                <button
                  type="button"
                  className="note-btn note-list-delete"
                  data-tooltip="Delete note"
                  aria-label="Delete note"
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
  const { text, setText, flush } = useNoteDraft(note);
  return (
    <div className="note-card note-list-card is-editing" data-color={note.color}>
      <textarea
        className="note-text"
        value={text}
        autoFocus
        aria-label="Note"
        placeholder="Write anything… e.g. a list of things to do"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          flush();
          onDone();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
      />
    </div>
  );
}
