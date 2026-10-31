import {
  Archive,
  ArchiveRestore,
  ClipboardPaste,
  Ellipsis,
  Grip,
  ListTodo,
  Maximize,
  PictureInPicture2,
  Palette,
  Plus,
  StickyNote,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNoteMutations, useNotes } from '../api/hooks';
import { NOTE_COLORS, type Label, type Note, type NoteInput, type Project, type Section } from '../api/types';
import { ContextMenu } from './ContextMenu';
import type { ConfirmOptions } from './Dialogs';
import { MarkdownText } from './MarkdownText';
import { NoteEditor } from './NoteEditor';
import { NoteToTasksDialog } from './NoteToTasksDialog';
import { COLOR_LABELS, canPopOutNotes, editedLabel, popOutNote } from '../lib/notes';
import { Popover } from './Popover';
import { showToast } from '../lib/toast';
import { t } from '../i18n';

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
/** The board: a large, bounded surface (several screens wide); notes stay inside it. */
const BOARD_W = 4000;
const BOARD_H = 3000;
/** A note's left/top, kept so that the whole note is on the board. */
const clampX = (x: number, w: number) => Math.round(clamp(x, 0, BOARD_W - w));
const clampY = (y: number, h: number) => Math.round(clamp(y, 0, BOARD_H - h));

/** Canvas view: pan offset in screen pixels and zoom factor. Remembered per device. */
interface CanvasView {
  x: number;
  y: number;
  z: number;
}
/** Zoom out stops once the whole board is in view (never below this). */
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2.5;
/** How far past the board's edge the view can be pulled. */
const EDGE_ROOM = 80;
const VIEW_KEY = 'todoease.notes.view';
/** Set once the notes from the old top-left layout have been moved to the middle of the board. */
const CENTERED_KEY = 'todoease.notes.centered';
/** The old board was about one screen: a layout that fits in this corner predates the large board. */
const OLD_LAYOUT = { w: 1600, h: 1400 };

/** The home view: the middle of the board at 100%. */
const centerView = (width: number, height: number): CanvasView => ({
  x: width / 2 - BOARD_W / 2,
  y: height / 2 - BOARD_H / 2,
  z: 1,
});

/** Keep the board in sight: limit zoom-out to "whole board fits", and pan to just past its edges
 * (a board smaller than the window is centred). */
function clampView(v: CanvasView, width: number, height: number): CanvasView {
  const fit = Math.min(width / BOARD_W, height / BOARD_H);
  const z = clamp(v.z, Math.max(MIN_ZOOM, Math.min(1, fit)), MAX_ZOOM);
  const axis = (pos: number, size: number, room: number) =>
    size <= room ? (room - size) / 2 : clamp(pos, room - size - EDGE_ROOM, EDGE_ROOM);
  return { x: axis(v.x, BOARD_W * z, width), y: axis(v.y, BOARD_H * z, height), z };
}

/** The view saved on this device, or null to start at the middle of the board. */
function loadView(): CanvasView | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(VIEW_KEY) ?? 'null') as CanvasView | null;
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)) {
      return { x: v.x, y: v.y, z: clamp(v.z, MIN_ZOOM, MAX_ZOOM) };
    }
  } catch {
    // Unreadable: start from the middle.
  }
  return null;
}


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
  const left = clampX(cx - NOTE_WIDTH / 2, NOTE_WIDTH);
  const top = clampY(cy - NOTE_HEIGHT_GUESS / 2, NOTE_HEIGHT_GUESS);
  for (const c of candidates) {
    const rect = { x: left + c.x, y: top + c.y, w: NOTE_WIDTH, h: NOTE_HEIGHT_GUESS };
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > BOARD_W || rect.y + rect.h > BOARD_H) continue;
    if (!placed.some((p) => overlaps(rect, p))) return { x: rect.x, y: rect.y };
  }
  return { x: left, y: top };
}

/**
 * The Notes board: a large board, several screens wide, like a whiteboard. Drag the background (or with the
 * middle mouse button anywhere) to move around, scroll to zoom, pinch on touch screens. Notes keep their place on every
 * device and screen size; the last one moved or created sits on top. Notes save while typing, can be
 * coloured and resized, and "Turn into tasks" suggests tasks from the text for the user to approve.
 */
