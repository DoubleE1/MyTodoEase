import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const EDGE_MARGIN = 8;

/**
 * A right-click menu: opens at the pointer (moved in when it would run off the window), closes on Escape, a
 * press outside, scrolling, resizing or the window losing focus. Opened from the keyboard, its first item takes
 * focus; opened with the mouse, no item is chosen until an arrow key is pressed (so a stray Enter does nothing).
 * The arrow keys move between items; Escape puts focus back where it was. Rendered at the document level like
 * Popover, and styled like it, so it is never clipped.
 */
export function ContextMenu({
  at,
  label,
  keyboard = false,
  onClose,
  children,
}: {
  /** Where it was opened (client coordinates). */
  at: { x: number; y: number };
  /** Opened from the keyboard (Shift+F10, the menu key) rather than with the mouse. */
  keyboard?: boolean;
  label: string;
  onClose: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const left = Math.max(EDGE_MARGIN, Math.min(at.x, window.innerWidth - panel.offsetWidth - EDGE_MARGIN));
    const top = Math.max(EDGE_MARGIN, Math.min(at.y, window.innerHeight - panel.offsetHeight - EDGE_MARGIN));
    setPosition({ left, top });
  }, [at.x, at.y]);

  // Focus moves in once the menu is placed (a hidden element cannot be focused): to the first item, or (opened
  // with the mouse) to the menu itself, from where the arrow keys reach the items.
  const placed = position !== null;
  useEffect(() => {
    if (!placed) return;
    const first = keyboard ? panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)') : null;
    (first ?? panelRef.current)?.focus({ preventScroll: true });
  }, [placed, keyboard]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const close = () => closeRef.current();
    const isInside = (target: EventTarget | null) => panelRef.current?.contains(target as Node) ?? false;
    const onPointerDown = (event: PointerEvent) => {
      if (!isInside(event.target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        // Dismissed from the keyboard: back to where focus was. (After a choice, focus is the action's business,
        // e.g. a new note's text; after a click elsewhere, it is where that click put it.)
        before?.focus?.({ preventScroll: true });
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
      const items = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
      if (!items.length) return;
      event.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next =
        event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (i + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
    };
    const onScroll = (event: Event) => {
      if (!isInside(event.target)) close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('scroll', onScroll, true);
    document.addEventListener('wheel', close, { capture: true, passive: true });
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('wheel', close, { capture: true });
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  return createPortal(
    <div
      ref={panelRef}
      className="popover context-menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      style={position ?? { left: at.x, top: at.y, visibility: 'hidden' }}
      // A right-click on the menu itself does nothing more.
      onContextMenu={(e) => e.preventDefault()}
    >
      {children(() => closeRef.current())}
    </div>,
    document.body,
  );
}
