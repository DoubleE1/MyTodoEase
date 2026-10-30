import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motionReduced } from '../lib/motion';

interface PopoverProps {
  trigger: (props: { onClick: () => void; open: boolean }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
}

interface Position {
  top: number;
  left: number;
  maxHeight: number;
  placement: 'down' | 'up';
}

const GAP = 4;
const EDGE_MARGIN = 8;
/** Matches the pop-out animation in styles.css. */
const CLOSE_MS = 110;

/**
 * Click-to-open panel anchored to its trigger. Closes on outside click or Escape.
 * The panel is rendered at the document level with fixed positioning, so scrolling
 * containers, modals, and the mini window's panes can never clip it. It opens below
 * the trigger and flips above (and shifts sideways) when the viewport has no room.
 */
export function Popover({ trigger, children, align = 'left' }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  // Closing plays a short shrink-and-fade toward the trigger before the panel is removed.
  const close = () => {
    if (!open || closing) return;
    if (motionReduced()) {
      setOpen(false);
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, CLOSE_MS);
  };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const isInside = (target: EventTarget | null) =>
      (anchorRef.current?.contains(target as Node) ?? false) || (panelRef.current?.contains(target as Node) ?? false);
    // Pointer (not mouse) events, in the capture phase: a drag that starts outside (e.g. moving a note on the
    // board) cancels the follow-up mousedown, which used to leave the menu hanging open.
    const onPointerDown = (event: PointerEvent) => {
      if (!isInside(event.target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Swallow so an enclosing modal does not close at the same time.
        event.stopPropagation();
        close();
      }
    };
    // A fixed panel would drift away from its trigger if the page behind it scrolls; close instead.
    const onScroll = (event: Event) => {
      if (!panelRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // Measure after the panel renders and place it where there is room. Re-run on resize and
  // whenever the panel's content changes size (e.g. label search filtering).
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const update = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const a = anchor.getBoundingClientRect();
      const panelHeight = panel.offsetHeight;
      const panelWidth = panel.offsetWidth;
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

      const spaceBelow = viewportHeight - a.bottom - GAP - EDGE_MARGIN;
      const spaceAbove = a.top - GAP - EDGE_MARGIN;
      const placement: Position['placement'] = panelHeight <= spaceBelow || spaceBelow >= spaceAbove ? 'down' : 'up';
      const maxHeight = Math.max(80, placement === 'down' ? spaceBelow : spaceAbove);
      const height = Math.min(panelHeight, maxHeight);
      const top = placement === 'down' ? a.bottom + GAP : a.top - GAP - height;

      const naturalLeft = align === 'left' ? a.left : a.right - panelWidth;
      const maxLeft = Math.max(EDGE_MARGIN, viewportWidth - panelWidth - EDGE_MARGIN);
      const left = Math.min(Math.max(naturalLeft, EDGE_MARGIN), maxLeft);

      setPosition((current) =>
        current &&
        current.top === top &&
        current.left === left &&
        current.maxHeight === maxHeight &&
        current.placement === placement
          ? current
          : { top, left, maxHeight, placement },
      );
    };
    update();
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver !== 'undefined' && panelRef.current ? new ResizeObserver(update) : null;
    if (observer && panelRef.current) observer.observe(panelRef.current);
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [open, align]);

  const style: CSSProperties = position
    ? { top: position.top, left: position.left, maxHeight: position.maxHeight }
    : { top: 0, left: 0, visibility: 'hidden' };

  return (
    <div className="popover-anchor" ref={anchorRef}>
      {trigger({ onClick: () => (open ? close() : setOpen(true)), open: open && !closing })}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={`popover ${position?.placement === 'up' ? 'popover-up' : ''} ${align === 'right' ? 'popover-right' : ''} ${closing ? 'is-closing' : ''}`}
            style={style}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </div>
  );
}
