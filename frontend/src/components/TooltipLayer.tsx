import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Themed tooltips for the whole app, in place of the browser's grey ones. Any element with
 * `data-tooltip="Text"` gets one on hover or keyboard focus; optional `data-tooltip-side="right|top|bottom"`
 * (default top) and `data-tooltip-kbd="m"` for a shortcut chip. Mount once.
 */

const SHOW_DELAY_MS = 450;
/** Moving from one tooltip to the next shows the next at once, as in native toolbars. */
const WARM_MS = 600;
const GAP = 8;
const MARGIN = 8;

type Side = 'top' | 'right' | 'bottom';

interface Tip {
  text: string;
  kbd?: string;
  side: Side;
  x: number;
  y: number;
}

function anchorOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? (target.closest('[data-tooltip]') as HTMLElement | null) : null;
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const lastHidden = useRef(0);

  useEffect(() => {
    const place = (el: HTMLElement): Tip | null => {
      const text = el.dataset.tooltip;
      if (!text) return null;
      const side = (el.dataset.tooltipSide as Side) || 'top';
      const r = el.getBoundingClientRect();
      if (side === 'right') return { text, kbd: el.dataset.tooltipKbd, side, x: r.right + GAP, y: r.top + r.height / 2 };
      if (side === 'bottom') return { text, kbd: el.dataset.tooltipKbd, side, x: r.left + r.width / 2, y: r.bottom + GAP };
      return { text, kbd: el.dataset.tooltipKbd, side, x: r.left + r.width / 2, y: r.top - GAP };
    };

    const show = (el: HTMLElement) => {
      window.clearTimeout(timer.current);
      anchor.current = el;
      const warm = performance.now() - lastHidden.current < WARM_MS;
      timer.current = window.setTimeout(
        () => {
          if (anchor.current === el && el.isConnected) setTip(place(el));
        },
        warm ? 0 : SHOW_DELAY_MS,
      );
    };

    const hide = () => {
      window.clearTimeout(timer.current);
      if (anchor.current) lastHidden.current = performance.now();
      anchor.current = null;
      setTip(null);
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = anchorOf(e.target);
      if (el && el !== anchor.current) show(el);
      else if (!el && anchor.current) hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = anchorOf(e.target);
      // Only keyboard focus: a mouse click also focuses, and the tooltip would linger after it.
      if (el && (e.target as Element).matches(':focus-visible')) show(el);
    };
    const onLeaveWindow = (e: PointerEvent) => {
      if (!e.relatedTarget) hide();
    };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onLeaveWindow);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      window.clearTimeout(timer.current);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onLeaveWindow);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Keep the tooltip inside the window once its size is known (before it is painted).
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el || !tip) return;
    const r = el.getBoundingClientRect();
    let dx = 0;
    if (r.left < MARGIN) dx = MARGIN - r.left;
    else if (r.right > window.innerWidth - MARGIN) dx = window.innerWidth - MARGIN - r.right;
    el.style.setProperty('--tip-nudge', `${dx}px`);
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={tipRef}
      className={`tooltip tooltip-${tip.side}`}
      role="tooltip"
      style={{ left: tip.x, top: tip.y }}
    >
      <span>{tip.text}</span>
      {tip.kbd && <kbd className="tooltip-kbd">{tip.kbd}</kbd>}
    </div>
  );
}