/**
 * Follow a drag on the whole window, not on the card. Pressing a card brings it to the front, and React moving
 * its element ends the pointer capture, after which a card listening on itself lost any fast move that left it.
 * Returns the function that stops following.
 */
function followPointer(move: (e: PointerEvent) => void, up: (e: PointerEvent) => void): () => void {
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  return () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
}

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
  const surfaceRef = useRef<HTMLDivElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const heights = useRef(new Map<string, number>());
  const [, setMeasured] = useState(0);
  const [drag, setDrag] = useState<{ id: string } | null>(null);
  const [resize, setResize] = useState<{ id: string; x: number; y: number; w: number; h: number } | null>(null);
  const [panning, setPanning] = useState(false);
  /**
   * An archived note being dragged out of the Archived panel: drawn at the board's zoom under the pointer
   * (client position of its top-left corner), and whether letting go here would put it on the board.
   */
  const [archivedDrag, setArchivedDrag] = useState<{ note: Note; left: number; top: number; overBoard: boolean } | null>(null);
  const archivedPanelRef = useRef<HTMLElement>(null);
  /** The board's right-click menu: where it opened (client) and the board point under it. */
  const [boardMenu, setBoardMenu] = useState<{ x: number; y: number; at: { x: number; y: number } } | null>(null);

  const all = notesQuery.data ?? [];
  const active = useMemo(() => all.filter((n) => !n.isArchived), [all]);
  const archived = useMemo(() => all.filter((n) => n.isArchived), [all]);
  const topOrder = active.reduce((max, n) => Math.max(max, n.order), 0);

  // ---- The view (pan and zoom) ----
  // Kept in a ref and written straight to the DOM: panning and zooming never re-render the notes.
  const saved = useRef(loadView());
  const view = useRef<CanvasView>(saved.current ?? { x: 0, y: 0, z: 1 });
  const saveViewTimer = useRef<number | undefined>(undefined);

  const applyView = useCallback(() => {
    const { x, y, z } = view.current;
    if (worldRef.current) worldRef.current.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    if (zoomLabelRef.current) zoomLabelRef.current.textContent = `${Math.round(z * 100)}%`;
  }, []);

  const setView = useCallback(
    (next: CanvasView) => {
      const canvas = canvasRef.current;
      view.current = canvas ? clampView(next, canvas.clientWidth, canvas.clientHeight) : next;
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

  // Apply (and re-fit) the view when the board appears and whenever the window changes size.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // First visit on this device: open at the middle of the board.
    if (!saved.current) {
      saved.current = centerView(canvas.clientWidth, canvas.clientHeight);
      view.current = saved.current;
    }
    setView(view.current);
    const observer = new ResizeObserver(() => setView(view.current));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [setView, notesQuery.isLoading]);

  /** The smallest zoom: the whole board in view. */
  const minZoom = () => {
    const canvas = canvasRef.current;
    if (!canvas) return MIN_ZOOM;
    return Math.max(MIN_ZOOM, Math.min(1, canvas.clientWidth / BOARD_W, canvas.clientHeight / BOARD_H));
  };

  /** Zoom to `z`, keeping the canvas point under (clientX, clientY) where it is. */
  const zoomAt = useCallback(
    (clientX: number, clientY: number, z: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      const { x, y, z: oldZ } = view.current;
      const nz = clamp(z, minZoom(), MAX_ZOOM);
      const px = clientX - r.left;
      const py = clientY - r.top;
      setView({ x: px - ((px - x) / oldZ) * nz, y: py - ((py - y) / oldZ) * nz, z: nz });
    },
    // minZoom only reads the canvas ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const rectOf = useCallback((note: Note): Rect | null => {
    if (note.x == null || note.y == null) return null;
    const w = note.w ?? NOTE_WIDTH;
    const h = heights.current.get(note.id) ?? NOTE_HEIGHT_GUESS;
    return { x: clampX(note.x, w), y: clampY(note.y, h), w, h };
  }, []);

  /** Where a note is drawn: its saved place, pulled onto the board if it was outside. */
  const posOf = (note: Note) => {
    const r = rectOf(note);
    return r ? { x: r.x, y: r.y } : { x: 0, y: 0 };
  };

  /** Show every note: zoom out (never in past 100%) and centre them. */
  const fitAll = () => {
    const canvas = canvasRef.current;
    const rects = active.map(rectOf).filter((r): r is Rect => r !== null);
    if (!canvas) return;
    if (rects.length === 0) {
      setView(centerView(canvas.clientWidth, canvas.clientHeight));
      return;
    }
    const left = Math.min(...rects.map((r) => r.x));
    const top = Math.min(...rects.map((r) => r.y));
    const right = Math.max(...rects.map((r) => r.x + r.w));
    const bottom = Math.max(...rects.map((r) => r.y + r.h));
    const pad = 48;
    const z = clamp(
      Math.min((canvas.clientWidth - pad * 2) / (right - left), (canvas.clientHeight - pad * 2) / (bottom - top), 1),
      minZoom(),
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
      const area = target.closest('textarea, .rich-desc');
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
    const onBackground =
      e.target === canvasRef.current || e.target === worldRef.current || e.target === surfaceRef.current;
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
      const z = clamp(g.start.z * (spread / g.spread), minZoom(), MAX_ZOOM);
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

  // Notes laid out on the old one-screen board all sit in its top-left corner. Move them, as a group, to the
  // middle of the large board once, so there is room on every side. Saved, so other devices see it too.
  useEffect(() => {
    if (notesQuery.isLoading || !notesQuery.data) return;
    try {
      if (window.localStorage.getItem(CENTERED_KEY) === 'true') return;
      window.localStorage.setItem(CENTERED_KEY, 'true');
    } catch {
      return;
    }
    const placed = active.filter((n) => n.x != null && n.y != null);
    if (placed.length === 0) return;
    const rects = placed.map((n) => rectOf(n)!);
    const left = Math.min(...rects.map((r) => r.x));
    const top = Math.min(...rects.map((r) => r.y));
    const right = Math.max(...rects.map((r) => r.x + r.w));
    const bottom = Math.max(...rects.map((r) => r.y + r.h));
    if (right > OLD_LAYOUT.w || bottom > OLD_LAYOUT.h) return;
    const dx = Math.round(BOARD_W / 2 - (left + right) / 2);
    const dy = Math.round(BOARD_H / 2 - (top + bottom) / 2);
    placed.forEach((note, i) => {
      mut.update.mutate({ id: note.id, input: { x: clampX(rects[i].x + dx, rects[i].w), y: clampY(rects[i].y + dy, rects[i].h) } });
    });
    // Runs once per device, when the notes first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesQuery.isLoading, notesQuery.data]);

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

  /** The board point under (clientX, clientY). */
  const boardPoint = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const { x, y, z } = view.current;
    return { x: (clientX - r.left - x) / z, y: (clientY - r.top - y) / z };
  };

  /**
   * A new note in the free spot nearest `at` (canvas point), or the middle of the view: typed into straight
   * away, or (`popOut`) opened as a sticky note in its own window.
   */
  const addNote = async (at?: { x: number; y: number }, options: { text?: string; popOut?: boolean } = {}) => {
    const center = at ?? viewCenter();
    const placed = active.map(rectOf).filter((r): r is Rect => r !== null);
    const position = findFreeSpotNear(placed, center.x, center.y);
    const note = await mut.create.mutateAsync({ text: options.text ?? '', color: 'yellow', order: topOrder + 1, ...position });
    if (options.popOut) {
      popOutNote(note.id);
      return;
    }
    // Out of whatever was being typed in (e.g. another note's text, when the menu was opened from there), so the
    // new note's text can take the cursor.
    (document.activeElement as HTMLElement | null)?.blur?.();
    setFocusId(note.id);
  };

  /**
   * A note holding the clipboard's text. The desktop app reads the clipboard itself; a browser may refuse (no
   * permission), and then the note opens empty with the cursor in it and a hint to press Ctrl+V.
   */
  const pasteAsNote = async (at: { x: number; y: number }) => {
    let text: string | null;
    try {
      text = (await (window.mytodoease?.readText ? window.mytodoease.readText() : navigator.clipboard.readText())).trim();
    } catch {
      text = null;
    }
    if (text === null) showToast(t('The browser did not allow reading the clipboard. Press Ctrl+V in the new note to paste.'));
    else if (!text) showToast(t('There is no text on the clipboard.'));
    await addNote(at, { text: text ?? '' });
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
      ...posOf(note),
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
      // Edges stop at the board's edges; the opposite edge stays put.
      if (edge.includes('e')) w = clamp(start.w + dx, MIN_W, Math.min(MAX_W, BOARD_W - start.x));
      if (edge.includes('w')) {
        w = clamp(start.w - dx, MIN_W, Math.min(MAX_W, start.x + start.w));
        x = start.x + start.w - w;
      }
      if (edge.includes('s')) h = clamp(start.h + dy, MIN_H, Math.min(MAX_H, BOARD_H - start.y));
      if (edge.includes('n')) {
        h = clamp(start.h - dy, MIN_H, Math.min(MAX_H, start.y + start.h));
        y = start.y + start.h - h;
      }
      return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    };
    const pointerId = event.pointerId;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      // The button came up somewhere we did not hear about (outside the window): finish here.
      if (e.buttons === 0) return up(e);
      setResize({ id: note.id, ...rectAt(e) });
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      stopFollowing();
      const rect = rectAt(e);
      setResize(null);
      if (rect.w === start.w && rect.h === start.h) return;
      const moved = rect.x !== start.x || rect.y !== start.y ? { x: rect.x, y: rect.y } : {};
      save(note, { w: rect.w, h: rect.h, ...moved, ...front(note) });
    };
    const stopFollowing = followPointer(move, up);
  };

  const resizeBy = (note: Note, card: HTMLElement | null, dw: number, dh: number) => {
    const { x, y } = posOf(note);
    const w = Math.round(clamp(widthOf(note) + dw, MIN_W, Math.min(MAX_W, BOARD_W - x)));
    const h = Math.round(clamp((card?.offsetHeight ?? note.h ?? NOTE_HEIGHT_GUESS) + dh, MIN_H, Math.min(MAX_H, BOARD_H - y)));
    save(note, { w, h, ...front(note) });
  };

  /** Drag a note by its frame; the textarea and buttons keep their own behaviour. */
  const startDrag = (note: Note, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // Text, buttons and links keep their own behaviour; the grip is a button but is meant to be dragged.
    const control = (event.target as Element).closest('textarea, button, input, a, [role="radiogroup"], .rich-desc, .note-toolbar');
    if (control && !control.classList.contains('note-grip')) return;
    event.preventDefault();
    event.stopPropagation();
    const z = view.current.z;
    const from = posOf(note);
    const size = { w: widthOf(note), h: (event.currentTarget as HTMLElement).offsetHeight || NOTE_HEIGHT_GUESS };
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
    const placeAt = (e: PointerEvent) => ({
      x: clampX(from.x + (e.clientX - startX) / z, size.w),
      y: clampY(from.y + (e.clientY - startY) / z, size.h),
    });
    const pointerId = event.pointerId;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (e.buttons === 0) return up(e);
      const to = placeAt(e);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if (!moved && Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < 3) return;
      if (!moved) setDrag({ id: note.id });
      moved = true;
      offset = { dx, dy };
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      stopFollowing();
      cancelAnimationFrame(frame);
      setDrag(null);
      if (!moved) return;
      const { x, y } = placeAt(e);
      // Put the card at its new place in the same frame the offset goes, so it never jumps back while the
      // save is on its way; the next render writes the same values.
      target.style.left = `${x}px`;
      target.style.top = `${y}px`;
      target.style.transform = '';
      save(note, { x, y, order: note.order === topOrder ? note.order : topOrder + 1 });
    };
    const stopFollowing = followPointer(move, up);
  };

  const nudge = (note: Note, dx: number, dy: number) => {
    const r = rectOf(note) ?? { x: 0, y: 0, w: widthOf(note), h: NOTE_HEIGHT_GUESS };
    save(note, {
      x: clampX(r.x + dx, r.w),
      y: clampY(r.y + dy, r.h),
      order: note.order === topOrder ? note.order : topOrder + 1,
    });
  };

  /**
   * Drag an archived note out of the Archived panel and drop it on the board to put it back there, where it was
   * let go. A press that does not move (or moves under 4 px) stays a click; Escape or letting go over the panel
   * (or outside the board) leaves it archived.
   */
  const startArchivedDrag = (note: Note, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button, a')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    // Where the card was grabbed, in the dragged copy's size (the note at the board's zoom).
    const scale = (widthOf(note) * view.current.z) / rect.width;
    const grabX = (startX - rect.left) * scale;
    const grabY = (startY - rect.top) * scale;
    const inside = (r: DOMRect | undefined, x: number, y: number) => !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    const overBoard = (x: number, y: number) =>
      inside(canvasRef.current?.getBoundingClientRect(), x, y) && !inside(archivedPanelRef.current?.getBoundingClientRect(), x, y);
    let moved = false;
    const finish = (e: PointerEvent | null) => {
      stop();
      window.removeEventListener('keydown', onKey, true);
      setArchivedDrag(null);
      if (!e || !moved || !overBoard(e.clientX, e.clientY)) return;
      const at = boardPoint(e.clientX - grabX, e.clientY - grabY);
      const w = widthOf(note);
      save(note, { isArchived: false, order: topOrder + 1, x: clampX(at.x, w), y: clampY(at.y, note.h ?? NOTE_HEIGHT_GUESS) });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      finish(null);
    };
    const stop = followPointer(
      (e) => {
        if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < 4) return;
        moved = true;
        setArchivedDrag({ note, left: e.clientX - grabX, top: e.clientY - grabY, overBoard: overBoard(e.clientX, e.clientY) });
      },
      (e) => finish(e),
    );
    window.addEventListener('keydown', onKey, true);
  };

  const remove = async (note: Note) => {
    if (note.text.trim()) {
      const ok = await confirm({
        title: t('Delete this note?'),
        message: t('The note is removed for good. Tasks already created from it stay.'),
        confirmLabel: t('Delete'),
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
          <h1>{t('Notes')}</h1>
          <p className="muted small">
            Drag the board to move around, scroll to zoom, double-click or right-click to add a note. Turn a
            note into tasks when you are ready.
          </p>
        </div>
        <div className="notes-header-actions">
          {archived.length > 0 && (
            <button type="button" className={`btn ${showArchived ? 'is-active' : ''}`} onClick={() => setShowArchived((v) => !v)}>
              <Archive size={14} />
              <span>{showArchived ? t('Hide archived') : `Archived (${archived.length})`}</span>
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => void addNote()} disabled={mut.create.isPending}>
            <Plus size={14} />
            <span>{t('New note')}</span>
          </button>
        </div>
      </header>

      {notesQuery.isLoading ? (
        <div className="loading">{t('Loading…')}</div>
      ) : (
        <div
          ref={canvasRef}
          className={`notes-canvas ${panning ? 'is-panning' : ''} ${drag ? 'is-dragging' : ''}`}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onPointerCancel={onCanvasPointerUp}
          onDoubleClick={(e) => {
            if (e.target !== surfaceRef.current) return;
            void addNote(boardPoint(e.clientX, e.clientY));
          }}
          // Right-click on the empty board: add a note there, and the board's other actions.
          onContextMenu={(e) => {
            const onBackground =
              e.target === canvasRef.current || e.target === worldRef.current || e.target === surfaceRef.current;
            if (!onBackground) return;
            e.preventDefault();
            setBoardMenu({ x: e.clientX, y: e.clientY, at: boardPoint(e.clientX, e.clientY) });
          }}
        >
          <div ref={worldRef} className="notes-board notes-world">
            <div ref={surfaceRef} className="notes-surface" style={{ width: BOARD_W, height: BOARD_H }} />
            {active.map((note) => {
              const dragging = drag?.id === note.id;
              const resizing = resize?.id === note.id ? resize : null;
              const height = resizing ? resizing.h : note.h ?? undefined;
              const at = posOf(note);
              const style = {
                left: resizing ? resizing.x : at.x,
                top: resizing ? resizing.y : at.y,
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
              <p>{t('No notes yet.')}</p>
              <p className="muted small">
                A note can be a shopping list, meeting scribbles or a thought. Lists and sentences can become tasks later.
              </p>
              <button type="button" className="btn btn-primary" onClick={() => void addNote()}>
                <Plus size={14} />
                <span>{t('New note')}</span>
              </button>
            </div>
          )}

          <div className="notes-zoombar" role="toolbar" aria-label={t('Zoom')}>
            <button type="button" className="icon-btn" data-tooltip={t('Zoom out')} aria-label={t('Zoom out')} onClick={() => zoomFromCenter(1 / 1.2)}>
              <ZoomOut size={16} />
            </button>
            <button
              type="button"
              className="notes-zoom-level"
              data-tooltip={t('Back to 100%')}
              aria-label={t('Zoom level; reset to 100%')}
              onClick={() => zoomFromCenter(1 / view.current.z)}
            >
              <span ref={zoomLabelRef}>100%</span>
            </button>
            <button type="button" className="icon-btn" data-tooltip={t('Zoom in')} aria-label={t('Zoom in')} onClick={() => zoomFromCenter(1.2)}>
              <ZoomIn size={16} />
            </button>
            <button type="button" className="icon-btn" data-tooltip={t('Show all notes')} aria-label={t('Show all notes')} onClick={fitAll}>
              <Maximize size={15} />
            </button>
          </div>

          {showArchived && archived.length > 0 && (
            <section ref={archivedPanelRef} className="notes-archived" aria-label={t('Archived notes')}>
              <h2 className="notes-archived-title">{t('Archived')}</h2>
              <p className="notes-archived-hint muted small">{t('Drag a note onto the board to put it back there.')}</p>
              <div className="notes-grid">
                {archived.map((note) => (
                  <article
                    key={note.id}
                    className={`note-card is-archived ${archivedDrag?.note.id === note.id ? 'is-lifted' : ''}`}
                    data-color={note.color}
                    onPointerDown={(e) => startArchivedDrag(note, e)}
                  >
                    {note.text ? (
                      <MarkdownText text={note.text} className="md note-text-static" />
                    ) : (
                      <div className="note-text-static">
                        <span className="muted">(empty)</span>
                      </div>
                    )}
                    <footer className="note-footer">
                      {note.taskIds.length > 0 && (
                        <button
                          type="button"
                          className="note-task-link"
                          onClick={() => onOpenTask(note.taskIds[0])}
                          data-tooltip={t('Open the first task made from this note')}
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
                        data-tooltip={t('Put back on the board')}
                        aria-label={t('Restore note')}
                        onClick={() => save(note, { isArchived: false, order: topOrder + 1 })}
                      >
                        <ArchiveRestore size={15} />
                      </button>
                      <button
                        type="button"
                        className="note-btn"
                        data-tooltip={t('Delete note')}
                        aria-label={t('Delete note')}
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

      {/* The archived note being dragged back: the note at the board's size, under the pointer. */}
      {archivedDrag &&
        createPortal(
          <div
            className={`note-card note-drag-ghost ${archivedDrag.overBoard ? '' : 'is-off-board'}`}
            data-color={archivedDrag.note.color}
            style={{
              left: archivedDrag.left,
              top: archivedDrag.top,
              width: widthOf(archivedDrag.note),
              transform: `scale(${view.current.z})`,
            }}
            aria-hidden="true"
          >
            {archivedDrag.note.text ? (
              <MarkdownText text={archivedDrag.note.text} className="md note-text-static" />
            ) : (
              <div className="note-text-static">
                <span className="muted">(empty)</span>
              </div>
            )}
          </div>,
          document.body,
        )}

      {boardMenu && (
        <ContextMenu at={boardMenu} label={t('Board actions')} onClose={() => setBoardMenu(null)}>
          {(close) => {
            const run = (action: () => void) => () => {
              close();
              action();
            };
            return (
              <div className="note-menu">
                <button type="button" role="menuitem" className="note-menu-item" onClick={run(() => void addNote(boardMenu.at))}>
                  <Plus size={14} />
                  <span>{t('New note here')}</span>
                </button>
                {canPopOutNotes() && (
                  <button
                    type="button"
                    role="menuitem"
                    className="note-menu-item"
                    onClick={run(() => void addNote(boardMenu.at, { popOut: true }))}
                  >
                    <PictureInPicture2 size={14} />
                    <span>{t('New sticky note window')}</span>
                  </button>
                )}
                <button type="button" role="menuitem" className="note-menu-item" onClick={run(() => void pasteAsNote(boardMenu.at))}>
                  <ClipboardPaste size={14} />
                  <span>{t('Paste as note')}</span>
                </button>
                <div className="note-menu-sep" role="separator" />
                <button type="button" role="menuitem" className="note-menu-item" disabled={active.length === 0} onClick={run(fitAll)}>
                  <Maximize size={14} />
                  <span>{t('Show all notes')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="note-menu-item"
                  onClick={run(() => zoomAt(boardMenu.x, boardMenu.y, 1))}
                >
                  <ZoomIn size={14} />
                  <span>{t('Back to 100%')}</span>
                </button>
                {archived.length > 0 && (
                  <button type="button" role="menuitem" className="note-menu-item" onClick={run(() => setShowArchived((v) => !v))}>
                    {showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                    <span>{showArchived ? t('Hide archived') : t('Show archived')}</span>
                  </button>
                )}
              </div>
            );
          }}
        </ContextMenu>
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
  const cardRef = useRef<HTMLElement>(null);
  const [focused, setFocused] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  /** The note's right-click menu, opened at this client point (from the keyboard: at the note's corner). */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; keyboard: boolean } | null>(null);

  // Take edits made on another device or window, unless this card is being typed in.
  useEffect(() => {
    if (!focused && note.text !== savedRef.current) {
      savedRef.current = note.text;
      textRef.current = note.text;
      setText(note.text);
      setEditorVersion((v) => v + 1);
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

  // A brand-new note: the cursor goes into its text, and the board is told it has been handled. The editor
  // focuses itself when it is created with autoFocus, but the card can mount (from the refreshed list) a moment
  // before it is marked as new, so wait for the editor (it loads lazily) and focus it if it has not been.
  const focusFrame = useRef(0);
  useEffect(() => {
    if (!autoFocus) return;
    onFocused();
    let tries = 0;
    const check = () => {
      const editable = cardRef.current?.querySelector<HTMLElement>('[contenteditable="true"]');
      if (editable) {
        if (!editable.contains(document.activeElement)) editable.focus({ preventScroll: true });
        return;
      }
      if (++tries < 60) focusFrame.current = requestAnimationFrame(check);
    };
    focusFrame.current = requestAnimationFrame(check);
    // Not cancelled when autoFocus turns off (onFocused does that straight away), only when the card goes.
  }, [autoFocus, onFocused]);
  useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);

  // The card grows with its text (the editor sizes itself); report the height so the board can place notes.
  useLayoutEffect(() => {
    if (cardRef.current) onMeasure(note.id, cardRef.current.offsetHeight);
  }, [text, note.id, onMeasure, sized, note.h]);

  const onType = (next: string) => {
    setText(next);
    textRef.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
  };

  const edited = note.updatedAt ? editedLabel(note.updatedAt) : '';

  // Keyboard moving: works on a selected note (the card has focus: its top bar was clicked, Esc was pressed
  // while typing, or the grip was reached with Tab). In the text, arrow keys stay with the cursor.
  const onMoveKeys = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable || target.closest('.popover, .rich-desc')) return;
    // Delete removes the selected note (asking first when it has text).
    if (e.key === 'Delete' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      onDelete();
      return;
    }
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
  };

  /** The note's actions: in the "..." menu, and (with Turn into tasks) in its right-click menu. */
  const menuItems = (close: () => void, withConvert = false) => (
    <>
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
              onSave({ color });
              close();
            }}
          />
        ))}
      </div>
      <div className="note-menu-sep" role="separator" />
      {canPopOutNotes() && (
        <button
          type="button"
          role="menuitem"
          className="note-menu-item"
          onClick={() => {
            close();
            flush();
            popOutNote(note.id);
          }}
        >
          <PictureInPicture2 size={14} />
          <span>{t('Open in its own window')}</span>
        </button>
      )}
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
        <span>{t('Archive')}</span>
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
        <span>{t('Delete')}</span>
      </button>
      {withConvert && (
        <>
          <div className="note-menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="note-menu-item"
            disabled={!text.trim()}
            onClick={() => {
              close();
              flush();
              onConvert();
            }}
          >
            <ListTodo size={14} />
            <span>{t('Turn into tasks')}</span>
          </button>
        </>
      )}
    </>
  );

  return (
    <article
      ref={cardRef}
      className={`note-card ${dragging ? 'is-dragging' : ''} ${movable ? 'is-movable' : ''} ${sized ? 'is-sized' : ''} ${resizing ? 'is-resizing' : ''}`}
      data-color={note.color}
      style={style}
      tabIndex={movable ? -1 : undefined}
      aria-label={movable ? 'Note: arrow keys move it, Shift for bigger steps, Ctrl+arrow keys resize it, Delete removes it' : undefined}
      onKeyDown={movable ? onMoveKeys : undefined}
      onPointerDown={(e) => {
        // Any press on the note (text included) brings it to the front; the header also starts a drag.
        if (movable && e.button === 0) onActivate();
        // A press on the top bar (not its buttons) selects the note, so the arrow keys move it.
        const target = e.target as HTMLElement;
        if (movable && target.closest('.note-head') && !target.closest('.note-btn, .popover')) {
          cardRef.current?.focus({ preventScroll: true });
        }
        onPointerDown(e);
      }}
      onContextMenu={(e) => {
        if (!movable) return;
        // With text selected, the browser's own menu (copy, spelling) stays.
        const selection = window.getSelection();
        if ((e.target as Element).closest('.note-body') && selection && !selection.isCollapsed) return;
        e.preventDefault();
        onActivate();
        // From the keyboard (Shift+F10, the menu key) there is no pointer: open at the note's corner.
        const r = cardRef.current?.getBoundingClientRect();
        const keyboard = e.clientX === 0 && e.clientY === 0;
        setMenuAt(keyboard && r ? { x: r.left + 16, y: r.top + 16, keyboard } : { x: e.clientX, y: e.clientY, keyboard: false });
      }}
    >
      {menuAt && (
        <ContextMenu at={menuAt} keyboard={menuAt.keyboard} label={t('Note actions')} onClose={() => setMenuAt(null)}>
          {(close) => <div className="note-menu">{menuItems(close, true)}</div>}
        </ContextMenu>
      )}
      {/* Header bar: drag the note by it (like the top bar of Windows Sticky Notes); it holds the note's buttons. */}
      <header className="note-head" data-tooltip={movable ? t('Drag to move') : undefined}>
        {movable && (
          <button
            type="button"
            className="note-grip"
            aria-label={t('Move note (drag, or arrow keys); Ctrl+arrow keys resize it')}
            data-tooltip={t('Drag to move, or use the arrow keys. Ctrl+arrow keys resize.')}
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
              {menuItems(close)}
            </div>
          )}
        </Popover>
      </header>
      <div
        className="note-body"
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          // Moving between the text and its formatting menus is still editing.
          const next = e.relatedTarget as Element | null;
          if (next && (e.currentTarget.contains(next) || next.closest?.('.popover'))) return;
          setFocused(false);
          flush();
        }}
      >
        <NoteEditor
          value={text}
          version={editorVersion}
          onChange={onType}
          onDone={flush}
          onEscape={() => {
            // Esc leaves the text and selects the note, so the arrow keys move it.
            flush();
            if (movable) cardRef.current?.focus({ preventScroll: true });
          }}
          toolbarHost={toolbarHost}
          autoFocus={autoFocus}
        />
      </div>
      <footer className="note-footer">
        {/* Formatting toolbar: takes the edit time's place while the pointer is over the note or it is being edited. */}
        <div ref={setToolbarHost} className="note-toolbar note-board-toolbar" />
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
          data-tooltip={t('Suggest tasks from this note; you review them before anything is created')}
          disabled={!text.trim()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            flush();
            onConvert();
          }}
        >
          <ListTodo size={14} />
          <span>{t('Turn into tasks')}</span>
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
