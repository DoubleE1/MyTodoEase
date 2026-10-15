import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface PopoverProps {
  trigger: (props: { onClick: () => void; open: boolean }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
}

interface Placement {
  vertical: 'down' | 'up';
  horizontal: 'left' | 'right';
  /** Extra horizontal shift (px) so the panel stays inside the viewport when neither side has room. */
  offsetX: number;
}

const EDGE_MARGIN = 8;

/**
 * Click-to-open panel anchored to its trigger. Closes on outside click or Escape.
 * Opens below the trigger by default and flips above it (or to the other side) when the
 * panel would otherwise run off the viewport, which matters in the small mini window.
 */
export function Popover({ trigger, children, align = 'left' }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>({ vertical: 'down', horizontal: align, offsetX: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Swallow so an enclosing modal does not close at the same time.
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  // Measure after the panel renders and pick the side with room. Re-run on resize and
  // whenever the panel's content changes size (e.g. label search filtering).
  useLayoutEffect(() => {
    if (!open) {
      setPlacement({ vertical: 'down', horizontal: align, offsetX: 0 });
      return;
    }
    const update = () => {
      const anchor = ref.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const a = anchor.getBoundingClientRect();
      const panelHeight = panel.offsetHeight;
      const panelWidth = panel.offsetWidth;
      const spaceBelow = window.innerHeight - a.bottom - EDGE_MARGIN;
      const spaceAbove = a.top - EDGE_MARGIN;
      const vertical: Placement['vertical'] =
        panelHeight <= spaceBelow || spaceBelow >= spaceAbove ? 'down' : 'up';

      let horizontal: Placement['horizontal'] = align;
      const overflowsRight = a.left + panelWidth > window.innerWidth - EDGE_MARGIN;
      const overflowsLeft = a.right - panelWidth < EDGE_MARGIN;
      if (align === 'left' && overflowsRight && !overflowsLeft) horizontal = 'right';
      else if (align === 'right' && overflowsLeft && !overflowsRight) horizontal = 'left';

      // Where the panel's left edge lands with that alignment, then clamp it to the viewport.
      const naturalLeft = horizontal === 'left' ? a.left : a.right - panelWidth;
      const maxLeft = Math.max(EDGE_MARGIN, window.innerWidth - panelWidth - EDGE_MARGIN);
      const clampedLeft = Math.min(Math.max(naturalLeft, EDGE_MARGIN), maxLeft);
      const offsetX = Math.round(clampedLeft - naturalLeft);

      setPlacement((current) =>
        current.vertical === vertical && current.horizontal === horizontal && current.offsetX === offsetX
          ? current
          : { vertical, horizontal, offsetX },
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

  return (
    <div className="popover-anchor" ref={ref}>
      {trigger({ onClick: () => setOpen((o) => !o), open })}
      {open && (
        <div
          ref={panelRef}
          className={`popover popover-${placement.horizontal} ${placement.vertical === 'up' ? 'popover-up' : ''}`}
          style={placement.offsetX ? { transform: `translateX(${placement.offsetX}px)` } : undefined}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
