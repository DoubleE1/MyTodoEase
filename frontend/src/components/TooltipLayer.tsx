import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Themed tooltips for the whole app, in place of the browser's grey ones. Any element with
 * `data-tooltip="Text"` gets one on hover or keyboard focus; optional `data-tooltip-side="right|top|bottom"`
 * (default top; it flips when there is no room) and `data-tooltip-kbd="m"` for a shortcut chip. Mount once.
 */

const SHOW_DELAY_MS = 450;
/** Moving from one tooltip to the next shows the next at once, as in native toolbars. */
const WARM_MS = 600;
const GAP = 8;
const MARGIN = 8;
const TIP_ID = 'app-tooltip';

type Side = 'top' | 'right' | 'bottom';

interface Tip {
  text: string;
  kbd?: string;
  side: Side;
  anchor: DOMRect;
}

function anchorOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? (target.closest('[data-tooltip]') as HTMLElement | null) : null;
}

/** Where the tooltip's reference point sits for a side (CSS centres it on that point). */
function pointFor(side: Side, r: DOMRect) {
  if (side === 'right') return { x: r.right + GAP, y: r.top + r.height / 2 };
  if (side === 'bottom') return { x: r.left + r.width / 2, y: r.bottom + GAP };
  return { x: r.left + r.width / 2, y: r.top - GAP };
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const lastHidden = useRef(0);

  useEffect(() => {
    // Screen readers hear the tooltip as the element's description while it is shown.
    const describe = (el: HTMLElement | null, on: boolean) => {
      if (!el) return;
      const ids = (el.getAttribute('aria-describedby') ?? '').split(' ').filter((id) => id && id !== TIP_ID);
      if (on) ids.push(TIP_ID);
      if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
      else el.removeAttribute('aria-describedby');
    };

    const show = (el: HTMLElement) => {
      window.clearTimeout(timer.current);
      describe(anchor.current, false);
      anchor.current = el;
      const warm = performance.now() - lastHidden.current < WARM_MS;
      timer.current = window.setTimeout(
        () => {
          const text = el.dataset.tooltip;
          if (anchor.current !== el || !el.isConnected || !text) return;
          describe(el, true);
          setTip({
            text,
            kbd: el.dataset.tooltipKbd,
            side: (el.dataset.tooltipSide as Side) || 'top',
            anchor: el.getBoundingClientRect(),
          });
        },
        warm ? 0 : SHOW_DELAY_MS,
      );
    };

    const hide = () => {
      window.clearTimeout(timer.current);
      if (anchor.current) lastHidden.current = performance.now();
      describe(anchor.current, false);
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

  // Keep the tooltip inside the window once its size is known (before it is painted): flip to the other
  // side when there is no room (e.g. buttons in the title bar), and slide it in from the left/right edges.
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el || !tip) return;
    const r = el.getBoundingClientRect();
    if (tip.side === 'top' && r.top < MARGIN) {
      setTip({ ...tip, side: 'bottom' });
      return;
    }
    if (tip.side === 'bottom' && r.bottom > window.innerHeight - MARGIN && tip.anchor.top - r.height - GAP > MARGIN) {
      setTip({ ...tip, side: 'top' });
      return;
    }
    let dx = 0;
    if (r.left < MARGIN) dx = MARGIN - r.left;
    else if (r.right > window.innerWidth - MARGIN) dx = window.innerWidth - MARGIN - r.right;
    el.style.setProperty('--tip-nudge', `${dx}px`);
  }, [tip]);

  if (!tip) return null;
  const { x, y } = pointFor(tip.side, tip.anchor);
  return (
    <div ref={tipRef} id={TIP_ID} className={`tooltip tooltip-${tip.side}`} role="tooltip" style={{ left: x, top: y }}>
      <span>{tip.text}</span>
      {tip.kbd && <kbd className="tooltip-kbd">{tip.kbd}</kbd>}
    </div>
  );
}
