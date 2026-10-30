import { differenceInMinutes, format, parseISO } from 'date-fns';
import {
  Archive,
  ArchiveRestore,
  Ellipsis,
  Grip,
  ListTodo,
  Maximize,
  Palette,
  Plus,
  StickyNote,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
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
/** Canvas coordinates stay within what the API accepts. */
const POS_LIMIT = 100000;
const clampPos = (v: number) => Math.round(clamp(v, -POS_LIMIT, POS_LIMIT));

/** Canvas view: pan offset in screen pixels and zoom factor. Remembered per device. */
interface CanvasView {
  x: number;
  y: number;
  z: number;
}
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const DOT_SPACING = 24;
const VIEW_KEY = 'todoease.notes.view';
const DEFAULT_VIEW: CanvasView = { x: 40, y: 24, z: 1 };

function loadView(): CanvasView {
  try {
    const v = JSON.parse(window.localStorage.getItem(VIEW_KEY) ?? 'null') as CanvasView | null;
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)) {
      return { x: v.x, y: v.y, z: clamp(v.z, MIN_ZOOM, MAX_ZOOM) };
    }
  } catch {
    // Unreadable: start from the default view.
  }
  return DEFAULT_VIEW;
}

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

/** The free spot closest to (cx, cy) where a new note fits without touching any placed note. */
function findFreeSpotNear(placed: Rect[], cx: number, cy: number): { x: number; y: number } {
  const step = 24;
  const reach = 60;
  const candidates: { x: number; y: number; d: number }[] = [];
  for (let i = -reach; i <= reach; i++) {
    for (let j = -reach; j <= reach; j++) candidates.push({ x: i * step, y: j * step, d: i * i + j * j });
  }
  candidates.sort((a, b) => a.d - b.d);
  const left = cx - NOTE_WIDTH / 2;
  const top = cy - NOTE_HEIGHT_GUESS / 2;
  for (const c of candidates) {
    const rect = { x: left + c.x, y: top + c.y, w: NOTE_WIDTH, h: NOTE_HEIGHT_GUESS };
    if (!placed.some((p) => overlaps(rect, p))) return { x: clampPos(rect.x), y: clampPos(rect.y) };
  }
  return { x: clampPos(left), y: clampPos(top) };
}

