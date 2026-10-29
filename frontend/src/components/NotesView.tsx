import { differenceInMinutes, format, parseISO } from 'date-fns';
import { Archive, ArchiveRestore, Grip, ListTodo, Palette, Plus, StickyNote, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNoteMutations, useNotes } from '../api/hooks';
import { NOTE_COLORS, type Label, type Note, type NoteColor, type NoteInput, type Project, type Section } from '../api/types';
import type { ConfirmOptions } from './Dialogs';
import { NoteToTasksDialog } from './NoteToTasksDialog';
import { Popover } from './Popover';

const SAVE_DELAY_MS = 500;
const NOTE_WIDTH = 280;
/** Height assumed for a note that has not been measured yet (free-slot search). */
const NOTE_HEIGHT_GUESS = 230;
const GAP = 20;
const KEY_STEP = 16;
/** Below this board width the notes stack in one column instead of floating freely. */
const STACK_BELOW = 440;

/** Short "edited" time that fits the note footer: just now, 5m ago, 3h ago, then the date. */
function editedLabel(iso: string): string {
  const date = parseISO(iso);
  const minutes = differenceInMinutes(new Date(), date);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`;
  return format(date, 'd MMM');
}

const COLOR_LABELS: Record<NoteColor, string> = {
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  purple: 'Purple',
  orange: 'Orange',
  grey: 'Grey',
};

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

/** First spot (scanning rows from `fromY`) where a note fits without touching any placed note. */
function findFreeSpot(placed: Rect[], boardWidth: number, fromY = 0): { x: number; y: number } {
  const maxX = Math.max(0, boardWidth - NOTE_WIDTH);
  const step = 24;
  for (let y = Math.max(0, fromY); y < fromY + 20000; y += step) {
    for (let x = 0; x <= maxX; x += step) {
      const candidate = { x, y, w: NOTE_WIDTH, h: NOTE_HEIGHT_GUESS };
      if (!placed.some((p) => overlaps(candidate, p))) return { x, y };
    }
  }
  return { x: 0, y: fromY };
}

/**
 * The Notes board: sticky notes placed freely anywhere on the page, like notes on a desk. A note keeps its
 * place on every device; the last one moved or created sits on top. Notes save while typing, can be coloured,
 * and "Turn into tasks" suggests tasks from the text for the user to approve.
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
  const boardRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(0);
  const heights = useRef(new Map<string, number>());
  const [, setMeasured] = useState(0);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);

  const all = notesQuery.data ?? [];
  const active = useMemo(() => all.filter((n) => !n.isArchived), [all]);
  const archived = useMemo(() => all.filter((n) => n.isArchived), [all]);
  const stacked = boardWidth > 0 && boardWidth < STACK_BELOW;
  const topOrder = active.reduce((max, n) => Math.max(max, n.order), 0);

  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBoardWidth(el.clientWidth));
    observer.observe(el);
    setBoardWidth(el.clientWidth);
    return () => observer.disconnect();
  }, [notesQuery.isLoading]);

  const rectOf = useCallback(
    (note: Note): Rect | null =>
      note.x == null || note.y == null ? null : { x: note.x, y: note.y, w: NOTE_WIDTH, h: heights.current.get(note.id) ?? NOTE_HEIGHT_GUESS },
    [],
  );

  // Notes without a place yet (made before free placement, or on a phone) get one, saved for every device.
  const placing = useRef(false);
  useEffect(() => {
    if (placing.current || stacked || boardWidth === 0) return;
    const unplaced = active.filter((n) => n.x == null || n.y == null);
    if (unplaced.length === 0) return;
    placing.current = true;
    const placed = active.map(rectOf).filter((r): r is Rect => r !== null);
    for (const note of [...unplaced].sort((a, b) => a.order - b.order)) {
      const spot = findFreeSpot(placed, boardWidth);
      placed.push({ ...spot, w: NOTE_WIDTH, h: NOTE_HEIGHT_GUESS });
      mut.update.mutate({ id: note.id, input: spot });
    }
    placing.current = false;
  }, [active, boardWidth, stacked, rectOf, mut.update]);

  const addNote = async () => {
    let position: { x?: number; y?: number } = {};
    if (!stacked && boardRef.current) {
      // Somewhere free in the part of the board the user is looking at.
      const scroller = boardRef.current.closest('.main');
      const visibleTop = scroller ? Math.max(0, scroller.scrollTop - boardRef.current.offsetTop) : 0;
      const placed = active.map(rectOf).filter((r): r is Rect => r !== null);
      position = findFreeSpot(placed, boardWidth, visibleTop);
    }
    const note = await mut.create.mutateAsync({ text: '', color: 'yellow', order: topOrder + 1, ...position });
    setFocusId(note.id);
  };

  const save = (note: Note, input: NoteInput) => mut.update.mutate({ id: note.id, input });

  /** Where the note is drawn: a note placed on a wider screen is pulled in to fit this board. */
  const shownX = (note: Note) => Math.min(note.x ?? 0, Math.max(0, boardWidth - NOTE_WIDTH));

  /** Drag a note by its frame; the textarea and buttons keep their own behaviour. */
  const startDrag = (note: Note, event: ReactPointerEvent<HTMLElement>) => {
    if (stacked || event.button !== 0) return;
    if ((event.target as Element).closest('textarea, button, input, a, [role="radiogroup"]')) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone (e.g. released during a re-render); the move listeners still work.
    }
    let moved = false;
    const move = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      setDrag({ id: note.id, dx, dy });
    };
    const up = (e: PointerEvent) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setDrag(null);
      if (!moved) return;
      const x = Math.min(Math.max(0, shownX(note) + e.clientX - startX), Math.max(0, boardWidth - NOTE_WIDTH));
      const y = Math.max(0, (note.y ?? 0) + e.clientY - startY);
      save(note, { x: Math.round(x), y: Math.round(y), order: note.order === topOrder ? note.order : topOrder + 1 });
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const nudge = (note: Note, dx: number, dy: number) => {
    const x = Math.min(Math.max(0, shownX(note) + dx), Math.max(0, boardWidth - NOTE_WIDTH));
    const y = Math.max(0, (note.y ?? 0) + dy);
    save(note, { x, y, order: note.order === topOrder ? note.order : topOrder + 1 });
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

  const onMeasure = useCallback((id: string, height: number) => {
    if (heights.current.get(id) !== height) {
      heights.current.set(id, height);
      setMeasured((n) => n + 1);
    }
  }, []);

  // The board is as tall as its lowest note (plus room to drop more below), and at least the visible area.
  const boardHeight = stacked
    ? undefined
    : Math.max(
        480,
        ...active.map((n) => (n.y ?? 0) + (heights.current.get(n.id) ?? NOTE_HEIGHT_GUESS) + 160),
        drag ? ((active.find((n) => n.id === drag.id)?.y ?? 0) + drag.dy + NOTE_HEIGHT_GUESS + 160) : 0,
      );
  const zOrder = new Map([...active].sort((a, b) => a.order - b.order).map((n, i) => [n.id, i + 1]));
  const stackedOrder = [...active].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));

  return (
    <div className="view view-notes">
      <header className="view-header notes-header">
        <div>
          <h1>Notes</h1>
          <p className="muted small">Jot things down as they come and put them anywhere. Turn a note into tasks when you are ready.</p>
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
      ) : (
        <div
          ref={boardRef}
          className={`notes-board ${stacked ? 'is-stacked' : ''} ${drag ? 'is-dragging' : ''}`}
          style={{ height: boardHeight }}
          onDoubleClick={(e) => {
            if (e.target === e.currentTarget) void addNote();
          }}
        >
          {active.length === 0 && (
            <div className="notes-empty">
              <StickyNote size={40} />
              <p>No notes yet.</p>
              <p className="muted small">
                A note can be a shopping list, meeting scribbles or a thought. Lists and sentences can become tasks later.
              </p>
              <button type="button" className="btn btn-primary" onClick={() => void addNote()}>
                <Plus size={14} />
                <span>New note</span>
              </button>
            </div>
          )}
          {(stacked ? stackedOrder : active).map((note) => {
            const dragging = drag?.id === note.id;
            const x = shownX(note);
            const style = stacked
              ? undefined
              : {
                  left: x,
                  top: note.y ?? 0,
                  zIndex: dragging ? 1000 : zOrder.get(note.id),
                  transform: dragging ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined,
                };
            return (
              <NoteCard
                key={note.id}
                note={note}
                style={style}
                dragging={dragging}
                movable={!stacked}
                autoFocus={note.id === focusId}
                onFocused={() => setFocusId(null)}
                onPointerDown={(e) => startDrag(note, e)}
                onNudge={(dx, dy) => nudge(note, dx, dy)}
                onMeasure={onMeasure}
                onSave={(input) => save(note, input)}
                onConvert={() => setConverting(note)}
                onArchive={() => save(note, { isArchived: true })}
                onDelete={() => void remove(note)}
                onDeleteEmpty={() => mut.remove.mutate(note.id)}
              />
            );
          })}
        </div>
      )}

      {showArchived && archived.length > 0 && (
        <section className="notes-archived" aria-label="Archived notes">
          <h2 className="notes-archived-title">Archived</h2>
          <div className="notes-grid">
            {archived.map((note) => (
              <article key={note.id} className="note-card is-archived" data-color={note.color}>
                <div className="note-text-static">{note.text || <span className="muted">(empty)</span>}</div>
                <footer className="note-footer">
                  {note.taskIds.length > 0 && (
                    <button type="button" className="note-task-link" onClick={() => onOpenTask(note.taskIds[0])} title="Open the first task made from this note">
                      <ListTodo size={13} />
                      <span>
                        {note.taskIds.length} task{note.taskIds.length === 1 ? '' : 's'}
                      </span>
                    </button>
                  )}
                  <span className="spacer" />
                  <button
                    type="button"
                    className="note-btn"
                    title="Put back on the board"
                    aria-label="Restore note"
                    onClick={() => save(note, { isArchived: false, order: topOrder + 1 })}
                  >
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

function NoteCard({
  note,
  style,
  dragging,
  movable,
  autoFocus,
  onFocused,
  onPointerDown,
  onNudge,
  onMeasure,
  onSave,
  onConvert,
  onArchive,
  onDelete,
  onDeleteEmpty,
}: {
  note: Note;
  style?: React.CSSProperties;
  dragging: boolean;
  movable: boolean;
  autoFocus: boolean;
  onFocused: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onNudge: (dx: number, dy: number) => void;
  onMeasure: (id: string, height: number) => void;
  onSave: (input: NoteInput) => void;
  onConvert: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onDeleteEmpty: () => void;
}) {
  const [text, setText] = useState(note.text);
  const textRef = useRef(note.text);
  const savedRef = useRef(note.text);
  const timer = useRef<number | undefined>(undefined);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLElement>(null);
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
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight + 2}px`;
    }
    if (cardRef.current) onMeasure(note.id, cardRef.current.offsetHeight);
  }, [text, note.id, onMeasure]);

  const edited = note.updatedAt ? `Edited ${editedLabel(note.updatedAt)}` : '';

  return (
    <article
      ref={cardRef}
      className={`note-card ${dragging ? 'is-dragging' : ''} ${movable ? 'is-movable' : ''}`}
      data-color={note.color}
      style={style}
      onPointerDown={onPointerDown}
    >
      {movable && (
        <button
          type="button"
          className="note-grip"
          aria-label="Move note (arrow keys)"
          title="Drag the note's edge to move it, or use the arrow keys here"
          onKeyDown={(e) => {
            const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP;
            const moves: Record<string, [number, number]> = {
              ArrowLeft: [-step, 0],
              ArrowRight: [step, 0],
              ArrowUp: [0, -step],
              ArrowDown: [0, step],
            };
            const delta = moves[e.key];
            if (!delta) return;
            e.preventDefault();
            onNudge(delta[0], delta[1]);
          }}
        >
          <Grip size={14} />
        </button>
      )}
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
        <span className="note-meta" title={note.updatedAt}>
          {note.taskIds.length > 0 ? (
            <>
              <ListTodo size={13} /> {note.taskIds.length} task{note.taskIds.length === 1 ? '' : 's'} made
            </>
          ) : (
            edited
          )}
        </span>
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
