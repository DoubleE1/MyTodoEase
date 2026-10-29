import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { Archive, ArchiveRestore, GripVertical, ListTodo, Palette, Plus, StickyNote, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNoteMutations, useNotes } from '../api/hooks';
import { NOTE_COLORS, type Label, type Note, type NoteColor, type Project, type Section } from '../api/types';
import type { ConfirmOptions } from './Dialogs';
import { NoteToTasksDialog } from './NoteToTasksDialog';
import { Popover } from './Popover';

const SAVE_DELAY_MS = 500;

const COLOR_LABELS: Record<NoteColor, string> = {
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  purple: 'Purple',
  orange: 'Orange',
  grey: 'Grey',
};

/**
 * The Notes board: sticky notes for quick thoughts that are not tasks yet. Notes save while typing, can be
 * coloured and dragged into any order, and "Turn into tasks" suggests tasks from the text for the user to approve.
 */
export function NotesView({
  projects,
  sections,
  labels,
  onCreateLabel,
  onOpenTask,
  confirm,
}: {
  projects: Project[];
  sections: Section[];
  labels: Label[];
  onCreateLabel: (name: string) => Promise<Label>;
  onOpenTask: (id: string) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}) {
  const notesQuery = useNotes();
  const mut = useNoteMutations();
  const [showArchived, setShowArchived] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [converting, setConverting] = useState<Note | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const all = notesQuery.data ?? [];
  const active = useMemo(() => all.filter((n) => !n.isArchived), [all]);
  const archived = useMemo(() => all.filter((n) => n.isArchived), [all]);

  const addNote = async () => {
    const note = await mut.create.mutateAsync({ text: '', color: 'yellow' });
    setFocusId(note.id);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;
    const from = active.findIndex((n) => n.id === dragged.id);
    const to = active.findIndex((n) => n.id === over.id);
    if (from < 0 || to < 0) return;
    const moved = arrayMove(active, from, to);
    mut.reorder.mutate(moved.map((n, index) => ({ id: n.id, order: index })));
  };

  const remove = async (note: Note) => {
    if (note.text.trim()) {
      const ok = await confirm({
        title: 'Delete this note?',
        message: 'The note is removed for good. Tasks already created from it stay.',
        confirmLabel: 'Delete',
      });
      if (!ok) return;
    }
    mut.remove.mutate(note.id);
  };

  return (
    <div className="view view-notes">
      <header className="view-header notes-header">
        <div>
          <h1>Notes</h1>
          <p className="muted small">Jot things down as they come. Turn a note into tasks when you are ready.</p>
        </div>
        <div className="notes-header-actions">
          {archived.length > 0 && (
            <button type="button" className={`btn ${showArchived ? 'is-active' : ''}`} onClick={() => setShowArchived((v) => !v)}>
              <Archive size={14} />
              <span>{showArchived ? 'Hide archived' : `Archived (${archived.length})`}</span>
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => void addNote()} disabled={mut.create.isPending}>
            <Plus size={14} />
            <span>New note</span>
          </button>
        </div>
      </header>

      {notesQuery.isLoading ? (
        <div className="loading">Loading…</div>
      ) : active.length === 0 && !showArchived ? (
        <div className="notes-empty">
          <StickyNote size={40} />
          <p>No notes yet.</p>
          <p className="muted small">A note can be a shopping list, meeting scribbles or a thought. Lists and sentences can become tasks later.</p>
          <button type="button" className="btn btn-primary" onClick={() => void addNote()}>
            <Plus size={14} />
            <span>New note</span>
          </button>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={active.map((n) => n.id)} strategy={rectSortingStrategy}>
            <div className="notes-grid">
              {active.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  autoFocus={note.id === focusId}
                  onFocused={() => setFocusId(null)}
                  onSave={(input) => mut.update.mutate({ id: note.id, input })}
                  onConvert={() => setConverting(note)}
                  onArchive={() => mut.update.mutate({ id: note.id, input: { isArchived: true } })}
                  onDelete={() => void remove(note)}
                  onDeleteEmpty={() => mut.remove.mutate(note.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {showArchived && archived.length > 0 && (
        <section className="notes-archived" aria-label="Archived notes">
          <h2 className="notes-archived-title">Archived</h2>
          <div className="notes-grid">
            {archived.map((note) => (
              <article key={note.id} className="note-card is-archived" data-color={note.color}>
                <div className="note-text-static">{note.text || <span className="muted">(empty)</span>}</div>
                <footer className="note-footer">
                  {note.taskIds.length > 0 && <TaskLink count={note.taskIds.length} onOpen={() => onOpenTask(note.taskIds[0])} />}
                  <span className="spacer" />
                  <button type="button" className="note-btn" title="Restore to the board" aria-label="Restore note" onClick={() => mut.update.mutate({ id: note.id, input: { isArchived: false } })}>
                    <ArchiveRestore size={15} />
                  </button>
                  <button type="button" className="note-btn" title="Delete note" aria-label="Delete note" onClick={() => void remove(note)}>
                    <Trash2 size={15} />
                  </button>
                </footer>
              </article>
            ))}
          </div>
        </section>
      )}

      {converting && (
        <NoteToTasksDialog
          note={converting}
          projects={projects}
          sections={sections}
          labels={labels}
          onCreateLabel={onCreateLabel}
          onClose={() => setConverting(null)}
          onDone={(taskIds, archive) => {
            mut.update.mutate({
              id: converting.id,
              input: { taskIds: [...converting.taskIds, ...taskIds], ...(archive ? { isArchived: true } : {}) },
            });
            setConverting(null);
          }}
        />
      )}
    </div>
  );
}

function TaskLink({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button type="button" className="note-task-link" onClick={onOpen} title="Open the first task made from this note">
      <ListTodo size={13} />
      <span>
        {count} task{count === 1 ? '' : 's'}
      </span>
    </button>
  );
}

function NoteCard({
  note,
  autoFocus,
  onFocused,
  onSave,
  onConvert,
  onArchive,
  onDelete,
  onDeleteEmpty,
}: {
  note: Note;
  autoFocus: boolean;
  onFocused: () => void;
  onSave: (input: { text?: string; color?: NoteColor }) => void;
  onConvert: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onDeleteEmpty: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: note.id });
  const [text, setText] = useState(note.text);
  const textRef = useRef(note.text);
  const savedRef = useRef(note.text);
  const timer = useRef<number | undefined>(undefined);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);

  // Take edits made on another device, unless this card is being typed in.
  useEffect(() => {
    if (!focused && note.text !== savedRef.current) {
      savedRef.current = note.text;
      textRef.current = note.text;
      setText(note.text);
    }
  }, [note.text, focused]);

  const flush = () => {
    window.clearTimeout(timer.current);
    if (textRef.current !== savedRef.current) {
      savedRef.current = textRef.current;
      onSave({ text: textRef.current });
    }
  };

  // Save what is pending when the card goes away (view change, archive).
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (autoFocus) {
      areaRef.current?.focus();
      onFocused();
    }
  }, [autoFocus, onFocused]);

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text]);

  const edited = note.updatedAt ? formatDistanceToNow(parseISO(note.updatedAt), { addSuffix: true }) : '';

  return (
    <article
      ref={setNodeRef}
      className={`note-card ${isDragging ? 'is-dragging' : ''}`}
      data-color={note.color}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="note-grip"
        aria-label="Drag to reorder"
        title="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <textarea
        ref={areaRef}
        className="note-text"
        value={text}
        placeholder="Write anything… e.g. a list of things to do"
        aria-label="Note"
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          setText(e.target.value);
          textRef.current = e.target.value;
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
        }}
        onBlur={() => {
          setFocused(false);
          flush();
          // A note that was opened and left empty is not worth keeping.
          if (!textRef.current.trim() && note.taskIds.length === 0) onDeleteEmpty();
        }}
      />
      <footer className="note-footer">
        {note.taskIds.length > 0 ? (
          <span className="note-meta">
            <ListTodo size={13} /> {note.taskIds.length} task{note.taskIds.length === 1 ? '' : 's'} made
          </span>
        ) : (
          <span className="note-meta" title={note.updatedAt}>
            {edited}
          </span>
        )}
        <span className="spacer" />
        <Popover
          align="right"
          trigger={({ onClick }) => (
            <button type="button" className="note-btn" title="Colour" aria-label="Note colour" onClick={onClick}>
              <Palette size={15} />
            </button>
          )}
        >
          {(close) => (
            <div className="note-colors" role="radiogroup" aria-label="Note colour">
              {NOTE_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={note.color === color}
                  aria-label={COLOR_LABELS[color]}
                  title={COLOR_LABELS[color]}
                  className={`note-color-swatch ${note.color === color ? 'is-selected' : ''}`}
                  data-color={color}
                  onClick={() => {
                    onSave({ color });
                    close();
                  }}
                />
              ))}
            </div>
          )}
        </Popover>
        <button type="button" className="note-btn" title="Archive" aria-label="Archive note" onClick={() => (flush(), onArchive())}>
          <Archive size={15} />
        </button>
        <button type="button" className="note-btn" title="Delete" aria-label="Delete note" onClick={onDelete}>
          <Trash2 size={15} />
        </button>
        <button
          type="button"
          className="note-convert"
          title="Suggest tasks from this note; you review them before anything is created"
          disabled={!text.trim()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            flush();
            onConvert();
          }}
        >
          <ListTodo size={14} />
          <span>Turn into tasks</span>
        </button>
      </footer>
    </article>
  );
}