/**
 * The Notes board: an endless canvas, like a whiteboard. Drag the background (or with the middle mouse
 * button anywhere) to move around, scroll to zoom, pinch on touch screens. Notes keep their place on every
 * device and screen size; the last one moved or created sits on top. Notes save while typing, can be
 * coloured and resized, and "Turn into tasks" suggests tasks from the text for the user to approve.
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
  const canvasRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const heights = useRef(new Map<string, number>());
  const [, setMeasured] = useState(0);
  const [drag, setDrag] = useState<{ id: string } | null>(null);
  const [resize, setResize] = useState<{ id: string; x: number; y: number; w: number; h: number } | null>(null);
  const [panning, setPanning] = useState(false);

  const all = notesQuery.data ?? [];
  const active = useMemo(() => all.filter((n) => !n.isArchived), [all]);
  const archived = useMemo(() => all.filter((n) => n.isArchived), [all]);
  const topOrder = active.reduce((max, n) => Math.max(max, n.order), 0);

  // ---- The view (pan and zoom) ----
  // Kept in a ref and written straight to the DOM: panning and zooming never re-render the notes.
  const view = useRef<CanvasView>(loadView());
  const saveViewTimer = useRef<number | undefined>(undefined);

  const applyView = useCallback(() => {
    const { x, y, z } = view.current;
    if (worldRef.current) worldRef.current.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    const canvas = canvasRef.current;
    if (canvas) {
      // The dot grid moves and scales with the canvas, so the space reads as one surface.
      canvas.style.backgroundSize = `${DOT_SPACING * z}px ${DOT_SPACING * z}px`;
      canvas.style.backgroundPosition = `${x}px ${y}px`;
    }
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(z * 100)}%`;
  }, []);

  const setView = useCallback(
    (next: CanvasView) => {
      view.current = { x: next.x, y: next.y, z: clamp(next.z, MIN_ZOOM, MAX_ZOOM) };
      applyView();
      window.clearTimeout(saveViewTimer.current);
      saveViewTimer.current = window.setTimeout(() => {
        try {
          window.localStorage.setItem(VIEW_KEY, JSON.stringify(view.current));
        } catch {
          // Not remembered; fine.
        }
      }, 300);
    },
    [applyView],
  );

  useLayoutEffect(applyView, [applyView, notesQuery.isLoading]);

  /** Zoom to `z`, keeping the canvas point under (clientX, clientY) where it is. */
  const zoomAt = useCallback(
    (clientX: number, clientY: number, z: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      const { x, y, z: oldZ } = view.current;
      const nz = clamp(z, MIN_ZOOM, MAX_ZOOM);
      const px = clientX - r.left;
      const py = clientY - r.top;
      setView({ x: px - ((px - x) / oldZ) * nz, y: py - ((py - y) / oldZ) * nz, z: nz });
    },
    [setView],
  );

  const zoomFromCenter = (factor: number) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (r) zoomAt(r.left + r.width / 2, r.top + r.height / 2, view.current.z * factor);
  };

  /** Canvas point at the middle of what the user is looking at. */
  const viewCenter = () => {
    const r = canvasRef.current?.getBoundingClientRect();
    const { x, y, z } = view.current;
    return r ? { x: (r.width / 2 - x) / z, y: (r.height / 2 - y) / z } : { x: 400, y: 300 };
  };

  const rectOf = useCallback(
    (note: Note): Rect | null =>
      note.x == null || note.y == null
        ? null
        : { x: note.x, y: note.y, w: note.w ?? NOTE_WIDTH, h: heights.current.get(note.id) ?? NOTE_HEIGHT_GUESS },
    [],
  );

  /** Show every note: zoom out (never in past 100%) and centre them. */
  const fitAll = () => {
    const canvas = canvasRef.current;
    const rects = active.map(rectOf).filter((r): r is Rect => r !== null);
    if (!canvas || rects.length === 0) {
      setView(DEFAULT_VIEW);
      return;
    }
    const left = Math.min(...rects.map((r) => r.x));
    const top = Math.min(...rects.map((r) => r.y));
    const right = Math.max(...rects.map((r) => r.x + r.w));
    const bottom = Math.max(...rects.map((r) => r.y + r.h));
    const pad = 48;
    const z = clamp(
      Math.min((canvas.clientWidth - pad * 2) / (right - left), (canvas.clientHeight - pad * 2) / (bottom - top), 1),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    setView({
      x: (canvas.clientWidth - (right - left) * z) / 2 - left * z,
      y: (canvas.clientHeight - (bottom - top) * z) / 2 - top * z,
      z,
    });
  };

  // Scrolling zooms around the pointer (Shift+scroll pans). A note whose text overflows scrolls its text.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      const target = e.target as Element;
      if (target.closest('.notes-archived, .notes-zoombar, .popover')) return;
      const area = target.closest('textarea');
      if (area && !e.ctrlKey && area.scrollHeight > area.clientHeight) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.shiftKey) {
        const { x, y, z } = view.current;
        setView({ x: x - e.deltaX * unit, y: y - (e.deltaX ? 0 : e.deltaY * unit), z });
        return;
      }
      // Pinch on a touchpad arrives as Ctrl+wheel with small deltas; give it a stronger response.
      const speed = e.ctrlKey ? 0.01 : 0.0015;
      zoomAt(e.clientX, e.clientY, view.current.z * Math.exp(-e.deltaY * unit * speed));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [notesQuery.isLoading, setView, zoomAt]);

  // Pan by dragging the background (any button-0 press on empty canvas, or the middle button anywhere);
  // two fingers pinch to zoom on touch screens.
  const gesture = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    start: CanvasView;
    anchor: { x: number; y: number };
    spread: number;
  } | null>(null);

  const restartGesture = () => {
    const g = gesture.current;
    if (!g) return;
    const pts = [...g.pointers.values()];
    g.start = { ...view.current };
    g.anchor = {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
    g.spread = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
  };

  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const onBackground = e.target === canvasRef.current || e.target === worldRef.current;
    if (!(onBackground && e.button === 0) && e.button !== 1) return;
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Already released.
    }
    if (!gesture.current) {
      gesture.current = { pointers: new Map(), start: view.current, anchor: { x: 0, y: 0 }, spread: 0 };
      setPanning(true);
    }
    gesture.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    restartGesture();
  };

  const onCanvasPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || !g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...g.pointers.values()];
    const mid = {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
    if (pts.length > 1 && g.spread > 0) {
      // Pinch: scale around where the fingers started, and follow them as they move.
      const r = canvasRef.current!.getBoundingClientRect();
      const spread = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const z = clamp(g.start.z * (spread / g.spread), MIN_ZOOM, MAX_ZOOM);
      const ax = g.anchor.x - r.left;
      const ay = g.anchor.y - r.top;
      const wx = (ax - g.start.x) / g.start.z;
      const wy = (ay - g.start.y) / g.start.z;
      setView({ x: ax - wx * z + (mid.x - g.anchor.x), y: ay - wy * z + (mid.y - g.anchor.y), z });
      return;
    }
    setView({ x: g.start.x + mid.x - g.anchor.x, y: g.start.y + mid.y - g.anchor.y, z: g.start.z });
  };

  const onCanvasPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || !g.pointers.delete(e.pointerId)) return;
    if (g.pointers.size === 0) {
      gesture.current = null;
      setPanning(false);
    } else {
      restartGesture();
    }
  };

  // Notes without a place yet (made before free placement) get one near the middle of the view.
  const placing = useRef(false);
  useEffect(() => {
    if (placing.current || !canvasRef.current) return;
    const unplaced = active.filter((n) => n.x == null || n.y == null);
    if (unplaced.length === 0) return;
    placing.current = true;
    const placed = active.map(rectOf).filter((r): r is Rect => r !== null);
    const center = viewCenter();
    for (const note of [...unplaced].sort((a, b) => a.order - b.order)) {
      const spot = findFreeSpotNear(placed, center.x, center.y);
      placed.push({ ...spot, w: NOTE_WIDTH, h: NOTE_HEIGHT_GUESS });
      mut.update.mutate({ id: note.id, input: spot });
    }
    placing.current = false;
    // viewCenter only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, rectOf, mut.update]);

  /** A new note in the free spot nearest `at` (canvas point), or the middle of the view. */
  const addNote = async (at?: { x: number; y: number }) => {
    const center = at ?? viewCenter();
    const placed = active.map(rectOf).filter((r): r is Rect => r !== null);
    const position = findFreeSpotNear(placed, center.x, center.y);
    const note = await mut.create.mutateAsync({ text: '', color: 'yellow', order: topOrder + 1, ...position });
    setFocusId(note.id);
  };

  const save = (note: Note, input: NoteInput) => mut.update.mutate({ id: note.id, input });

  const widthOf = (note: Note) => note.w ?? NOTE_WIDTH;

  const front = (note: Note) => (note.order === topOrder ? {} : { order: topOrder + 1 });

  /** Clicking a note brings it to the front (and keeps it there). */
  const activate = (note: Note) => {
    if (note.order !== topOrder) save(note, { order: topOrder + 1 });
  };

  /**
   * Resize by dragging any edge or corner, as with a window: the left and top edges move the note too.
   * Live preview while dragging, saved on release. Pointer distances are divided by the zoom.
   */
  const startResize = (note: Note, edge: Edge, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    activate(note);
    const card = (event.currentTarget as HTMLElement).closest('.note-card') as HTMLElement | null;
    const start = {
      x: note.x ?? 0,
      y: note.y ?? 0,
      w: widthOf(note),
      h: card?.offsetHeight ?? note.h ?? NOTE_HEIGHT_GUESS,
    };
    const z = view.current.z;
    const startX = event.clientX;
    const startY = event.clientY;
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already released; listeners below still finish the resize.
    }
    const rectAt = (e: PointerEvent) => {
      const dx = (e.clientX - startX) / z;
      const dy = (e.clientY - startY) / z;
      let { x, y, w, h } = start;
      if (edge.includes('e')) w = clamp(start.w + dx, MIN_W, MAX_W);
      if (edge.includes('w')) {
        // The right edge stays put.
        w = clamp(start.w - dx, MIN_W, MAX_W);
        x = start.x + start.w - w;
      }
      if (edge.includes('s')) h = clamp(start.h + dy, MIN_H, MAX_H);
      if (edge.includes('n')) {
        h = clamp(start.h - dy, MIN_H, MAX_H);
        y = start.y + start.h - h;
      }
      return { x: clampPos(x), y: clampPos(y), w: Math.round(w), h: Math.round(h) };
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
    const w = Math.round(clamp(widthOf(note) + dw, MIN_W, MAX_W));
    const h = Math.round(clamp((card?.offsetHeight ?? note.h ?? NOTE_HEIGHT_GUESS) + dh, MIN_H, MAX_H));
    save(note, { w, h, ...front(note) });
  };

  /** Drag a note by its frame; the textarea and buttons keep their own behaviour. */
  const startDrag = (note: Note, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // Text, buttons and links keep their own behaviour; the grip is a button but is meant to be dragged.
    const control = (event.target as Element).closest('textarea, button, input, a, [role="radiogroup"]');
    if (control && !control.classList.contains('note-grip')) return;
    event.preventDefault();
    event.stopPropagation();
    const z = view.current.z;
    const startX = event.clientX;
    const startY = event.clientY;
    const target = event.currentTarget;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone (e.g. released during a re-render); the move listeners still work.
    }
    // The card follows the pointer by writing its transform directly, once per frame: re-rendering the
    // board on every pointer move is what made dragging lag. The card lives inside the zoomed canvas, so
    // screen distances are divided by the zoom.
    let moved = false;
    let frame = 0;
    let offset = { dx: 0, dy: 0 };
    const paint = () => {
      frame = 0;
      target.style.transform = `translate(${offset.dx}px, ${offset.dy}px)`;
    };
    const move = (e: PointerEvent) => {
      const dx = (e.clientX - startX) / z;
      const dy = (e.clientY - startY) / z;
      if (!moved && Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < 3) return;
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
      const x = clampPos((note.x ?? 0) + (e.clientX - startX) / z);
      const y = clampPos((note.y ?? 0) + (e.clientY - startY) / z);
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
    save(note, {
      x: clampPos((note.x ?? 0) + dx),
      y: clampPos((note.y ?? 0) + dy),
      order: note.order === topOrder ? note.order : topOrder + 1,
    });
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

  const zOrder = new Map([...active].sort((a, b) => a.order - b.order).map((n, i) => [n.id, i + 1]));

  return (
    <div className="view view-notes">
      <header className="view-header notes-header">
        <div>
          <h1>Notes</h1>
          <p className="muted small">
            Drag the background to move around, scroll to zoom, double-click to add a note. Turn a note into tasks
            when you are ready.
          </p>
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
          ref={canvasRef}
          className={`notes-canvas ${panning ? 'is-panning' : ''} ${drag ? 'is-dragging' : ''}`}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerCancel={onCanvasPointerUp}
          onDoubleClick={(e) => {
            if (e.target !== canvasRef.current && e.target !== worldRef.current) return;
            const r = canvasRef.current!.getBoundingClientRect();
            const { x, y, z } = view.current;
            void addNote({ x: (e.clientX - r.left - x) / z, y: (e.clientY - r.top - y) / z });
          }}
        >
          <div ref={worldRef} className="notes-board notes-world">
            {active.map((note) => {
              const dragging = drag?.id === note.id;
              const resizing = resize?.id === note.id ? resize : null;
              const height = resizing ? resizing.h : note.h ?? undefined;
              const style = {
                left: resizing ? resizing.x : note.x ?? 0,
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
                  movable
                  sized={height !== undefined}
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

          <div className="notes-zoombar" role="toolbar" aria-label="Zoom">
            <button type="button" className="icon-btn" data-tooltip="Zoom out" aria-label="Zoom out" onClick={() => zoomFromCenter(1 / 1.2)}>
              <ZoomOut size={16} />
            </button>
            <button
              type="button"
              className="notes-zoom-level"
              data-tooltip="Back to 100%"
              aria-label="Zoom level; reset to 100%"
              onClick={() => zoomFromCenter(1 / view.current.z)}
            >
              <span ref={zoomLabelRef}>100%</span>
            </button>
            <button type="button" className="icon-btn" data-tooltip="Zoom in" aria-label="Zoom in" onClick={() => zoomFromCenter(1.2)}>
              <ZoomIn size={16} />
            </button>
            <button type="button" className="icon-btn" data-tooltip="Show all notes" aria-label="Show all notes" onClick={fitAll}>
              <Maximize size={15} />
            </button>
          </div>

          {showArchived && archived.length > 0 && (
            <section className="notes-archived" aria-label="Archived notes">
              <h2 className="notes-archived-title">Archived</h2>
              <div className="notes-grid">
                {archived.map((note) => (
                  <article key={note.id} className="note-card is-archived" data-color={note.color}>
                    <div className="note-text-static">{note.text || <span className="muted">(empty)</span>}</div>
                    <footer className="note-footer">
                      {note.taskIds.length > 0 && (
                        <button
                          type="button"
                          className="note-task-link"
                          onClick={() => onOpenTask(note.taskIds[0])}
                          data-tooltip="Open the first task made from this note"
                        >
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
                        data-tooltip="Put back on the board"
                        aria-label="Restore note"
                        onClick={() => save(note, { isArchived: false, order: topOrder + 1 })}
                      >
                        <ArchiveRestore size={15} />
                      </button>
                      <button
                        type="button"
                        className="note-btn"
                        data-tooltip="Delete note"
                        aria-label="Delete note"
                        onClick={() => void remove(note)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </footer>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
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
      <header className="note-head" data-tooltip={movable ? 'Drag to move' : undefined}>
        {movable && (
          <button
            type="button"
            className="note-grip"
            aria-label="Move note (drag, or arrow keys); Ctrl+arrow keys resize it"
            data-tooltip="Drag to move, or use the arrow keys. Ctrl+arrow keys resize."
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
        <span className="note-meta" data-tooltip={note.updatedAt ? `Edited ${new Date(note.updatedAt).toLocaleString()}` : undefined}>
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
          data-tooltip="Suggest tasks from this note; you review them before anything is created"
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
