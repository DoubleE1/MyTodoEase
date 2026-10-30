import { differenceInMinutes, format, parseISO } from 'date-fns';
import { Archive, ArchiveRestore, Ellipsis, Grip, ListTodo, Palette, Plus, StickyNote, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNoteMutations, useNotes } from '../api/hooks';
import { NOTE_COLORS, type Label, type Note, type NoteColor, type NoteInput, type Project, type Section } from '../api/types';
import type { ConfirmOptions } from './Dialogs';
import { NoteToTasksDialog } from './NoteToTasksDialog';
import { Popover } from './Popover';

const SAVE_DELAY_MS = 500;
const NOTE_WIDTH = 320;
const MIN_W = 220;
const MAX_W = 1200;
const MIN_H = 160;
const MAX_H = 1600;
/** Which border is being dragged: a side, or a corner (two sides). */
type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
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
  const [drag, setDrag] = useState<{ id: string } | null>(null);
  const [resize, setResize] = useState<{ id: string; x: number; y: number; w: number; h: number } | null>(null);

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
      note.x == null || note.y == null
        ? null
        : { x: note.x, y: note.y, w: note.w ?? NOTE_WIDTH, h: heights.current.get(note.id) ?? NOTE_HEIGHT_GUESS },
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

  /** How wide the note is drawn: its saved width, never wider than the board. */
  const widthOf = (note: Note) => Math.min(note.w ?? NOTE_WIDTH, Math.max(MIN_W, boardWidth));

  /** Where the note is drawn: a note placed on a wider screen is pulled in to fit this board. */
  const shownX = (note: Note) => Math.min(note.x ?? 0, Math.max(0, boardWidth - widthOf(note)));

  const front = (note: Note) => (note.order === topOrder ? {} : { order: topOrder + 1 });

  /** Clicking a note brings it to the front (and keeps it there). */
  const activate = (note: Note) => {
    if (note.order !== topOrder) save(note, { order: topOrder + 1 });
  };

  /**
   * Resize by dragging any edge or corner, as with a window: the left and top edges move the note too.
   * Live preview while dragging, saved on release.
   */
  const startResize = (note: Note, edge: Edge, event: ReactPointerEvent<HTMLElement>) => {
    if (stacked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    activate(note);
    const card = (event.currentTarget as HTMLElement).closest('.note-card') as HTMLElement | null;
    const start = {
      x: shownX(note),
      y: note.y ?? 0,
      w: widthOf(note),
      h: card?.offsetHeight ?? note.h ?? NOTE_HEIGHT_GUESS,
    };
    const startX = event.clientX;
    const startY = event.clientY;
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already released; listeners below still finish the resize.
    }
    const rectAt = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      let { x, y, w, h } = start;
      if (edge.includes('e')) w = clamp(start.w + dx, MIN_W, Math.min(MAX_W, boardWidth - start.x));
      if (edge.includes('w')) {
        // The right edge stays put; the left edge cannot leave the board.
        w = clamp(start.w - dx, MIN_W, Math.min(MAX_W, start.x + start.w));
        x = start.x + start.w - w;
      }
      if (edge.includes('s')) h = clamp(start.h + dy, MIN_H, MAX_H);
      if (edge.includes('n')) {
        h = clamp(start.h - dy, MIN_H, Math.min(MAX_H, start.y + start.h));
        y = start.y + start.h - h;
      }
      return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    };
    const move = (e: PointerEvent) => setResize({ id: note.id, ...rectAt(e) });
    const up = (e: PointerEvent) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      const rect = rectAt(e);
      setResize(null);
      if (rect.w === start.w && rect.h === start.h) return;
      const moved = rect.x !== start.x || rect.y !== start.y ? { x: rect.x, y: rect.y } : {};
      save(note, { w: rect.w, h: rect.h, ...moved, ...front(note) });
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const resizeBy = (note: Note, card: HTMLElement | null, dw: number, dh: number) => {
    const w = Math.round(clamp(widthOf(note) + dw, MIN_W, Math.min(MAX_W, boardWidth - shownX(note))));
    const h = Math.round(clamp((card?.offsetHeight ?? note.h ?? NOTE_HEIGHT_GUESS) + dh, MIN_H, MAX_H));
    save(note, { w, h, ...front(note) });
  };

  /** Drag a note by its frame; the textarea and buttons keep their own behaviour. */
  const startDrag = (note: Note, event: ReactPointerEvent<HTMLElement>) => {
    if (stacked || event.button !== 0) return;
    // Text, buttons and links keep their own behaviour; the grip is a button but is meant to be dragged.
    const control = (event.target as Element).closest('textarea, button, input, a, [role="radiogroup"]');
    if (control && !control.classList.contains('note-grip')) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone (e.g. released during a re-render); the move listeners still work.
    }
    // The card follows the pointer by writing its transform directly, once per frame: re-rendering the
    // board on every pointer move is what made dragging lag.
    let moved = false;
    let frame = 0;
    let offset = { dx: 0, dy: 0 };
    const paint = () => {
      frame = 0;
      target.style.transform = `translate(${offset.dx}px, ${offset.dy}px)`;
    };
    const move = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      if (!moved) setDrag({ id: note.id });
      moved = true;
      offset = { dx, dy };
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const up = (e: PointerEvent) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      cancelAnimationFrame(frame);
      setDrag(null);
      if (!moved) return;
      const x = Math.round(
        Math.min(Math.max(0, shownX(note) + e.clientX - startX), Math.max(0, boardWidth - widthOf(note))),
      );
      const y = Math.round(Math.max(0, (note.y ?? 0) + e.clientY - startY));
      // Put the card at its new place in the same frame the offset goes, so it never jumps back while the
      // save is on its way; the next render writes the same values.
      target.style.left = `${x}px`;
      target.style.top = `${y}px`;
      target.style.transform = '';
      save(note, { x, y, order: note.order === topOrder ? note.order : topOrder + 1 });
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const nudge = (note: Note, dx: number, dy: number) => {
    const x = Math.min(Math.max(0, shownX(note) + dx), Math.max(0, boardWidth - widthOf(note)));
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
        // While a note is dragged there is extra room below, so it can be pulled further down.
        ...active.map((n) => (n.y ?? 0) + (heights.current.get(n.id) ?? NOTE_HEIGHT_GUESS) + (drag ? 560 : 160)),
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
            const resizing = resize?.id === note.id ? resize : null;
            const x = resizing ? resizing.x : shownX(note);
            const height = resizing ? resizing.h : note.h ?? undefined;
            const style = stacked
              ? undefined
              : {
                  left: x,
                  top: resizing ? resizing.y : note.y ?? 0,
                  width: resizing ? resizing.w : widthOf(note),
                  height,
                  zIndex: dragging ? 1000 : zOrder.get(note.id),
                };
            return (
              <NoteCard
                key={note.id}
                note={note}
                style={style}
                dragging={dragging}
                movable={!stacked}
                sized={!stacked && height !== undefined}
                resizing={resizing !== null}
                onActivate={() => activate(note)}
                onResizeStart={(edge, e) => startResize(note, edge, e)}
                onResizeBy={(card, dw, dh) => resizeBy(note, card, dw, dh)}
                autoFocus={note.id === focusId}
                onFocused={() => setFocusId(null)}
                onPointerDown={(e) => startDrag(note, e)}
                onNudge={(dx, dy) => nudge(note, dx, dy)}
                onMeasure={onMeasure}
                onSave={(input) => save(note, input)}
                onConvert={() => setConverting(note)}
                onArchive={() => save(note, { isArchived: true })}
                onDelete={() => void remove(note)}
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
  sized,
  resizing,
  autoFocus,
  onFocused,
  onActivate,
  onPointerDown,
  onResizeStart,
  onResizeBy,
  onNudge,
  onMeasure,
  onSave,
  onConvert,
  onArchive,
  onDelete,
}: {
  note: Note;
  style?: React.CSSProperties;
  dragging: boolean;
  movable: boolean;
  /** The note has a saved height: the text fills it instead of growing the card. */
  sized: boolean;
  resizing: boolean;
  autoFocus: boolean;
  onFocused: () => void;
  onActivate: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onResizeStart: (edge: Edge, event: ReactPointerEvent<HTMLElement>) => void;
  onResizeBy: (card: HTMLElement | null, dw: number, dh: number) => void;
  onNudge: (dx: number, dy: number) => void;
  onMeasure: (id: string, height: number) => void;
  onSave: (input: NoteInput) => void;
  onConvert: () => void;
  onArchive: () => void;
  onDelete: () => void;
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
      if (sized) {
        el.style.height = '';
      } else {
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight + 2}px`;
      }
    }
    if (cardRef.current) onMeasure(note.id, cardRef.current.offsetHeight);
  }, [text, note.id, onMeasure, sized, note.h]);

  const edited = note.updatedAt ? editedLabel(note.updatedAt) : '';

  return (
    <article
      ref={cardRef}
      className={`note-card ${dragging ? 'is-dragging' : ''} ${movable ? 'is-movable' : ''} ${sized ? 'is-sized' : ''} ${resizing ? 'is-resizing' : ''}`}
      data-color={note.color}
      style={style}
      onPointerDown={(e) => {
        // Any press on the note (text included) brings it to the front; the header also starts a drag.
        if (movable && e.button === 0) onActivate();
        onPointerDown(e);
      }}
    >
      {/* Header bar: drag the note by it (like the top bar of Windows Sticky Notes); it holds the note's buttons. */}
      <header className="note-head" title={movable ? 'Drag to move' : undefined}>
        {movable && (
          <button
            type="button"
            className="note-grip"
            aria-label="Move note (drag, or arrow keys); Ctrl+arrow keys resize it"
            title="Drag to move, or use the arrow keys. Ctrl+arrow keys resize."
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
              if (e.ctrlKey || e.metaKey) onResizeBy(cardRef.current, delta[0], delta[1]);
              else onNudge(delta[0], delta[1]);
            }}
          >
            <Grip size={14} />
          </button>
        )}
        <span className="spacer" />
        <Popover
          align="right"
          trigger={({ onClick, open }) => (
            <button
              type="button"
              className={`note-btn ${open ? 'is-open' : ''}`}
              title="More"
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
              <div className="note-menu-sep" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="note-menu-item"
                onClick={() => {
                  close();
                  flush();
                  onArchive();
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
                  onDelete();
                }}
              >
                <Trash2 size={14} />
                <span>Delete</span>
              </button>
            </div>
          )}
        </Popover>
      </header>
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
        }}
      />
      <footer className="note-footer">
        <span className="note-meta" title={note.updatedAt ? `Edited ${new Date(note.updatedAt).toLocaleString()}` : undefined}>
          {note.taskIds.length > 0 ? (
            <>
              <ListTodo size={13} /> {note.taskIds.length} task{note.taskIds.length === 1 ? '' : 's'} made
            </>
          ) : (
            edited
          )}
        </span>
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
      {/* Invisible strips along the border: drag any edge or corner to resize, as with a window. */}
      {movable &&
        EDGES.map((edge) => (
          <span
            key={edge}
            className={`note-edge note-edge-${edge}`}
            aria-hidden="true"
            onPointerDown={(e) => onResizeStart(edge, e)}
          />
        ))}
    </article>
  );
}
